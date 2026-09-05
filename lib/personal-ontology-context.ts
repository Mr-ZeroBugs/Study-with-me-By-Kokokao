import 'server-only'

import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildAdaptiveSignals, type PlannerBehaviorEvent } from '@/lib/adaptive-planner'
import { loadApprovedPersonalMemory } from '@/lib/personal-memory-server'
import { loadLineWorkspaceContext, type LineWorkspaceContext } from '@/lib/line-workspaces'

export const PERSONAL_ONTOLOGY_SCHEMA_VERSION = 'koko.personal-ontology/1.0'

type OntologyLink = {
  fromType: string
  fromId: string
  relation: string
  toType: string
  toId: string
}

export type PersonalOntologySnapshot = {
  schemaVersion: typeof PERSONAL_ONTOLOGY_SCHEMA_VERSION
  userId: string
  generatedAt: string
  objects: {
    subjects: Array<{ id: string; name: string }>
    groups: Array<{ id: string; name: string; role: 'major' | 'minor' | 'unassigned'; subjectIds: string[] }>
    rhythm: {
      majorGroupId: string | null
      minorGroupId: string | null
      maintenance: Array<{ subjectId: string; subjectName: string; minutesPerDay: number }>
    }
    tasks: Array<{ id: string; title: string; subject: string; subjectId: string | null; dueDate: string | null; estimatedMinutes: number; priority: number; workspaceId: string | null; workspaceName: string | null }>
    importantDates: Array<{ id: string; title: string; eventDate: string; type: string; workspaceId: string | null; workspaceName: string | null }>
    workspaces: Array<{ id: string; name: string }>
    focus: {
      todayMinutes: number
      last7DaysMinutes: number
      last30DaysMinutes: number
      activeDaysLast30: number
      bySubject: Array<{ subject: string; minutes: number }>
      recentDays: Array<{ date: string; minutes: number }>
    }
    behavior: Array<{ subject: string; accepted: number; completed: number }>
    memory: Array<{ kind: 'preference' | 'learning'; content: string }>
  }
  links: OntologyLink[]
  derived: {
    openTaskCount: number
    overdueTaskIds: string[]
    dueTodayTaskIds: string[]
    nextTaskId: string | null
  }
  policies: {
    unknownSubjectFallback: 'General'
    aiMayCreateSubjects: false
    teamTaskCompletionFromLine: false
    memoryRequiresApproval: true
  }
}

type CompilerOptions = {
  workspaceContext?: LineWorkspaceContext
  persist?: boolean
  now?: Date
}

const clean = (value: unknown, max = 180) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
  : ''
const stringOrNull = (value: unknown, max = 180) => clean(value, max) || null
const number = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback

function bangkokDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function dateDaysAgo(now: Date, days: number) {
  return bangkokDateKey(new Date(now.getTime() - days * 86_400_000))
}

function taskUrgency(task: PersonalOntologySnapshot['objects']['tasks'][number], today: string, roleBySubjectId: Map<string, string>, adaptive: ReturnType<typeof buildAdaptiveSignals>) {
  const days = task.dueDate ? Math.round((new Date(`${task.dueDate}T00:00:00+07:00`).getTime() - new Date(`${today}T00:00:00+07:00`).getTime()) / 86_400_000) : 999
  const deadline = days < 0 ? 120 : days === 0 ? 90 : days === 1 ? 65 : days <= 3 ? 42 : days <= 7 ? 22 : 5
  const role = task.subjectId ? roleBySubjectId.get(task.subjectId) : undefined
  const rhythm = role === 'major' ? 16 : role === 'minor' ? 10 : 0
  const startable = task.estimatedMinutes <= 25 ? 14 : task.estimatedMinutes <= 45 ? 8 : 0
  const signal = adaptive[task.subject]
  const behavior = signal ? Math.min(9, signal.accepted * 2 + signal.completed) : 0
  return deadline + rhythm + startable + behavior + (task.priority === 3 ? 6 : task.priority === 2 ? 3 : 0)
}

/** Compile one account's canonical tables into the shared Koko context template. */
export async function compilePersonalOntologySnapshot(
  client: SupabaseClient,
  userId: string,
  options: CompilerOptions = {},
): Promise<PersonalOntologySnapshot> {
  const now = options.now ?? new Date()
  const today = bangkokDateKey(now)
  const sevenDaysAgo = dateDaysAgo(now, 6)
  const thirtyDaysAgo = dateDaysAgo(now, 29)
  const workspaceContext = options.workspaceContext ?? await loadLineWorkspaceContext(client, userId)
  const workspaceIds = workspaceContext.ids

  let taskQuery = client.from('planner_tasks').select('id, title, subject, subject_id, due_date, estimated_minutes, priority, workspace_id').eq('completed', false).order('due_date', { ascending: true, nullsFirst: false }).limit(80)
  taskQuery = workspaceIds.length
    ? taskQuery.or(`user_id.eq.${userId},workspace_id.in.(${workspaceIds.join(',')})`)
    : taskQuery.eq('user_id', userId)
  let eventQuery = client.from('planner_events').select('id, title, event_date, type, workspace_id').gte('event_date', today).order('event_date').limit(30)
  eventQuery = workspaceIds.length
    ? eventQuery.or(`user_id.eq.${userId},workspace_id.in.(${workspaceIds.join(',')})`)
    : eventQuery.eq('user_id', userId)

  const [subjectsResult, groupsResult, goalsResult, maintenanceResult, tasksResult, eventsResult, dailyResult, sessionsResult, behaviorResult, memory] = await Promise.all([
    client.from('ontology_subjects').select('id, name').eq('user_id', userId).is('archived_at', null).order('name').limit(60),
    client.from('ontology_subject_groups').select('id, name').eq('user_id', userId).is('archived_at', null).order('name').limit(30),
    client.from('ontology_rhythm_goals').select('subject_group_id, role, status').eq('user_id', userId).eq('status', 'active').limit(12),
    client.from('ontology_maintenance_practices').select('subject_id, minutes_per_day').eq('user_id', userId).eq('active', true).limit(30),
    taskQuery,
    eventQuery,
    client.from('daily_logs').select('date_key, total_minutes').eq('user_id', userId).gte('date_key', thirtyDaysAgo).order('date_key').limit(31),
    client.from('study_sessions').select('subject, subject_id, duration_seconds, date_key').eq('user_id', userId).gte('date_key', thirtyDaysAgo).order('completed_at', { ascending: false }).limit(600),
    client.from('user_planner_behavior_events').select('id, event_type, subject, task_id, occurred_at').eq('user_id', userId).order('occurred_at', { ascending: false }).limit(250),
    loadApprovedPersonalMemory(client, userId),
  ])

  const subjects = (subjectsResult.data ?? []).flatMap((row) => {
    const id = clean(row.id, 64); const name = clean(row.name, 80)
    return id && name ? [{ id, name }] : []
  })
  let taskRows = tasksResult.data ?? []
  if (tasksResult.error) {
    let legacyTaskQuery = client.from('planner_tasks').select('id, title, subject, due_date, estimated_minutes, priority, workspace_id').eq('completed', false).order('due_date', { ascending: true, nullsFirst: false }).limit(80)
    legacyTaskQuery = workspaceIds.length
      ? legacyTaskQuery.or(`user_id.eq.${userId},workspace_id.in.(${workspaceIds.join(',')})`)
      : legacyTaskQuery.eq('user_id', userId)
    const legacyTasks = await legacyTaskQuery
    taskRows = (legacyTasks.data ?? []).map((task) => ({ ...task, subject_id: null }))
  }
  let sessionRows = sessionsResult.data ?? []
  if (sessionsResult.error) {
    const legacySessions = await client.from('study_sessions').select('subject, duration_seconds, date_key').eq('user_id', userId).gte('date_key', thirtyDaysAgo).order('completed_at', { ascending: false }).limit(600)
    sessionRows = (legacySessions.data ?? []).map((session) => ({ ...session, subject_id: null }))
  }
  const subjectNameById = new Map(subjects.map((subject) => [subject.id, subject.name]))
  const goalRows = goalsResult.data ?? []
  const baseGroups = (groupsResult.data ?? []).flatMap((row) => {
    const id = clean(row.id, 64); const name = clean(row.name, 80)
    return id && name ? [{ id, name }] : []
  })
  const membershipsResult = baseGroups.length
    ? await client.from('ontology_subject_group_members').select('group_id, subject_id').in('group_id', baseGroups.map((group) => group.id))
    : { data: [], error: null }
  const memberships = membershipsResult.data ?? []
  const groups = baseGroups.map((row) => {
    const { id, name } = row
    const roleValue = goalRows.find((goal) => goal.subject_group_id === id)?.role
    const role = roleValue === 'major' || roleValue === 'minor' ? roleValue : 'unassigned'
    return { id, name, role, subjectIds: memberships.filter((item) => item.group_id === id && typeof item.subject_id === 'string').map((item) => item.subject_id) }
  })
  const workspaces = workspaceIds.map((id) => ({ id, name: clean(workspaceContext.names[id], 80) || 'Team Space' }))
  const workspaceNameById = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]))
  const tasks = taskRows.flatMap((row) => {
    const id = clean(row.id, 64); const title = clean(row.title); const subject = clean(row.subject, 80) || 'General'
    if (!id || !title) return []
    const workspaceId = stringOrNull(row.workspace_id, 64)
    return [{ id, title, subject, subjectId: stringOrNull(row.subject_id, 64), dueDate: stringOrNull(row.due_date, 10), estimatedMinutes: Math.max(1, Math.round(number(row.estimated_minutes, 25))), priority: Math.max(1, Math.min(3, Math.round(number(row.priority, 2)))), workspaceId, workspaceName: workspaceId ? workspaceNameById.get(workspaceId) ?? null : null }]
  })
  const importantDates = (eventsResult.data ?? []).flatMap((row) => {
    const id = clean(row.id, 64); const title = clean(row.title); const eventDate = clean(row.event_date, 10)
    if (!id || !title || !eventDate) return []
    const workspaceId = stringOrNull(row.workspace_id, 64)
    return [{ id, title, eventDate, type: clean(row.type, 24) || 'important', workspaceId, workspaceName: workspaceId ? workspaceNameById.get(workspaceId) ?? null : null }]
  })
  const recentDays = (dailyResult.data ?? []).map((row) => ({ date: clean(row.date_key, 10), minutes: Math.max(0, Math.round(number(row.total_minutes))) })).filter((row) => row.date)
  const focusBySubject = new Map<string, number>()
  for (const session of sessionRows) {
    const subject = clean(session.subject, 80) || (typeof session.subject_id === 'string' ? subjectNameById.get(session.subject_id) : '') || 'General'
    focusBySubject.set(subject, (focusBySubject.get(subject) ?? 0) + Math.max(0, number(session.duration_seconds)) / 60)
  }
  const behaviorEvents: PlannerBehaviorEvent[] = (behaviorResult.data ?? []).flatMap((row) => row.event_type === 'next_action_accepted' || row.event_type === 'task_completed'
    ? [{ id: clean(row.id, 64), type: row.event_type, subject: clean(row.subject, 80) || 'General', ...(typeof row.task_id === 'string' ? { taskId: row.task_id } : {}), occurredAt: clean(row.occurred_at, 40) }]
    : [])
  const adaptive = buildAdaptiveSignals(behaviorEvents)
  const behavior = Object.entries(adaptive).map(([subject, signal]) => ({ subject, ...signal })).sort((a, b) => (b.accepted + b.completed) - (a.accepted + a.completed)).slice(0, 20)
  const roleBySubjectId = new Map<string, string>()
  for (const group of groups) for (const subjectId of group.subjectIds) roleBySubjectId.set(subjectId, group.role)
  const rankedTasks = [...tasks].sort((a, b) => taskUrgency(b, today, roleBySubjectId, adaptive) - taskUrgency(a, today, roleBySubjectId, adaptive))
  const maintenance = (maintenanceResult.data ?? []).flatMap((row) => {
    const subjectId = clean(row.subject_id, 64); const subjectName = subjectNameById.get(subjectId)
    return subjectId && subjectName ? [{ subjectId, subjectName, minutesPerDay: Math.max(1, Math.min(20, Math.round(number(row.minutes_per_day, 10)))) }] : []
  })

  const links: OntologyLink[] = []
  for (const group of groups) {
    for (const subjectId of group.subjectIds) links.push({ fromType: 'subject', fromId: subjectId, relation: 'belongs_to', toType: 'subject_group', toId: group.id })
    if (group.role !== 'unassigned') links.push({ fromType: 'subject_group', fromId: group.id, relation: 'serves_as', toType: 'rhythm_role', toId: group.role })
  }
  for (const task of tasks) {
    if (task.subjectId) links.push({ fromType: 'task', fromId: task.id, relation: 'studied_through', toType: 'subject', toId: task.subjectId })
    if (task.workspaceId) links.push({ fromType: 'task', fromId: task.id, relation: 'belongs_to', toType: 'workspace', toId: task.workspaceId })
  }

  const snapshot: PersonalOntologySnapshot = {
    schemaVersion: PERSONAL_ONTOLOGY_SCHEMA_VERSION,
    userId,
    generatedAt: now.toISOString(),
    objects: {
      subjects,
      groups,
      rhythm: {
        majorGroupId: groups.find((group) => group.role === 'major')?.id ?? null,
        minorGroupId: groups.find((group) => group.role === 'minor')?.id ?? null,
        maintenance,
      },
      tasks,
      importantDates,
      workspaces,
      focus: {
        todayMinutes: recentDays.find((day) => day.date === today)?.minutes ?? 0,
        last7DaysMinutes: recentDays.filter((day) => day.date >= sevenDaysAgo).reduce((sum, day) => sum + day.minutes, 0),
        last30DaysMinutes: recentDays.reduce((sum, day) => sum + day.minutes, 0),
        activeDaysLast30: recentDays.filter((day) => day.minutes > 0).length,
        bySubject: Array.from(focusBySubject, ([subject, minutes]) => ({ subject, minutes: Math.round(minutes) })).sort((a, b) => b.minutes - a.minutes).slice(0, 20),
        recentDays,
      },
      behavior,
      memory,
    },
    links,
    derived: {
      openTaskCount: tasks.length,
      overdueTaskIds: tasks.filter((task) => task.dueDate && task.dueDate < today).map((task) => task.id),
      dueTodayTaskIds: tasks.filter((task) => task.dueDate === today).map((task) => task.id),
      nextTaskId: rankedTasks[0]?.id ?? null,
    },
    policies: {
      unknownSubjectFallback: 'General',
      aiMayCreateSubjects: false,
      teamTaskCompletionFromLine: false,
      memoryRequiresApproval: true,
    },
  }

  if (options.persist) await persistPersonalOntologySnapshot(client, snapshot)
  return snapshot
}

export function personalOntologyPrompt(snapshot: PersonalOntologySnapshot) {
  const promptView = {
    schemaVersion: snapshot.schemaVersion,
    objects: {
      subjects: [{ id: 'general', name: 'General' }, ...snapshot.objects.subjects].slice(0, 61),
      groups: snapshot.objects.groups,
      rhythm: snapshot.objects.rhythm,
      openTasks: snapshot.objects.tasks.slice(0, 30),
      importantDates: snapshot.objects.importantDates.slice(0, 15),
      focus: snapshot.objects.focus,
      behavior: snapshot.objects.behavior.slice(0, 12),
      memory: snapshot.objects.memory,
      workspaces: snapshot.objects.workspaces,
    },
    links: snapshot.links.slice(0, 120),
    derived: snapshot.derived,
    policies: snapshot.policies,
  }
  return `PERSONAL_ONTOLOGY_SNAPSHOT\n${JSON.stringify(promptView)}`
}

async function persistPersonalOntologySnapshot(client: SupabaseClient, snapshot: PersonalOntologySnapshot) {
  try {
    const semanticContent = { ...snapshot, generatedAt: undefined }
    const contentHash = crypto.createHash('sha256').update(JSON.stringify(semanticContent)).digest('hex')
    const { data: current } = await client.from('user_ontology_snapshots').select('content_hash').eq('user_id', snapshot.userId).maybeSingle()
    if (current?.content_hash === contentHash) return
    await client.from('user_ontology_snapshots').upsert({
      user_id: snapshot.userId,
      schema_version: snapshot.schemaVersion,
      content_hash: contentHash,
      snapshot,
      generated_at: snapshot.generatedAt,
      updated_at: snapshot.generatedAt,
    }, { onConflict: 'user_id' })
  } catch (error) {
    // Snapshot persistence is additive. Missing migration must never block the
    // live planner, LINE reply, or morning reminder.
    console.info('Personal Ontology snapshot persistence is not ready yet:', error)
  }
}
