import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { KokoActionName } from '@/lib/ontology'
import { getPublicSupabaseConfig } from '@/lib/supabase-config'

const { url: supabaseUrl, anonKey: supabaseAnonKey } = getPublicSupabaseConfig()

type AuthenticatedContext = {
  userId: string
  client: SupabaseClient
}

type ActionBody = {
  action?: KokoActionName
  requestId?: string
  input?: Record<string, unknown>
}

function responseError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

function text(value: unknown, maxLength = 80) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function optionalText(value: unknown, maxLength = 500) {
  const result = text(value, maxLength)
  return result || null
}

function uuid(value: unknown) {
  const result = text(value, 64)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result) ? result : null
}

function validRole(value: unknown): 'major' | 'minor' | 'unassigned' | null {
  return value === 'major' || value === 'minor' || value === 'unassigned' ? value : null
}

async function getAuthenticatedContext(request: Request): Promise<AuthenticatedContext | null> {
  const authorization = request.headers.get('authorization')
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return null

  // Use the caller's JWT, never the service-role key. RLS remains the final
  // authority for every Ontology read/write performed by this route.
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) return null
  return { userId: data.user.id, client }
}

async function writeActionLog(
  client: SupabaseClient,
  requestId: string,
  action: string,
  objectType: string,
  objectId: string,
  beforeState: unknown,
  afterState: unknown,
) {
  const { error } = await client.rpc('write_ontology_action_log', {
    next_action: action,
    next_object_type: objectType,
    next_object_id: objectId,
    next_source: 'web',
    next_before_state: beforeState,
    next_after_state: afterState,
    next_metadata: { requestId },
    next_workspace_id: null,
  })
  // The mutation has already succeeded. Logging must be visible to operators,
  // but must not report a successful mutation as a failed one to the learner.
  if (error) console.error('Failed to write ontology action log:', error)
}

export async function GET(request: Request) {
  const context = await getAuthenticatedContext(request)
  if (!context) return responseError('Sign in is required.', 401)

  const { client } = context
  const [subjects, groups, memberships, rhythmGoals, maintenance] = await Promise.all([
    client.from('ontology_subjects').select('*').is('archived_at', null).order('name'),
    client.from('ontology_subject_groups').select('*').is('archived_at', null).order('name'),
    client.from('ontology_subject_group_members').select('group_id, subject_id, created_at'),
    client.from('ontology_rhythm_goals').select('*').order('created_at'),
    client.from('ontology_maintenance_practices').select('*').eq('active', true).order('created_at'),
  ])

  const firstError = [subjects, groups, memberships, rhythmGoals, maintenance].find((result) => result.error)?.error
  if (firstError) {
    // A missing migration is the expected first-run state. Keep the message
    // actionable without leaking provider internals into the UI.
    return responseError('Koko Ontology is not ready yet. Apply 003_ontology_v0.sql first.', 503)
  }

  return NextResponse.json({
    userId: context.userId,
    subjects: subjects.data ?? [],
    groups: groups.data ?? [],
    memberships: memberships.data ?? [],
    rhythmGoals: rhythmGoals.data ?? [],
    maintenance: maintenance.data ?? [],
  })
}

export async function POST(request: Request) {
  const context = await getAuthenticatedContext(request)
  if (!context) return responseError('Sign in is required.', 401)

  let body: ActionBody
  try {
    body = await request.json()
  } catch {
    return responseError('Invalid JSON request.')
  }

  const action = body.action
  const requestId = text(body.requestId, 120) || crypto.randomUUID()
  const input = body.input ?? {}
  const { client, userId } = context

  if (action === 'create_subject') {
    const name = text(input.name)
    if (!name) return responseError('A subject name is required.')
    const { data, error } = await client
      .from('ontology_subjects')
      .insert({ user_id: userId, name, color: optionalText(input.color, 20) })
      .select('*')
      .single()
    if (error || !data) return responseError(error?.message || 'Could not create this subject.')
    await writeActionLog(client, requestId, action, 'ontology_subjects', data.id, null, data)
    return NextResponse.json({ data })
  }

  if (action === 'create_subject_group') {
    const name = text(input.name)
    if (!name) return responseError('A group name is required.')
    const { data, error } = await client
      .from('ontology_subject_groups')
      .insert({ user_id: userId, name, description: text(input.description, 500), color: optionalText(input.color, 20) })
      .select('*')
      .single()
    if (error || !data) return responseError(error?.message || 'Could not create this group.')
    await writeActionLog(client, requestId, action, 'ontology_subject_groups', data.id, null, data)
    return NextResponse.json({ data })
  }

  if (action === 'update_subject_group') {
    const groupId = uuid(input.groupId)
    const name = text(input.name)
    if (!groupId || !name) return responseError('A valid group and name are required.')
    const { data: before, error: beforeError } = await client.from('ontology_subject_groups').select('*').eq('id', groupId).maybeSingle()
    if (beforeError || !before) return responseError(beforeError?.message || 'Group not found.', 404)
    const { data, error } = await client
      .from('ontology_subject_groups')
      .update({ name, updated_at: new Date().toISOString() })
      .eq('id', groupId)
      .select('*')
      .single()
    if (error || !data) return responseError(error?.message || 'Could not update this group.')
    await writeActionLog(client, requestId, action, 'ontology_subject_groups', groupId, before, data)
    return NextResponse.json({ data })
  }

  if (action === 'archive_subject_group') {
    const groupId = uuid(input.groupId)
    if (!groupId) return responseError('A valid group is required.')
    const { data: before, error: beforeError } = await client.from('ontology_subject_groups').select('*').eq('id', groupId).maybeSingle()
    if (beforeError || !before) return responseError(beforeError?.message || 'Group not found.', 404)
    const { data, error } = await client
      .from('ontology_subject_groups')
      .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', groupId)
      .select('*')
      .single()
    if (error || !data) return responseError(error?.message || 'Could not archive this group.')
    await client.from('ontology_rhythm_goals').update({ role: 'unassigned', status: 'archived', updated_at: new Date().toISOString() }).eq('subject_group_id', groupId)
    await writeActionLog(client, requestId, action, 'ontology_subject_groups', groupId, before, data)
    return NextResponse.json({ data })
  }

  if (action === 'replace_group_subjects') {
    const groupId = uuid(input.groupId)
    const subjectIds = Array.isArray(input.subjectIds) ? input.subjectIds.map(uuid).filter((id): id is string => Boolean(id)) : null
    if (!groupId || !subjectIds) return responseError('A valid group and subject list are required.')
    const { data: beforeRows, error: beforeError } = await client
      .from('ontology_subject_group_members')
      .select('subject_id')
      .eq('group_id', groupId)
    if (beforeError) return responseError(beforeError.message)
    const { error } = await client.rpc('replace_ontology_group_subjects', {
      target_group_id: groupId,
      next_subject_ids: subjectIds,
    })
    if (error) return responseError(error.message)
    const { data: afterRows, error: afterError } = await client
      .from('ontology_subject_group_members')
      .select('subject_id')
      .eq('group_id', groupId)
    if (afterError) return responseError(afterError.message)
    await writeActionLog(client, requestId, action, 'ontology_subject_groups', groupId, beforeRows, afterRows)
    return NextResponse.json({ data: afterRows ?? [] })
  }

  if (action === 'create_rhythm_goal') {
    const title = text(input.title)
    const role = validRole(input.role) ?? 'unassigned'
    const subjectGroupId = input.subjectGroupId == null ? null : uuid(input.subjectGroupId)
    if (!title || (input.subjectGroupId != null && !subjectGroupId)) return responseError('A valid rhythm goal is required.')
    const { data: inserted, error: insertError } = await client
      .from('ontology_rhythm_goals')
      .insert({ user_id: userId, title, description: text(input.description, 500), subject_group_id: subjectGroupId, role: 'unassigned' })
      .select('*')
      .single()
    if (insertError || !inserted) return responseError(insertError?.message || 'Could not create this rhythm goal.')

    let data = inserted
    if (role !== 'unassigned') {
      const { data: roleResult, error: roleError } = await client.rpc('set_ontology_rhythm_goal_role', {
        target_goal_id: inserted.id,
        next_role: role,
      })
      if (roleError) return responseError(roleError.message)
      data = Array.isArray(roleResult) ? roleResult[0] ?? inserted : roleResult ?? inserted
    }
    await writeActionLog(client, requestId, action, 'ontology_rhythm_goals', data.id, null, data)
    return NextResponse.json({ data })
  }

  if (action === 'set_rhythm_goal_role') {
    const goalId = uuid(input.goalId)
    const role = validRole(input.role)
    if (!goalId || !role) return responseError('A valid goal and role are required.')
    const { data: before, error: beforeError } = await client.from('ontology_rhythm_goals').select('*').eq('id', goalId).maybeSingle()
    if (beforeError || !before) return responseError(beforeError?.message || 'Rhythm goal not found.', 404)
    const { data: result, error } = await client.rpc('set_ontology_rhythm_goal_role', {
      target_goal_id: goalId,
      next_role: role,
    })
    if (error) return responseError(error.message)
    const data = Array.isArray(result) ? result[0] ?? before : result ?? before
    await writeActionLog(client, requestId, action, 'ontology_rhythm_goals', goalId, before, data)
    return NextResponse.json({ data })
  }

  if (action === 'set_maintenance_practice') {
    const subjectId = uuid(input.subjectId)
    const minutes = Number(input.minutesPerDay)
    if (!subjectId || !Number.isInteger(minutes) || minutes < 1 || minutes > 20) {
      return responseError('Maintenance must be 1–20 minutes for one of your subjects.')
    }
    const { data: before } = await client
      .from('ontology_maintenance_practices')
      .select('*')
      .eq('user_id', userId)
      .eq('subject_id', subjectId)
      .maybeSingle()
    const { data, error } = await client
      .from('ontology_maintenance_practices')
      .upsert({ user_id: userId, subject_id: subjectId, minutes_per_day: minutes, active: true, updated_at: new Date().toISOString() }, { onConflict: 'user_id,subject_id' })
      .select('*')
      .single()
    if (error || !data) return responseError(error?.message || 'Could not save this maintenance practice.')
    await writeActionLog(client, requestId, action, 'ontology_maintenance_practices', data.id, before, data)
    return NextResponse.json({ data })
  }

  if (action === 'deactivate_maintenance_practice') {
    const practiceId = uuid(input.practiceId)
    if (!practiceId) return responseError('A valid maintenance practice is required.')
    const { data: before, error: beforeError } = await client.from('ontology_maintenance_practices').select('*').eq('id', practiceId).maybeSingle()
    if (beforeError || !before) return responseError(beforeError?.message || 'Maintenance practice not found.', 404)
    const { data, error } = await client
      .from('ontology_maintenance_practices')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', practiceId)
      .select('*')
      .single()
    if (error || !data) return responseError(error?.message || 'Could not remove this maintenance practice.')
    await writeActionLog(client, requestId, action, 'ontology_maintenance_practices', practiceId, before, data)
    return NextResponse.json({ data })
  }

  return responseError('This Koko action is not supported.', 404)
}
