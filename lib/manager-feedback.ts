import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export type ManagerFeedbackSurface = 'next_action' | 'proactive_window' | 'insight'
export type ManagerFeedbackType = 'accepted' | 'dismissed' | 'not_helpful'
export type ManagerFeedbackEvent = {
  id: string
  requestId: string
  surface: ManagerFeedbackSurface
  recommendationKey: string
  eventType: ManagerFeedbackType
  subject?: string
  occurredAt: string
}

const MAX_EVENTS = 120
const feedbackMemory = new Map<string, ManagerFeedbackEvent[]>()
function storageKey(user: User | null) { return user?.id ?? 'guest' }
function randomId() { return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `feedback_${Date.now()}_${Math.random().toString(16).slice(2)}` }

function normalize(value: unknown): ManagerFeedbackEvent | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const surface = item.surface
  const eventType = item.eventType
  const id = typeof item.id === 'string' ? item.id : ''
  const requestId = typeof item.requestId === 'string' ? item.requestId : ''
  const recommendationKey = typeof item.recommendationKey === 'string' ? item.recommendationKey : ''
  const occurredAt = typeof item.occurredAt === 'string' ? item.occurredAt : ''
  if (!id || !requestId || !recommendationKey || !occurredAt || (surface !== 'next_action' && surface !== 'proactive_window' && surface !== 'insight') || (eventType !== 'accepted' && eventType !== 'dismissed' && eventType !== 'not_helpful')) return null
  return { id, requestId, surface, recommendationKey, eventType, ...(typeof item.subject === 'string' && item.subject.trim() ? { subject: item.subject.trim().slice(0, 80) } : {}), occurredAt }
}

function localFeedback(user: User | null) {
  return feedbackMemory.get(storageKey(user)) ?? []
}

function saveLocalFeedback(user: User | null, events: ManagerFeedbackEvent[]) {
  feedbackMemory.set(storageKey(user), events.slice(-MAX_EVENTS))
}

function mergeFeedback(...sets: ManagerFeedbackEvent[][]) {
  return Array.from(new Map(sets.flat().map((event) => [event.requestId, event])).values())
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).slice(-MAX_EVENTS)
}

async function token() {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

export async function loadManagerFeedback(user: User | null): Promise<ManagerFeedbackEvent[]> {
  const local = localFeedback(user)
  if (!user) return local
  try {
    const accessToken = await token()
    if (!accessToken) return local
    const response = await fetch('/api/manager/feedback', { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!response.ok) return local
    const payload = await response.json().catch(() => ({})) as { events?: unknown[] }
    const remote = Array.isArray(payload.events) ? payload.events.map(normalize).filter((event): event is ManagerFeedbackEvent => Boolean(event)) : []
    const canonical = mergeFeedback(remote)
    saveLocalFeedback(user, canonical)
    return canonical
  } catch { return local }
}

export async function recordManagerFeedback(user: User | null, input: Omit<ManagerFeedbackEvent, 'id' | 'requestId' | 'occurredAt'>) {
  const event: ManagerFeedbackEvent = { id: randomId(), requestId: randomId(), ...input, occurredAt: new Date().toISOString() }
  saveLocalFeedback(user, mergeFeedback(localFeedback(user), [event]))
  if (user) {
    try {
      const accessToken = await token()
      if (accessToken) await fetch('/api/manager/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(event),
      })
    } catch {
      // Feedback never blocks the learner's selected action.
    }
  }
  return event
}

/** A dismissal only changes today's suggestion; it never hides a task itself. */
export function feedbackSuppressesToday(events: ManagerFeedbackEvent[], surface: ManagerFeedbackSurface, recommendationKey: string, now: Date) {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return events.some((event) => event.surface === surface && event.recommendationKey === recommendationKey && (event.eventType === 'dismissed' || event.eventType === 'not_helpful') && Date.parse(event.occurredAt) >= todayStart)
}
