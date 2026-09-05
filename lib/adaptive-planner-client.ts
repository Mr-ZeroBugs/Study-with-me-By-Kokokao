import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { PlannerBehaviorEvent, PlannerBehaviorType } from '@/lib/adaptive-planner'

const STORAGE_KEY = 'koko_planner_behavior_v1'

function key(user: User | null) { return user?.id ? `${STORAGE_KEY}_${user.id}` : STORAGE_KEY }
function eventId() { return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `behavior_${Date.now()}_${Math.random().toString(16).slice(2)}` }

function loadLocal(user: User | null): PlannerBehaviorEvent[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(key(user)) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((event): event is PlannerBehaviorEvent => event && typeof event.id === 'string' && (event.type === 'next_action_accepted' || event.type === 'task_completed') && typeof event.subject === 'string' && typeof event.occurredAt === 'string').slice(-250) : []
  } catch { return [] }
}

function saveLocal(user: User | null, events: PlannerBehaviorEvent[]) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(key(user), JSON.stringify(events.slice(-250))) } catch {}
}

function mergeEvents(...sets: PlannerBehaviorEvent[][]) {
  return Array.from(new Map(sets.flat().map((event) => [event.id, event])).values())
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    .slice(-250)
}

export async function loadPlannerBehaviorEvents(user: User | null) {
  const local = loadLocal(user)
  if (!user) return local
  try {
    const { data, error } = await supabase
      .from('user_planner_behavior_events')
      .select('id, event_type, subject, task_id, occurred_at')
      .eq('user_id', user.id)
      .order('occurred_at', { ascending: false })
      .limit(250)
    if (error || !data) return local
    const cloud = data.flatMap((row): PlannerBehaviorEvent[] => row.event_type === 'next_action_accepted' || row.event_type === 'task_completed'
      ? [{ id: row.id, type: row.event_type, subject: row.subject || 'General', ...(typeof row.task_id === 'string' ? { taskId: row.task_id } : {}), occurredAt: row.occurred_at }]
      : [])
    const merged = mergeEvents(local, cloud)
    saveLocal(user, merged)
    return merged
  } catch { return local }
}

export async function recordPlannerBehaviorEvent(user: User | null, input: { type: PlannerBehaviorType; subject: string; taskId?: string }) {
  const event: PlannerBehaviorEvent = { id: eventId(), type: input.type, subject: input.subject.trim() || 'General', ...(input.taskId ? { taskId: input.taskId } : {}), occurredAt: new Date().toISOString() }
  const local = mergeEvents(loadLocal(user), [event])
  saveLocal(user, local)
  if (user) {
    try {
      await supabase.from('user_planner_behavior_events').insert({ id: event.id, user_id: user.id, event_type: event.type, subject: event.subject, task_id: event.taskId ?? null, occurred_at: event.occurredAt })
    } catch {}
  }
  return event
}
