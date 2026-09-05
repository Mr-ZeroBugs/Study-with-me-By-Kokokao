import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getPublicSupabaseConfig } from '@/lib/supabase-config'

export const dynamic = 'force-dynamic'

type Context = { userId: string; client: SupabaseClient }
const SURFACES = new Set(['next_action', 'proactive_window', 'insight'])
const EVENTS = new Set(['accepted', 'dismissed', 'not_helpful'])

function clean(value: unknown, max: number) { return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '' }
function isUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) }
function error(message: string, status = 400) { return NextResponse.json({ error: message }, { status }) }

async function contextFrom(request: Request): Promise<Context | null> {
  const accessToken = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!accessToken) return null
  const { url, anonKey } = getPublicSupabaseConfig()
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${accessToken}` } } })
  const { data, error: authError } = await client.auth.getUser(accessToken)
  return authError || !data.user ? null : { userId: data.user.id, client }
}

function serialize(row: Record<string, unknown>) {
  return {
    id: String(row.id), requestId: String(row.request_id), surface: row.surface,
    recommendationKey: row.recommendation_key, eventType: row.event_type,
    ...(typeof row.subject === 'string' && row.subject ? { subject: row.subject } : {}), occurredAt: row.occurred_at,
  }
}

export async function GET(request: Request) {
  const context = await contextFrom(request)
  if (!context) return error('Sign in is required.', 401)
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString()
  const { data, error: fetchError } = await context.client.from('manager_feedback_events')
    .select('id, request_id, surface, recommendation_key, event_type, subject, occurred_at')
    .eq('user_id', context.userId).gte('occurred_at', since).order('occurred_at', { ascending: false }).limit(120)
  if (fetchError) return error('Feedback storage is not ready. Apply 011_manager_feedback_v0.sql first.', 503)
  return NextResponse.json({ events: (data ?? []).map((row) => serialize(row as Record<string, unknown>)) })
}

export async function POST(request: Request) {
  const context = await contextFrom(request)
  if (!context) return error('Sign in is required.', 401)
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return error('Invalid JSON request.')
  const requestId = clean(body.requestId, 64)
  const surface = clean(body.surface, 32)
  const eventType = clean(body.eventType, 32)
  const recommendationKey = clean(body.recommendationKey, 160)
  const subject = clean(body.subject, 80)
  if (!isUuid(requestId) || !SURFACES.has(surface) || !EVENTS.has(eventType) || !recommendationKey) return error('Invalid feedback event.')

  // This route is intentionally low-impact, but a bound still prevents a
  // looping client or extension from turning telemetry into an outage.
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString()
  const { count, error: countError } = await context.client.from('manager_feedback_events')
    .select('id', { count: 'exact', head: true }).eq('user_id', context.userId).gte('occurred_at', fiveMinutesAgo)
  if (countError) return error('Feedback storage is not ready. Apply 011_manager_feedback_v0.sql first.', 503)
  if ((count ?? 0) >= 30) {
    const { data: retry } = await context.client.from('manager_feedback_events')
      .select('id').eq('user_id', context.userId).eq('request_id', requestId).maybeSingle()
    if (!retry) return error('Too many feedback events. Try again shortly.', 429)
  }

  const { data, error: insertError } = await context.client.from('manager_feedback_events').upsert({
    user_id: context.userId, request_id: requestId, surface, recommendation_key: recommendationKey, event_type: eventType, subject: subject || null,
  }, { onConflict: 'user_id,request_id' }).select('id, request_id, surface, recommendation_key, event_type, subject, occurred_at').single()
  if (insertError || !data) return error(insertError?.message || 'Could not store feedback.', 503)
  return NextResponse.json({ event: serialize(data as Record<string, unknown>) })
}
