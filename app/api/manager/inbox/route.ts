import crypto from 'crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { analyzeUserMessageWithGemini, type BatchCaptureItem } from '@/lib/gemini'
import { personalOntologyPrompt, compilePersonalOntologySnapshot, type PersonalOntologySnapshot } from '@/lib/personal-ontology-context'
import { getPublicSupabaseConfig } from '@/lib/supabase-config'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { normalizeSubjectName, prepareTaskInput, subjectKey, type DeadlineConfidence } from '@/lib/task-intelligence'
import { managerRequestId, requireConfirmedManagerAction, writeManagerActionAudit } from '@/lib/manager-action-gateway'
import { isSafeMemoryContent, memoryContentKey, type MemoryKind } from '@/lib/personal-memory'

export const dynamic = 'force-dynamic'

type AuthenticatedContext = { userId: string; client: SupabaseClient }
type InboxDraftTask = {
  id: string
  kind: 'task'
  title: string
  subject: string
  dueDate: string
  estimatedMinutes: number
  priority: 1 | 2 | 3
  deadlineConfidence: DeadlineConfidence
  duplicateOf?: string
}
type InboxDraftEvent = {
  id: string
  kind: 'event'
  title: string
  eventDate: string
  type: 'competition' | 'project' | 'exam' | 'important'
  notes: string
  dateConfidence: DeadlineConfidence
  duplicateOf?: string
}
type InboxDraft = InboxDraftTask | InboxDraftEvent
type WorkspaceTarget = { id: string | null; name: string }

const DATE = /^\d{4}-\d{2}-\d{2}$/
const EVENT_TYPES = new Set(['competition', 'project', 'exam', 'important'])

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

function clean(value: unknown, max = 180) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

function validDate(value: unknown) {
  const date = clean(value, 10)
  return DATE.test(date) ? date : ''
}
function isUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) }

function priority(value: unknown): 1 | 2 | 3 {
  const next = Math.round(Number(value))
  return next === 1 || next === 3 ? next : 2
}

function minutes(value: unknown) {
  return Math.max(5, Math.min(480, Math.round(Number(value) || 25)))
}

async function authenticatedContext(request: Request): Promise<AuthenticatedContext | null> {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return null
  const { url, anonKey } = getPublicSupabaseConfig()
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data, error: authError } = await client.auth.getUser(token)
  return authError || !data.user ? null : { userId: data.user.id, client }
}

function bangkokDateKey(date = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function resolveSubject(rawSubject: string, snapshot: PersonalOntologySnapshot) {
  const requested = normalizeSubjectName(rawSubject)
  if (subjectKey(requested) === subjectKey('General')) return { name: 'General', id: null }
  const subject = snapshot.objects.subjects.find((item) => subjectKey(item.name) === subjectKey(requested))
  return subject ? { name: subject.name, id: subject.id } : { name: 'General', id: null }
}

function taskDuplicateKey(item: Pick<InboxDraftTask, 'title' | 'subject' | 'dueDate'>) {
  const prepared = prepareTaskInput(item)
  return `${prepared.normalizedTitle}|${prepared.subjectKey}|${item.dueDate}`
}

function eventDuplicateKey(item: Pick<InboxDraftEvent, 'title' | 'eventDate'>) {
  return `${clean(item.title).toLocaleLowerCase()}|${item.eventDate}`
}

function addDraftItem(item: BatchCaptureItem, snapshot: PersonalOntologySnapshot): InboxDraft | null {
  if (item.kind === 'task') {
    const title = clean(item.title)
    if (!title) return null
    const subject = resolveSubject(item.subject, snapshot)
    return {
      id: crypto.randomUUID(), kind: 'task', title, subject: subject.name,
      dueDate: validDate(item.dueDate), estimatedMinutes: minutes(item.estimatedMinutes), priority: priority(item.priority),
      deadlineConfidence: validDate(item.dueDate) ? 'inferred' : 'none',
    }
  }
  const title = clean(item.title)
  const eventDate = validDate(item.eventDate)
  if (!title || !eventDate) return null
  return {
    id: crypto.randomUUID(), kind: 'event', title, eventDate,
    type: EVENT_TYPES.has(item.type) ? item.type : 'important', notes: clean(item.notes, 500), dateConfidence: 'inferred',
  }
}

async function resolveWorkspaceTarget(client: SupabaseClient, snapshot: PersonalOntologySnapshot, value: unknown): Promise<WorkspaceTarget | null> {
  const id = clean(value, 64)
  if (!id) return { id: null, name: 'Personal planner' }
  if (!isUuid(id) || !snapshot.objects.workspaces.some((workspace) => workspace.id === id)) return null
  const { data, error } = await client.from('shared_workspaces').select('id, name').eq('id', id).maybeSingle()
  if (error || !data) return null
  return { id: data.id, name: clean(data.name, 80) || 'Team Space' }
}

async function plannerDuplicates(client: SupabaseClient, userId: string, workspaceId: string | null) {
  const taskQuery = client.from('planner_tasks').select('id, title, subject, due_date').eq('completed', false).order('created_at', { ascending: false }).limit(200)
  const eventQuery = client.from('planner_events').select('id, title, event_date').gte('event_date', bangkokDateKey()).limit(100)
  const tasks = workspaceId
    ? await taskQuery.eq('workspace_id', workspaceId)
    : await taskQuery.eq('user_id', userId).is('workspace_id', null)
  const events = workspaceId
    ? await eventQuery.eq('workspace_id', workspaceId)
    : await eventQuery.eq('user_id', userId).is('workspace_id', null)
  return {
    tasks: new Map((tasks.data ?? []).map((item) => [taskDuplicateKey({ title: item.title, subject: item.subject ?? 'General', dueDate: item.due_date ?? '' }), item.id])),
    events: new Map((events.data ?? []).map((item) => [eventDuplicateKey({ title: item.title, eventDate: item.event_date }), item.id])),
  }
}

function cleanDrafts(raw: unknown[], snapshot: PersonalOntologySnapshot): InboxDraft[] {
  const drafts: InboxDraft[] = []
  for (const item of raw.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as Record<string, unknown>
    if (candidate.kind === 'task') {
      const title = clean(candidate.title)
      if (!title) continue
      const subject = resolveSubject(clean(candidate.subject, 80), snapshot)
      drafts.push({ id: crypto.randomUUID(), kind: 'task', title, subject: subject.name, dueDate: validDate(candidate.dueDate), estimatedMinutes: minutes(candidate.estimatedMinutes), priority: priority(candidate.priority), deadlineConfidence: candidate.deadlineConfidence === 'explicit' || candidate.deadlineConfidence === 'inferred' ? candidate.deadlineConfidence : validDate(candidate.dueDate) ? 'inferred' : 'none' })
    } else if (candidate.kind === 'event') {
      const title = clean(candidate.title); const eventDate = validDate(candidate.eventDate)
      if (!title || !eventDate) continue
      const eventType = clean(candidate.type, 30)
      drafts.push({ id: crypto.randomUUID(), kind: 'event', title, eventDate, type: EVENT_TYPES.has(eventType) ? eventType as InboxDraftEvent['type'] : 'important', notes: clean(candidate.notes, 500), dateConfidence: candidate.dateConfidence === 'explicit' || candidate.dateConfidence === 'inferred' ? candidate.dateConfidence : 'inferred' })
    }
  }
  return drafts
}

async function createTask(client: SupabaseClient, userId: string, draft: InboxDraftTask, snapshot: PersonalOntologySnapshot, workspaceId: string | null) {
  const subject = resolveSubject(draft.subject, snapshot)
  const prepared = prepareTaskInput({ title: draft.title, subject: subject.name, dueDate: draft.dueDate, deadlineConfidence: draft.deadlineConfidence })
  const row = {
    id: crypto.randomUUID(), user_id: userId, title: prepared.title, subject: prepared.subject, subject_id: subject.id,
    normalized_title: prepared.normalizedTitle, subject_key: prepared.subjectKey, deadline_confidence: prepared.deadlineConfidence,
    due_date: draft.dueDate || null, estimated_minutes: minutes(draft.estimatedMinutes), priority: priority(draft.priority), completed: false, workspace_id: workspaceId,
  }
  let result = await client.from('planner_tasks').insert(row).select('id, title, subject, due_date').single()
  if (result.error && /subject_id|normalized_title|subject_key|deadline_confidence|schema cache|column/i.test(result.error.message)) {
    const { subject_id: _subjectId, normalized_title: _normalizedTitle, subject_key: _subjectKey, deadline_confidence: _deadlineConfidence, ...legacyRow } = row
    result = await client.from('planner_tasks').insert(legacyRow).select('id, title, subject, due_date').single()
  }
  return result
}

async function createEvent(client: SupabaseClient, userId: string, draft: InboxDraftEvent, workspaceId: string | null) {
  return client.from('planner_events').insert({
    id: crypto.randomUUID(), user_id: userId, title: clean(draft.title), event_date: draft.eventDate,
    type: EVENT_TYPES.has(draft.type) ? draft.type : 'important', notes: clean(draft.notes, 500), workspace_id: workspaceId,
  }).select('id, title, event_date').single()
}

async function proposeInboxMemory(client: SupabaseClient, userId: string, raw: unknown) {
  const candidate = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
  const kind: MemoryKind | null = candidate?.kind === 'preference' || candidate?.kind === 'learning' ? candidate.kind : null
  const content = clean(candidate?.content, 160)
  if (!kind || !content || !isSafeMemoryContent(content)) return null
  const { data: settings, error: settingsError } = await client.from('user_memory_settings').select('enabled').eq('user_id', userId).maybeSingle()
  if (settingsError || settings?.enabled === false) return null
  const { data, error } = await client.from('user_memory_items').upsert({
    user_id: userId, kind, content, content_key: memoryContentKey(content), source: 'agent', status: 'proposed', confidence: 0.8,
    updated_at: new Date().toISOString(), approved_at: null,
  }, { onConflict: 'user_id,content_key' }).select('id, content').maybeSingle()
  if (error) { console.info('Manager Inbox memory proposal unavailable:', error.message); return null }
  return data ? { id: data.id, content: data.content } : null
}

export async function POST(request: Request) {
  const context = await authenticatedContext(request)
  if (!context) return error('Sign in to use Koko Inbox.', 401)

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return error('Invalid JSON request.') }
  const mode = body.mode

  let snapshot: PersonalOntologySnapshot
  try {
    snapshot = await compilePersonalOntologySnapshot(getSupabaseAdmin(), context.userId, { persist: true })
  } catch (contextError) {
    console.error('Manager Inbox context failed:', contextError)
    return error('Koko could not prepare your planner context yet.', 503)
  }

  if (mode === 'preview') {
    const message = clean(body.message, 2_000)
    if (!message) return error('Write or paste something for Koko to sort out.')
    const workspace = await resolveWorkspaceTarget(context.client, snapshot, body.workspaceId)
    if (!workspace) return error('Choose a Team Space you still belong to, or use your personal planner.', 403)
    const analysis = await analyzeUserMessageWithGemini(message, bangkokDateKey(), snapshot.objects.memory, personalOntologyPrompt(snapshot))
    if (!analysis) return error('Koko Inbox is not available yet. Check the AI configuration and try again.', 503)

    const rawItems: BatchCaptureItem[] = analysis.action === 'ADD_BATCH'
      ? analysis.items
      : analysis.action === 'ADD_TODO'
        ? [{ kind: 'task', title: analysis.title, subject: analysis.subject, dueDate: analysis.dueDate, priority: analysis.priority, estimatedMinutes: analysis.estimatedMinutes }]
        : analysis.action === 'ADD_EVENT'
          ? [{ kind: 'event', title: analysis.title, eventDate: analysis.eventDate, type: analysis.type, notes: analysis.notes }]
          : []
    const drafts = rawItems.map((item) => addDraftItem(item, snapshot)).filter((item): item is InboxDraft => Boolean(item))
    const duplicates = await plannerDuplicates(context.client, context.userId, workspace.id)
    for (const draft of drafts) {
      draft.duplicateOf = draft.kind === 'task' ? duplicates.tasks.get(taskDuplicateKey(draft)) : duplicates.events.get(eventDuplicateKey(draft))
    }
    const assistantMessage = analysis.action === 'CHAT'
      ? analysis.replyText
      : analysis.action === 'ADD_TODO' || analysis.action === 'ADD_EVENT' || analysis.action === 'ADD_BATCH'
        ? analysis.aiComment
        : 'I could not find anything to add yet.'
    return NextResponse.json({
      message: assistantMessage || 'I sorted this into a clean little plan.',
      drafts,
      allowedSubjects: ['General', ...snapshot.objects.subjects.map((subject) => subject.name).filter((name) => subjectKey(name) !== subjectKey('General'))],
      workspace,
      workspaceOptions: [{ id: null, name: 'Personal planner' }, ...snapshot.objects.workspaces.map((item) => ({ id: item.id, name: item.name }))],
      memoryProposal: analysis.memoryProposal ?? null,
      noChangesDetected: analysis.action === 'CHAT',
    })
  }

  if (mode === 'apply') {
    try { requireConfirmedManagerAction('manager_inbox_apply', body.confirmed) }
    catch (actionError) { return error(actionError instanceof Error ? actionError.message : 'Confirm this change first.', 409) }
    const drafts = cleanDrafts(Array.isArray(body.drafts) ? body.drafts : [], snapshot)
    if (!drafts.length) return error('There is nothing valid to add.')
    const workspace = await resolveWorkspaceTarget(context.client, snapshot, body.workspaceId)
    if (!workspace) return error('Choose a Team Space you still belong to, or use your personal planner.', 403)
    const requestId = managerRequestId(body.requestId)
    const duplicates = await plannerDuplicates(context.client, context.userId, workspace.id)
    const created: Array<{ id: string; kind: 'task' | 'event'; title: string; workspaceId: string | null }> = []
    const skipped: Array<{ kind: 'task' | 'event'; title: string; reason: 'duplicate' }> = []
    for (const draft of drafts) {
      const duplicateOf = draft.kind === 'task' ? duplicates.tasks.get(taskDuplicateKey(draft)) : duplicates.events.get(eventDuplicateKey(draft))
      if (duplicateOf) { skipped.push({ kind: draft.kind, title: draft.title, reason: 'duplicate' }); continue }
      const result = draft.kind === 'task'
        ? await createTask(context.client, context.userId, draft, snapshot, workspace.id)
        : await createEvent(context.client, context.userId, draft, workspace.id)
      if (result.error || !result.data) return error(result.error?.message || 'Koko could not save one of these items.', 503)
      created.push({ id: result.data.id, kind: draft.kind, title: result.data.title, workspaceId: workspace.id })
    }
    const memory = body.saveMemory === true ? await proposeInboxMemory(context.client, context.userId, body.memoryProposal) : null
    await writeManagerActionAudit(context.client, {
      action: 'manager_inbox_apply', requestId, objectType: 'manager_inbox', objectId: requestId,
      afterState: { created, memory }, metadata: { itemCount: created.length, skippedDuplicateCount: skipped.length, memoryProposed: Boolean(memory) }, workspaceId: workspace.id,
    })
    return NextResponse.json({ requestId, created, skipped, memory, workspace })
  }

  if (mode === 'undo') {
    try { requireConfirmedManagerAction('manager_inbox_undo', body.confirmed) }
    catch (actionError) { return error(actionError instanceof Error ? actionError.message : 'Confirm this change first.', 409) }
    const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)).slice(0, 12) : []
    if (!ids.length) return error('There is nothing to undo.')
    const workspace = await resolveWorkspaceTarget(context.client, snapshot, body.workspaceId)
    if (!workspace) return error('Choose a Team Space you still belong to, or use your personal planner.', 403)
    const taskDelete = context.client.from('planner_tasks').delete().eq('user_id', context.userId).in('id', ids)
    const eventDelete = context.client.from('planner_events').delete().eq('user_id', context.userId).in('id', ids)
    const [tasks, events] = await Promise.all([
      (workspace.id ? taskDelete.eq('workspace_id', workspace.id) : taskDelete.is('workspace_id', null)).select('id'),
      (workspace.id ? eventDelete.eq('workspace_id', workspace.id) : eventDelete.is('workspace_id', null)).select('id'),
    ])
    if (tasks.error || events.error) return error(tasks.error?.message || events.error?.message || 'Koko could not undo that change.', 503)
    const removed = [...(tasks.data ?? []), ...(events.data ?? [])].map((item) => item.id)
    const requestId = managerRequestId(body.requestId)
    await writeManagerActionAudit(context.client, {
      action: 'manager_inbox_undo', requestId, objectType: 'manager_inbox', objectId: requestId,
      beforeState: { removed }, metadata: { itemCount: removed.length }, workspaceId: workspace.id,
    })
    return NextResponse.json({ removed })
  }

  return error('This Inbox action is not supported.', 404)
}
