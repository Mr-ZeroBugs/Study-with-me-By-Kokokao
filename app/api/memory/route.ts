import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { isSafeMemoryContent, memoryContentKey, type MemoryKind, type MemoryType } from '@/lib/personal-memory'
import { getPublicSupabaseConfig } from '@/lib/supabase-config'

const { url: supabaseUrl, anonKey: supabaseAnonKey } = getPublicSupabaseConfig()

type Context = { userId: string; client: SupabaseClient }

function text(value: unknown, max = 360) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

async function contextFrom(request: Request): Promise<Context | null> {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return null
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data, error } = await client.auth.getUser(token)
  return error || !data.user ? null : { userId: data.user.id, client }
}

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

function serialize(item: Record<string, unknown>) {
  return {
    id: String(item.id), kind: item.kind, status: item.status, content: item.content,
    source: item.source, confidence: Number(item.confidence ?? 0.5),
    memoryType: item.memory_type === 'observed' || item.memory_type === 'temporary' || item.memory_type === 'sensitive' ? item.memory_type : 'explicit',
    ...(typeof item.evidence === 'string' && item.evidence.trim() ? { evidence: item.evidence.trim() } : {}),
    ...(typeof item.expires_at === 'string' ? { expiresAt: item.expires_at } : {}),
    createdAt: item.created_at, updatedAt: item.updated_at,
  }
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[index] : Math.round((sorted[index - 1] + sorted[index]) / 2)
}

function temporaryExpiry(value: unknown) {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN
  const now = Date.now()
  // Temporary notes must have a real, bounded lifetime. This avoids stale
  // observations quietly becoming permanent context.
  if (!Number.isFinite(parsed) || parsed <= now || parsed > now + 90 * 86_400_000) return null
  return new Date(parsed).toISOString()
}

async function stageObservedMemoryCandidate(client: SupabaseClient, userId: string) {
  // This remains deterministic and intentionally modest: it proposes a
  // pattern for review, never profiles the user or changes any plan.
  const { data: settings } = await client.from('user_memory_settings').select('enabled').eq('user_id', userId).maybeSingle()
  if (settings?.enabled === false) return
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const { data: rows, error } = await client.from('study_intervals')
    .select('duration_seconds, started_at, mode').eq('user_id', userId).eq('mode', 'focus').gte('started_at', since).order('started_at', { ascending: false }).limit(24)
  if (error || !rows) return
  const minutes = rows.map((row) => Math.round(Number(row.duration_seconds) / 60)).filter((value) => value >= 10 && value <= 180)
  if (minutes.length < 6) return
  const typical = median(minutes)
  const content = `Your recorded focus blocks often land around ${typical} minutes.`
  const contentKey = memoryContentKey(content)
  const { data: existing, error: existingError } = await client.from('user_memory_items').select('id').eq('user_id', userId).eq('content_key', contentKey).maybeSingle()
  if (existingError || existing) return
  const expiresAt = new Date(Date.now() + 60 * 86_400_000).toISOString()
  const insert = await client.from('user_memory_items').insert({
    user_id: userId, kind: 'learning', content, content_key: contentKey, source: 'system', status: 'proposed', confidence: 0.65,
    memory_type: 'observed', evidence: `Based on ${minutes.length} focus sessions recorded in the last 30 days.`, expires_at: expiresAt,
  })
  // Memory V1 is additive. A missing column must not make the Settings modal
  // fail on deployments that have not applied the new migration yet.
  if (insert.error && !/memory_type|evidence|expires_at|schema cache|column/i.test(insert.error.message)) console.info('Observed memory staging failed:', insert.error.message)
}

export async function GET(request: Request) {
  const context = await contextFrom(request)
  if (!context) return error('Sign in is required.', 401)
  const { client, userId } = context
  await stageObservedMemoryCandidate(client, userId)
  const [settingsResult, memoriesResult] = await Promise.all([
    client.from('user_memory_settings').select('enabled, write_approval_required').eq('user_id', userId).maybeSingle(),
    client.from('user_memory_items').select('*').in('status', ['active', 'proposed']).order('updated_at', { ascending: false }).limit(30),
  ])
  if (settingsResult.error || memoriesResult.error) return error('Personal memory is not ready yet. Apply 007_personal_memory_v0.sql first.', 503)
  const items = (memoriesResult.data ?? []).map(serialize)
  return NextResponse.json({
    settings: { enabled: settingsResult.data?.enabled ?? true, writeApprovalRequired: settingsResult.data?.write_approval_required ?? true },
    active: items.filter((item) => item.status === 'active'),
    proposed: items.filter((item) => item.status === 'proposed'),
  })
}

export async function POST(request: Request) {
  const context = await contextFrom(request)
  if (!context) return error('Sign in is required.', 401)
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return error('Invalid JSON request.')
  const { client, userId } = context
  const action = body.action

  if (action === 'propose') {
    const content = text(body.content)
    const kind: MemoryKind | null = body.kind === 'preference' || body.kind === 'learning' ? body.kind : null
    const memoryType: MemoryType | null = body.memoryType === 'temporary' || body.memoryType === 'explicit' ? body.memoryType : body.memoryType === 'sensitive' ? null : 'explicit'
    if (!kind || !memoryType || !content || !isSafeMemoryContent(content)) return error('This is not a safe memory proposal.')
    const { data: settings } = await client.from('user_memory_settings').select('enabled, write_approval_required').eq('user_id', userId).maybeSingle()
    if (settings?.enabled === false) return error('Personal memory is turned off.', 403)
    const status = settings?.write_approval_required === false ? 'active' : 'proposed'
    const expiresAt = memoryType === 'temporary' ? temporaryExpiry(body.expiresAt) : null
    if (memoryType === 'temporary' && !expiresAt) return error('Temporary memory needs an expiry within 90 days.')
    const memoryRow = {
      user_id: userId, kind, content, content_key: memoryContentKey(content), source: 'web', status,
      confidence: 0.9, memory_type: memoryType, expires_at: expiresAt, updated_at: new Date().toISOString(), approved_at: status === 'active' ? new Date().toISOString() : null,
    }
    let { data, error: insertError } = await client.from('user_memory_items').upsert(memoryRow, { onConflict: 'user_id,content_key' }).select('*').single()
    if (insertError && /memory_type|expires_at|schema cache|column/i.test(insertError.message)) {
      const { memory_type: _memoryType, expires_at: _expiresAt, ...legacyRow } = memoryRow
      ;({ data, error: insertError } = await client.from('user_memory_items').upsert(legacyRow, { onConflict: 'user_id,content_key' }).select('*').single())
    }
    if (insertError || !data) return error(insertError?.message || 'Could not save this memory proposal.')
    return NextResponse.json({ data: serialize(data) })
  }

  if (action === 'review') {
    const id = text(body.id, 64)
    const decision = body.decision === 'approve' ? 'approve' : body.decision === 'reject' ? 'reject' : null
    if (!id || !decision) return error('A memory and decision are required.')
    const next = decision === 'approve'
      ? { status: 'active', approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      : { status: 'rejected', rejected_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    const { data, error: updateError } = await client.from('user_memory_items').update(next).eq('id', id).eq('status', 'proposed').select('*').single()
    if (updateError || !data) return error(updateError?.message || 'Memory proposal not found.', 404)
    return NextResponse.json({ data: serialize(data) })
  }

  if (action === 'settings') {
    const enabled = typeof body.enabled === 'boolean' ? body.enabled : true
    const writeApprovalRequired = typeof body.writeApprovalRequired === 'boolean' ? body.writeApprovalRequired : true
    const { data, error: settingsError } = await client.from('user_memory_settings').upsert({ user_id: userId, enabled, write_approval_required: writeApprovalRequired, updated_at: new Date().toISOString() }).select('*').single()
    if (settingsError || !data) return error(settingsError?.message || 'Could not update memory settings.')
    return NextResponse.json({ data: { enabled: data.enabled, writeApprovalRequired: data.write_approval_required } })
  }

  if (action === 'update') {
    const id = text(body.id, 64)
    const content = text(body.content)
    const kind: MemoryKind | null = body.kind === 'preference' || body.kind === 'learning' ? body.kind : null
    if (!id || !kind || !content || !isSafeMemoryContent(content)) return error('This is not a safe memory update.')
    const { data: existing, error: existingError } = await client.from('user_memory_items').select('id, status').eq('id', id).maybeSingle()
    if (existingError || !existing || existing.status !== 'active') return error(existingError?.message || 'Approved memory not found.', 404)
    const updatedRow = { kind, content, content_key: memoryContentKey(content), source: 'web', confidence: 0.9, memory_type: 'explicit', evidence: null, expires_at: null, updated_at: new Date().toISOString() }
    let { data, error: updateError } = await client.from('user_memory_items').update(updatedRow).eq('id', id).select('*').single()
    if (updateError && /memory_type|evidence|expires_at|schema cache|column/i.test(updateError.message)) {
      const { memory_type: _memoryType, evidence: _evidence, expires_at: _expiresAt, ...legacyRow } = updatedRow
      ;({ data, error: updateError } = await client.from('user_memory_items').update(legacyRow).eq('id', id).select('*').single())
    }
    if (updateError || !data) return error(updateError?.message || 'Could not update this memory.')
    return NextResponse.json({ data: serialize(data) })
  }

  if (action === 'delete') {
    const id = text(body.id, 64)
    if (!id) return error('A memory is required.')
    const { data, error: deleteError } = await client.from('user_memory_items').delete().eq('id', id).select('id').maybeSingle()
    if (deleteError || !data) return error(deleteError?.message || 'Memory not found.', 404)
    return NextResponse.json({ data: { id: data.id } })
  }

  return error('This memory action is not supported.', 404)
}
