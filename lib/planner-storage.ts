import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { DeadlineConfidence } from './task-intelligence'

export type TaskPriority = 1 | 2 | 3

export type PlannerTask = {
  id: string
  title: string
  subject: string
  subjectId?: string
  normalizedTitle?: string
  subjectKey?: string
  deadlineConfidence?: DeadlineConfidence
  dueDate: string
  estimatedMinutes: number
  priority: TaskPriority
  completed: boolean
  createdAt: string
  sourceWorkspaceId?: string
  sourceWorkspaceName?: string
}

export type PlannerEventType = 'competition' | 'project' | 'exam' | 'important'

export type PlannerEvent = {
  id: string
  title: string
  eventDate: string
  type: PlannerEventType
  notes: string
  createdAt: string
  sourceWorkspaceId?: string
  sourceWorkspaceName?: string
}

export type PlannerData = {
  tasks: PlannerTask[]
  events: PlannerEvent[]
}

export type SharedWorkspace = {
  id: string
  name: string
  inviteCode: string
  ownerId: string
  createdAt: string
}

export type SharedWorkspaceMember = {
  workspaceId: string
  userId: string
  role: 'owner' | 'member'
  displayName: string
  email: string
  createdAt: string
}

const emptyPlannerData = (): PlannerData => ({ tasks: [], events: [] })
const plannerMemory = new Map<string, PlannerData>()
const sharedPlannerMemory = new Map<string, PlannerData>()

function activeEvents(events: PlannerEvent[]) {
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return events.filter((event) => typeof event?.eventDate === 'string' && event.eventDate >= todayKey)
}

function scopedStorageKey(scope?: User | null) { return scope?.id ?? 'guest' }

function personalPlannerData(data: PlannerData): PlannerData {
  return {
    ...data,
    tasks: data.tasks.filter((task) => !task.sourceWorkspaceId),
    events: data.events.filter((event) => !event.sourceWorkspaceId),
  }
}

export function createPlannerId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function loadLocalPlannerData(scope?: User | null): PlannerData {
  return plannerMemory.get(scopedStorageKey(scope)) ?? emptyPlannerData()
}

export function saveLocalPlannerData(data: PlannerData, scope?: User | null) {
  plannerMemory.set(scopedStorageKey(scope), personalPlannerData(data))
}

function normalizePlannerRows(tasks: unknown, events: unknown): PlannerData {
  return {
    tasks: Array.isArray(tasks) ? tasks : [],
    events: activeEvents(Array.isArray(events) ? events : []),
  }
}

export function loadLocalSharedPlannerData(workspaceId: string): PlannerData {
  return sharedPlannerMemory.get(workspaceId) ?? emptyPlannerData()
}

export function saveLocalSharedPlannerData(workspaceId: string, data: PlannerData) {
  sharedPlannerMemory.set(workspaceId, normalizePlannerRows(data.tasks, data.events))
}

async function upsertPlannerTasksWithSubjectFallback(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return
  const { error } = await supabase.from('planner_tasks').upsert(rows)
  if (error && /subject_id|normalized_title|subject_key|deadline_confidence|schema cache|column/i.test(error.message)) {
    const legacyRows = rows.map(({ subject_id: _subjectId, normalized_title: _normalizedTitle, subject_key: _subjectKey, deadline_confidence: _deadlineConfidence, ...task }) => task)
    const { error: legacyError } = await supabase.from('planner_tasks').upsert(legacyRows)
    if (legacyError) throw legacyError
    return
  }
  if (error) throw error
}

function plannerTaskRow(task: PlannerTask, userId: string, workspaceId?: string) {
  return {
    id: task.id,
    user_id: userId,
    ...(workspaceId ? { workspace_id: workspaceId } : {}),
    title: task.title,
    subject: task.subject,
    subject_id: task.subjectId ?? null,
    normalized_title: task.normalizedTitle ?? null,
    subject_key: task.subjectKey ?? null,
    deadline_confidence: task.deadlineConfidence ?? null,
    due_date: task.dueDate || null,
    estimated_minutes: task.estimatedMinutes,
    priority: task.priority,
    completed: task.completed,
    created_at: task.createdAt,
  }
}

function plannerEventRow(event: PlannerEvent, userId: string, workspaceId?: string) {
  return {
    id: event.id,
    user_id: userId,
    ...(workspaceId ? { workspace_id: workspaceId } : {}),
    title: event.title,
    event_date: event.eventDate,
    type: event.type,
    notes: event.notes,
    created_at: event.createdAt,
  }
}

/** Write exactly one changed personal record. Avoiding a full-list upsert
 * prevents a stale browser tab from reviving unrelated LINE or team updates. */
export async function syncPlannerTask(user: User | null, task: PlannerTask) {
  if (!user || task.sourceWorkspaceId) return
  try {
    await upsertPlannerTasksWithSubjectFallback([plannerTaskRow(task, user.id)])
  } catch (error) {
    console.error('Failed to sync planner task:', error)
  }
}

export async function syncPlannerEvent(user: User | null, event: PlannerEvent) {
  if (!user || event.sourceWorkspaceId) return
  try {
    const { error } = await supabase.from('planner_events').upsert(plannerEventRow(event, user.id))
    if (error) throw error
  } catch (error) {
    console.error('Failed to sync planner event:', error)
  }
}

export async function syncSharedPlannerTask(user: User | null, workspaceId: string, task: PlannerTask) {
  if (!user) return
  try {
    await upsertPlannerTasksWithSubjectFallback([plannerTaskRow(task, user.id, workspaceId)])
  } catch (error) {
    console.error('Failed to sync shared planner task:', error)
  }
}

export async function syncSharedPlannerEvent(user: User | null, workspaceId: string, event: PlannerEvent) {
  if (!user) return
  try {
    const { error } = await supabase.from('planner_events').upsert(plannerEventRow(event, user.id, workspaceId))
    if (error) throw error
  } catch (error) {
    console.error('Failed to sync shared planner event:', error)
  }
}

export async function loadPlannerData(user: User | null): Promise<PlannerData> {
  const local = loadLocalPlannerData(user)
  if (!user) return local

  try {
    const sharedWorkspaces = await loadSharedWorkspaces(user)
    const workspaceIds = sharedWorkspaces.map((workspace) => workspace.id)
    const workspaceById = new Map(sharedWorkspaces.map((workspace) => [workspace.id, workspace]))
    const [tasksResponse, eventsResponse] = await Promise.all([
      supabase.from('planner_tasks').select('*').eq('user_id', user.id),
      supabase.from('planner_events').select('*').eq('user_id', user.id),
    ])

    if (tasksResponse.error || eventsResponse.error) return local

    // Personal view includes a read-only mirror of every shared workspace. A
    // missing shared schema simply means there are no mirrors yet, so personal
    // planning remains usable before the migration is applied.
    let sharedTasks: PlannerTask[] = []
    let sharedEvents: PlannerEvent[] = []
    if (workspaceIds.length) {
      const [sharedTasksResponse, sharedEventsResponse] = await Promise.all([
        supabase.from('planner_tasks').select('*').in('workspace_id', workspaceIds),
        supabase.from('planner_events').select('*').in('workspace_id', workspaceIds),
      ])
      if (!sharedTasksResponse.error) {
        sharedTasks = (sharedTasksResponse.data ?? []).map((row) => plannerTaskFromRow(row, workspaceById.get(row.workspace_id)))
      }
      if (!sharedEventsResponse.error) {
        sharedEvents = (sharedEventsResponse.data ?? []).map((row) => plannerEventFromRow(row, workspaceById.get(row.workspace_id)))
      }
    }

    const cloud: PlannerData = {
      tasks: [...(tasksResponse.data ?? []).filter((row) => row.workspace_id == null).map((row) => plannerTaskFromRow(row)), ...sharedTasks],
      events: activeEvents([...(eventsResponse.data ?? []).filter((row) => row.workspace_id == null).map((row) => plannerEventFromRow(row)), ...sharedEvents]),
    }

    // Cloud is the source of truth for records that already exist remotely.
    // The previous order let a stale local cache overwrite a newer server
    // value (for example, completing a task from the LINE bot), so the web
    // page would resurrect the task as incomplete on its next load.
    saveLocalPlannerData(cloud, user)
    return cloud
  } catch (error) {
    console.error('Failed to load planner data:', error)
    return local
  }
}

function normalizeSharedWorkspace(row: any): SharedWorkspace | null {
  if (!row?.id || !row?.name || !row?.invite_code || !row?.owner_id) return null
  return {
    id: row.id,
    name: row.name,
    inviteCode: row.invite_code,
    ownerId: row.owner_id,
    createdAt: row.created_at,
  }
}

function plannerTaskFromRow(row: any, workspace?: SharedWorkspace): PlannerTask {
  return {
    id: row.id,
    title: row.title,
    subject: row.subject ?? 'General',
    ...(typeof row.subject_id === 'string' ? { subjectId: row.subject_id } : {}),
    ...(typeof row.normalized_title === 'string' ? { normalizedTitle: row.normalized_title } : {}),
    ...(typeof row.subject_key === 'string' ? { subjectKey: row.subject_key } : {}),
    ...(row.deadline_confidence === 'explicit' || row.deadline_confidence === 'inferred' || row.deadline_confidence === 'none' ? { deadlineConfidence: row.deadline_confidence } : {}),
    dueDate: row.due_date ?? '',
    estimatedMinutes: row.estimated_minutes ?? 25,
    priority: row.priority ?? 2,
    completed: row.completed ?? false,
    createdAt: row.created_at,
    ...(workspace ? { sourceWorkspaceId: workspace.id, sourceWorkspaceName: workspace.name } : {}),
  }
}

function plannerEventFromRow(row: any, workspace?: SharedWorkspace): PlannerEvent {
  return {
    id: row.id,
    title: row.title,
    eventDate: row.event_date,
    type: row.type,
    notes: row.notes ?? '',
    createdAt: row.created_at,
    ...(workspace ? { sourceWorkspaceId: workspace.id, sourceWorkspaceName: workspace.name } : {}),
  }
}

export async function loadSharedWorkspaces(user: User | null): Promise<SharedWorkspace[]> {
  if (!user) return []
  try {
    const { data, error } = await supabase
      .from('shared_workspaces')
      .select('id, name, invite_code, owner_id, created_at')
      .order('created_at', { ascending: true })
    if (error || !data) return []
    return data.map(normalizeSharedWorkspace).filter((item): item is SharedWorkspace => Boolean(item))
  } catch (error) {
    console.error('Failed to load shared workspaces:', error)
    return []
  }
}

function normalizeSharedWorkspaceMember(row: any): SharedWorkspaceMember | null {
  if (!row?.workspace_id || !row?.user_id) return null
  return {
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: row.role === 'owner' ? 'owner' : 'member',
    displayName: typeof row.display_name === 'string' && row.display_name.trim() ? row.display_name.trim() : `user ${String(row.user_id).slice(0, 6)}`,
    email: typeof row.email === 'string' ? row.email : '',
    createdAt: row.created_at,
  }
}

export async function loadSharedWorkspaceMembers(user: User | null, workspaceId: string): Promise<SharedWorkspaceMember[]> {
  if (!user) return []
  try {
    // Prefer the security-definer RPC because it can join profiles without
    // exposing the profiles table. If the RPC was added recently, however,
    // PostgREST may still have a stale schema cache. Fall back to the member
    // table so the panel keeps working while that cache catches up.
    const rpcResponse = await supabase.rpc('list_shared_workspace_members', { target_workspace_id: workspaceId })
    const rpcRows = Array.isArray(rpcResponse.data) ? rpcResponse.data : rpcResponse.data ? [rpcResponse.data] : []
    const rpcMembers = rpcRows
      // The RPC returns member identity fields (not the repeated workspace
      // id), so attach the id we queried before normalizing.
      .map((row) => normalizeSharedWorkspaceMember({ ...row, workspace_id: row.workspace_id ?? workspaceId }))
      .filter((item: SharedWorkspaceMember | null): item is SharedWorkspaceMember => Boolean(item))
    if (rpcMembers.length) return rpcMembers

    const { data: memberRows, error: memberError } = await supabase
      .from('shared_workspace_members')
      .select('workspace_id, user_id, role, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true })

    if (memberError) {
      console.error('Failed to load shared workspace members:', rpcResponse.error ?? memberError)
      return []
    }

    const rows = Array.isArray(memberRows) ? memberRows : []
    if (!rows.length) return []

    // Names are best-effort in the fallback. The shared profile policy below
    // allows this lookup for members of the same space; IDs remain a safe
    // fallback for older databases where that policy has not been applied.
    const memberIds = rows.map((row) => row.user_id).filter((id): id is string => typeof id === 'string' && Boolean(id))
    const { data: profiles, error: profileError } = memberIds.length
      ? await supabase.from('profiles').select('id, display_name, email').in('id', memberIds)
      : { data: [], error: null }
    if (profileError) console.warn('Shared member names are unavailable:', profileError)
    const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]))

    return rows
      .map((row) => {
        const profile = profileById.get(row.user_id)
        return normalizeSharedWorkspaceMember({ ...row, display_name: profile?.display_name, email: profile?.email })
      })
      .filter((item: SharedWorkspaceMember | null): item is SharedWorkspaceMember => Boolean(item))
  } catch (error) {
    console.error('Failed to load shared workspace members:', error)
    return []
  }
}

export async function leaveSharedWorkspace(user: User | null, workspaceId: string) {
  if (!user) throw new Error('Sign in before leaving a shared space.')
  const { error } = await supabase.rpc('leave_shared_workspace', { target_workspace_id: workspaceId })
  if (error) throw error
}

export async function deleteSharedWorkspace(user: User | null, workspaceId: string) {
  if (!user) throw new Error('Sign in before deleting a shared space.')
  const { error } = await supabase.from('shared_workspaces').delete().eq('id', workspaceId).eq('owner_id', user.id)
  if (error) throw error
}

export async function createSharedWorkspace(user: User | null, name: string): Promise<SharedWorkspace> {
  if (!user) throw new Error('Sign in before creating a shared space.')
  const cleanName = name.trim().slice(0, 60)
  if (!cleanName) throw new Error('Give your shared space a name first.')
  const { data, error } = await supabase.rpc('create_shared_workspace', { workspace_name: cleanName })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  const workspace = normalizeSharedWorkspace(row)
  if (!workspace) throw new Error('The shared space could not be created.')
  return workspace
}

export async function joinSharedWorkspace(user: User | null, inviteCode: string): Promise<SharedWorkspace> {
  if (!user) throw new Error('Sign in before joining a shared space.')
  const cleanCode = inviteCode.trim().toUpperCase()
  if (!cleanCode) throw new Error('Enter an invite code first.')
  const { data, error } = await supabase.rpc('join_shared_workspace', { invite_code_input: cleanCode })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  const workspace = normalizeSharedWorkspace(row)
  if (!workspace) throw new Error('That invite code is not valid.')
  return workspace
}

export async function loadSharedPlannerData(user: User | null, workspaceId: string): Promise<PlannerData> {
  const local = loadLocalSharedPlannerData(workspaceId)
  if (!user) return emptyPlannerData()

  try {
    const [tasksResponse, eventsResponse] = await Promise.all([
      supabase.from('planner_tasks').select('*').eq('workspace_id', workspaceId),
      supabase.from('planner_events').select('*').eq('workspace_id', workspaceId),
    ])
    if (tasksResponse.error || eventsResponse.error) return local

    const cloud = normalizePlannerRows(
      (tasksResponse.data ?? []).map((row) => ({
        id: row.id, title: row.title, subject: row.subject ?? 'General', ...(typeof row.subject_id === 'string' ? { subjectId: row.subject_id } : {}), ...(typeof row.normalized_title === 'string' ? { normalizedTitle: row.normalized_title } : {}), ...(typeof row.subject_key === 'string' ? { subjectKey: row.subject_key } : {}), ...(row.deadline_confidence === 'explicit' || row.deadline_confidence === 'inferred' || row.deadline_confidence === 'none' ? { deadlineConfidence: row.deadline_confidence } : {}), dueDate: row.due_date ?? '',
        estimatedMinutes: row.estimated_minutes ?? 25, priority: row.priority ?? 2, completed: row.completed ?? false, createdAt: row.created_at,
      })),
      (eventsResponse.data ?? []).map((row) => ({
        id: row.id, title: row.title, eventDate: row.event_date, type: row.type, notes: row.notes ?? '', createdAt: row.created_at,
      })),
    )
    saveLocalSharedPlannerData(workspaceId, cloud)
    return cloud
  } catch (error) {
    console.error('Failed to load shared planner data:', error)
    return local
  }
}

export async function syncSharedPlannerData(user: User | null, workspaceId: string, data: PlannerData) {
  if (!user) return
  try {
    await Promise.all([
      upsertPlannerTasksWithSubjectFallback(data.tasks.map((task) => plannerTaskRow(task, user.id, workspaceId))),
      data.events.length ? supabase.from('planner_events').upsert(data.events.map((event) => plannerEventRow(event, user.id, workspaceId))) : Promise.resolve(),
    ])
  } catch (error) {
    console.error('Failed to sync shared planner data:', error)
  }
}

export async function removeSharedPlannerRecord(user: User | null, workspaceId: string, table: 'planner_tasks' | 'planner_events', id: string) {
  if (!user) return
  try {
    await supabase.from(table).delete().eq('id', id).eq('workspace_id', workspaceId)
  } catch (error) {
    console.error('Failed to delete shared planner record:', error)
  }
}

export async function syncPlannerData(user: User | null, data: PlannerData) {
  if (!user) return
  try {
    const personalTasks = data.tasks.filter((task) => !task.sourceWorkspaceId)
    const personalEvents = data.events.filter((event) => !event.sourceWorkspaceId)
    await Promise.all([
      upsertPlannerTasksWithSubjectFallback(personalTasks.map((task) => plannerTaskRow(task, user.id))),
      personalEvents.length ? supabase.from('planner_events').upsert(personalEvents.map((event) => plannerEventRow(event, user.id))) : Promise.resolve(),
    ])
  } catch (error) {
    console.error('Failed to sync planner data:', error)
  }
}

export async function removePlannerRecord(user: User | null, table: 'planner_tasks' | 'planner_events', id: string) {
  if (!user) return
  try {
    await supabase.from(table).delete().eq('id', id).eq('user_id', user.id)
  } catch (error) {
    console.error('Failed to delete planner record:', error)
  }
}
