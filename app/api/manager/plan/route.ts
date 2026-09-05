import crypto from 'crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getPublicSupabaseConfig } from '@/lib/supabase-config'
import { prepareTaskInput } from '@/lib/task-intelligence'
import { ManagerActionError, managerRequestId, requireConfirmedManagerAction, requirePersonalManagerScope, writeManagerActionAudit, type ManagerAction } from '@/lib/manager-action-gateway'

export const dynamic = 'force-dynamic'

type AuthenticatedContext = { userId: string; client: SupabaseClient }
type StoredTask = {
  id: string
  title: string
  subject: string
  subject_id?: string | null
  due_date?: string | null
  estimated_minutes?: number | null
  priority?: number | null
  normalized_title?: string | null
  subject_key?: string | null
  deadline_confidence?: 'explicit' | 'inferred' | 'none' | null
}

type PlannerAuditRow = {
  id: string
  action: 'adaptive_reschedule_overdue' | 'adaptive_split_task' | 'adaptive_update_estimate'
  before_state: unknown
  after_state: unknown
}

function error(message: string, status = 400) { return NextResponse.json({ error: message }, { status }) }
function clean(value: unknown, max = 180) { return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '' }
function isUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) }

function bangkokDateKey(date = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function dateAfter(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00`)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

async function authenticatedContext(request: Request): Promise<AuthenticatedContext | null> {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return null
  const { url, anonKey } = getPublicSupabaseConfig()
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data, error: authError } = await client.auth.getUser(token)
  return authError || !data.user ? null : { userId: data.user.id, client }
}

async function ownPersonalTask(client: SupabaseClient, userId: string, taskId: string) {
  let response = await client.from('planner_tasks').select('id, title, subject, subject_id, due_date, estimated_minutes, priority, normalized_title, subject_key, deadline_confidence').eq('id', taskId).eq('user_id', userId).is('workspace_id', null).eq('completed', false).maybeSingle()
  if (response.error && /subject_id|normalized_title|subject_key|deadline_confidence|schema cache|column/i.test(response.error.message)) {
    response = await client.from('planner_tasks').select('id, title, subject, due_date, estimated_minutes, priority').eq('id', taskId).eq('user_id', userId).is('workspace_id', null).eq('completed', false).maybeSingle()
  }
  return { data: response.data as StoredTask | null, error: response.error }
}

async function insertTaskWithFallback(client: SupabaseClient, row: Record<string, unknown>) {
  let result = await client.from('planner_tasks').insert(row).select('id, title, due_date').single()
  if (result.error && /subject_id|normalized_title|subject_key|deadline_confidence|schema cache|column/i.test(result.error.message)) {
    const { subject_id: _subjectId, normalized_title: _normalizedTitle, subject_key: _subjectKey, deadline_confidence: _deadlineConfidence, ...legacy } = row
    result = await client.from('planner_tasks').insert(legacy).select('id, title, due_date').single()
  }
  return result
}

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function auditTask(value: unknown): StoredTask | null {
  const item = record(value)
  const id = typeof item?.id === 'string' ? item.id : ''
  const title = typeof item?.title === 'string' ? item.title : ''
  const subject = typeof item?.subject === 'string' ? item.subject : ''
  return id && title && subject ? item as StoredTask : null
}

async function findUndoableAction(client: SupabaseClient, userId: string, requestId: string) {
  const alreadyUndone = await client.from('ontology_action_logs')
    .select('id').eq('actor_user_id', userId).eq('object_type', 'planner_adjustment')
    .eq('object_id', requestId).eq('action', 'adaptive_undo').maybeSingle()
  if (alreadyUndone.error) return { row: null, error: alreadyUndone.error }
  if (alreadyUndone.data) return { row: null, error: new Error('That adjustment has already been undone.') }

  const result = await client.from('ontology_action_logs')
    .select('id, action, before_state, after_state').eq('actor_user_id', userId)
    .eq('object_type', 'planner_adjustment').eq('object_id', requestId)
    .in('action', ['adaptive_reschedule_overdue', 'adaptive_split_task', 'adaptive_update_estimate']).order('created_at', { ascending: false }).limit(1).maybeSingle()
  return { row: result.data as PlannerAuditRow | null, error: result.error }
}

export async function POST(request: Request) {
  const context = await authenticatedContext(request)
  if (!context) return error('Sign in to apply a plan adjustment.', 401)
  let body: Record<string, unknown>
  try { body = await request.json() } catch { return error('Invalid JSON request.') }

  const action = body.action
  if (action === 'undo') {
    const undoRequestId = clean(body.undoRequestId, 120)
    if (!undoRequestId) return error('Choose a recent plan change to undo.')
    try { requireConfirmedManagerAction('adaptive_undo', body.confirmed) }
    catch (actionError) { return error(actionError instanceof ManagerActionError ? actionError.message : 'Confirm this change first.', 409) }

    const found = await findUndoableAction(context.client, context.userId, undoRequestId)
    if (found.error || !found.row) return error(found.error?.message || 'That plan change is no longer available to undo.', 409)
    const audit = found.row

    if (audit.action === 'adaptive_reschedule_overdue' || audit.action === 'adaptive_update_estimate') {
      const before = record(audit.before_state)
      const taskId = typeof before?.id === 'string' ? before.id : ''
      if (!isUuid(taskId)) return error('Koko cannot safely restore that previous deadline.', 409)
      const isEstimateUndo = audit.action === 'adaptive_update_estimate'
      const previousDueDate = typeof before?.dueDate === 'string' ? before.dueDate : null
      const previousEstimate = Math.max(5, Math.min(480, Math.round(Number(before?.estimatedMinutes) || 25)))
      let update = await context.client.from('planner_tasks')
        .update(isEstimateUndo ? { estimated_minutes: previousEstimate } : { due_date: previousDueDate, deadline_confidence: 'explicit' })
        .eq('id', taskId).eq('user_id', context.userId).is('workspace_id', null).eq('completed', false).select('id, title, due_date, estimated_minutes').single()
      if (!isEstimateUndo && update.error && /deadline_confidence|schema cache|column/i.test(update.error.message)) {
        update = await context.client.from('planner_tasks').update({ due_date: previousDueDate }).eq('id', taskId).eq('user_id', context.userId).is('workspace_id', null).eq('completed', false).select('id, title, due_date, estimated_minutes').single()
      }
      if (update.error || !update.data) return error(update.error?.message || 'The task changed after Koko’s suggestion, so it was left alone.', 409)
      await writeManagerActionAudit(context.client, {
        action: 'adaptive_undo', requestId: managerRequestId(body.requestId), objectType: 'planner_adjustment', objectId: undoRequestId,
        beforeState: audit.after_state, afterState: { restored: update.data }, metadata: { undoOf: audit.id },
      })
      return NextResponse.json({ action: 'undo', restored: update.data })
    }

    const before = record(audit.before_state)
    const original = auditTask(before?.task)
    const after = record(audit.after_state)
    const childIds = Array.isArray(after?.created)
      ? after.created.map((item) => record(item)?.id).filter((id): id is string => typeof id === 'string' && isUuid(id))
      : []
    if (!original || childIds.length !== 2) return error('Koko cannot safely rebuild that original task.', 409)
    const { data: children, error: childrenError } = await context.client.from('planner_tasks')
      .select('id').eq('user_id', context.userId).is('workspace_id', null).eq('completed', false).in('id', childIds)
    if (childrenError || (children ?? []).length !== childIds.length) return error('One of the smaller tasks changed after Koko’s suggestion, so it was left alone.', 409)

    const originalDueDate = original.due_date || ''
    const originalConfidence = original.deadline_confidence === 'explicit' || original.deadline_confidence === 'inferred' ? original.deadline_confidence : originalDueDate ? 'inferred' : 'none'
    const prepared = prepareTaskInput({ title: original.title, subject: original.subject, dueDate: originalDueDate, deadlineConfidence: originalConfidence })
    const restored = await insertTaskWithFallback(context.client, {
      id: crypto.randomUUID(), user_id: context.userId, title: prepared.title, subject: prepared.subject, subject_id: original.subject_id ?? null,
      normalized_title: prepared.normalizedTitle, subject_key: prepared.subjectKey, deadline_confidence: prepared.deadlineConfidence,
      due_date: originalDueDate || null, estimated_minutes: original.estimated_minutes ?? 25, priority: original.priority ?? 2, completed: false,
    })
    if (restored.error || !restored.data) return error(restored.error?.message || 'Koko could not restore the original task.', 503)
    const deleted = await context.client.from('planner_tasks').delete().eq('user_id', context.userId).is('workspace_id', null).in('id', childIds).select('id')
    if (deleted.error || (deleted.data ?? []).length !== childIds.length) {
      await context.client.from('planner_tasks').delete().eq('id', restored.data.id).eq('user_id', context.userId).is('workspace_id', null)
      return error('Koko could not safely remove the smaller tasks, so it kept your plan unchanged.', 503)
    }
    await writeManagerActionAudit(context.client, {
      action: 'adaptive_undo', requestId: managerRequestId(body.requestId), objectType: 'planner_adjustment', objectId: undoRequestId,
      beforeState: audit.after_state, afterState: { restored: restored.data, removedTaskIds: childIds }, metadata: { undoOf: audit.id },
    })
    return NextResponse.json({ action: 'undo', restored: restored.data, removedTaskIds: childIds })
  }

  const taskId = clean(body.taskId, 64)
  if ((action !== 'reschedule_overdue' && action !== 'split_task' && action !== 'update_estimate') || !isUuid(taskId)) return error('This plan adjustment is not valid.')
  const managerAction: ManagerAction = action === 'reschedule_overdue'
    ? 'adaptive_reschedule_overdue'
    : action === 'update_estimate' ? 'adaptive_update_estimate' : 'adaptive_split_task'
  try {
    requireConfirmedManagerAction(managerAction, body.confirmed)
    // The read below is scoped to workspace_id IS NULL as a second defence.
    requirePersonalManagerScope(managerAction, null)
  } catch (actionError) {
    return error(actionError instanceof ManagerActionError ? actionError.message : 'Confirm this change first.', 409)
  }
  const { data: task, error: taskError } = await ownPersonalTask(context.client, context.userId, taskId)
  if (taskError || !task) return error(taskError?.message || 'That task is no longer available to adjust.', 404)
  const requestId = managerRequestId(body.requestId)
  const today = bangkokDateKey()

  if (action === 'update_estimate') {
    const nextEstimate = Math.max(5, Math.min(480, Math.round(Number(body.estimatedMinutes) || 0)))
    if (!nextEstimate || nextEstimate === task.estimated_minutes) return error('Choose a different estimate before updating this task.', 409)
    const { data, error: updateError } = await context.client.from('planner_tasks').update({ estimated_minutes: nextEstimate })
      .eq('id', task.id).eq('user_id', context.userId).is('workspace_id', null).eq('completed', false).select('id, title, due_date, estimated_minutes').single()
    if (updateError || !data) return error(updateError?.message || 'Koko could not update that estimate.', 503)
    await writeManagerActionAudit(context.client, {
      action: managerAction, requestId, objectType: 'planner_adjustment', objectId: requestId,
      beforeState: { id: task.id, title: task.title, estimatedMinutes: task.estimated_minutes, subject: task.subject },
      afterState: { id: data.id, title: data.title, estimatedMinutes: data.estimated_minutes, subject: task.subject },
    })
    return NextResponse.json({ action, requestId, undoAvailable: true, updated: data })
  }

  if (action === 'reschedule_overdue') {
    if (!task.due_date || task.due_date >= today) return error('That task is no longer overdue, so Koko left it unchanged.', 409)
    const dueDate = dateAfter(today, 1)
    let { data, error: updateError } = await context.client.from('planner_tasks').update({ due_date: dueDate, deadline_confidence: 'explicit' }).eq('id', task.id).eq('user_id', context.userId).is('workspace_id', null).select('id, title, due_date').single()
    if (updateError && /deadline_confidence|schema cache|column/i.test(updateError.message)) {
      const legacy = await context.client.from('planner_tasks').update({ due_date: dueDate }).eq('id', task.id).eq('user_id', context.userId).is('workspace_id', null).select('id, title, due_date').single()
      data = legacy.data
      updateError = legacy.error
    }
    if (updateError || !data) return error(updateError?.message || 'Koko could not move that deadline.', 503)
    await writeManagerActionAudit(context.client, {
      action: managerAction, requestId, objectType: 'planner_adjustment', objectId: requestId,
      beforeState: { id: task.id, title: task.title, dueDate: task.due_date, subject: task.subject },
      afterState: { id: data.id, title: data.title, dueDate: data.due_date, subject: task.subject },
    })
    return NextResponse.json({ action, requestId, undoAvailable: true, updated: data })
  }

  const totalMinutes = Math.max(10, Math.round(Number(task.estimated_minutes) || 25))
  const firstMinutes = Math.max(5, Math.ceil(totalMinutes / 2))
  const secondMinutes = Math.max(5, totalMinutes - firstMinutes)
  const finalDueDate = task.due_date || dateAfter(today, 2)
  const firstDueDate = finalDueDate > dateAfter(today, 1) ? today : finalDueDate
  const deadlineConfidence = task.deadline_confidence === 'explicit' || task.deadline_confidence === 'inferred' ? task.deadline_confidence : finalDueDate ? 'inferred' : 'none'
  const makeRow = (title: string, estimatedMinutes: number, dueDate: string) => {
    const prepared = prepareTaskInput({ title, subject: task.subject || 'General', dueDate, deadlineConfidence })
    return {
      id: crypto.randomUUID(), user_id: context.userId, title: prepared.title, subject: prepared.subject, subject_id: task.subject_id ?? null,
      normalized_title: prepared.normalizedTitle, subject_key: prepared.subjectKey, deadline_confidence: prepared.deadlineConfidence,
      due_date: dueDate || null, estimated_minutes: estimatedMinutes, priority: task.priority === 1 || task.priority === 3 ? task.priority : 2, completed: false,
    }
  }
  const first = await insertTaskWithFallback(context.client, makeRow(`${task.title} · part 1`, firstMinutes, firstDueDate))
  if (first.error || !first.data) return error(first.error?.message || 'Koko could not create the first smaller step.', 503)
  const second = await insertTaskWithFallback(context.client, makeRow(`${task.title} · part 2`, secondMinutes, finalDueDate))
  if (second.error || !second.data) {
    await context.client.from('planner_tasks').delete().eq('id', first.data.id).eq('user_id', context.userId).is('workspace_id', null)
    return error(second.error?.message || 'Koko could not create the second smaller step.', 503)
  }
  const { error: deleteError } = await context.client.from('planner_tasks').delete().eq('id', task.id).eq('user_id', context.userId).is('workspace_id', null)
  if (deleteError) {
    await context.client.from('planner_tasks').delete().in('id', [first.data.id, second.data.id]).eq('user_id', context.userId).is('workspace_id', null)
    return error('Koko could not safely replace the original task, so it left your plan unchanged.', 503)
  }
  await writeManagerActionAudit(context.client, {
    action: managerAction, requestId, objectType: 'planner_adjustment', objectId: requestId,
    beforeState: { task }, afterState: { removedTaskId: task.id, created: [first.data, second.data] },
  })
  return NextResponse.json({ action, requestId, undoAvailable: true, removedTaskId: task.id, created: [first.data, second.data] })
}
