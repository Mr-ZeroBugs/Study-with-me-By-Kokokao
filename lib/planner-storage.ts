import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type TaskPriority = 1 | 2 | 3

export type PlannerTask = {
  id: string
  title: string
  subject: string
  dueDate: string
  estimatedMinutes: number
  priority: TaskPriority
  completed: boolean
  createdAt: string
}

export type LifeGoal = {
  id: string
  title: string
  description: string
  targetDate: string
  createdAt: string
}

export type GoalStep = {
  id: string
  goalId: string
  title: string
  dueDate: string
  completed: boolean
  orderIndex: number
}

export type PlannerEventType = 'competition' | 'project' | 'exam' | 'important'

export type PlannerEvent = {
  id: string
  title: string
  eventDate: string
  type: PlannerEventType
  notes: string
  createdAt: string
}

export type PlannerData = {
  tasks: PlannerTask[]
  goals: LifeGoal[]
  steps: GoalStep[]
  events: PlannerEvent[]
}

const STORAGE_KEY = 'study_timer_planner_v1'
const emptyPlannerData = (): PlannerData => ({ tasks: [], goals: [], steps: [], events: [] })

export function createPlannerId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function loadLocalPlannerData(): PlannerData {
  if (typeof window === 'undefined') return emptyPlannerData()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyPlannerData()
    const parsed = JSON.parse(raw)
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      goals: Array.isArray(parsed.goals) ? parsed.goals : [],
      steps: Array.isArray(parsed.steps) ? parsed.steps : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
    }
  } catch {
    return emptyPlannerData()
  }
}

export function saveLocalPlannerData(data: PlannerData) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch (error) {
    console.error('Failed to save planner data:', error)
  }
}

function mergeById<T extends { id: string }>(cloud: T[], local: T[]) {
  return Array.from(new Map([...cloud, ...local].map((item) => [item.id, item])).values())
}

export async function loadPlannerData(user: User | null): Promise<PlannerData> {
  const local = loadLocalPlannerData()
  if (!user) return local

  try {
    const [tasksResponse, goalsResponse, stepsResponse, eventsResponse] = await Promise.all([
      supabase.from('planner_tasks').select('*').eq('user_id', user.id),
      supabase.from('life_goals').select('*').eq('user_id', user.id),
      supabase.from('goal_steps').select('*').eq('user_id', user.id),
      supabase.from('planner_events').select('*').eq('user_id', user.id),
    ])

    if (tasksResponse.error || goalsResponse.error || stepsResponse.error || eventsResponse.error) return local

    const cloud: PlannerData = {
      tasks: (tasksResponse.data ?? []).map((row) => ({
        id: row.id, title: row.title, subject: row.subject ?? 'General', dueDate: row.due_date ?? '',
        estimatedMinutes: row.estimated_minutes ?? 25, priority: row.priority ?? 2, completed: row.completed ?? false, createdAt: row.created_at,
      })),
      goals: (goalsResponse.data ?? []).map((row) => ({
        id: row.id, title: row.title, description: row.description ?? '', targetDate: row.target_date ?? '', createdAt: row.created_at,
      })),
      steps: (stepsResponse.data ?? []).map((row) => ({
        id: row.id, goalId: row.goal_id, title: row.title, dueDate: row.due_date ?? '', completed: row.completed ?? false, orderIndex: row.order_index ?? 0,
      })),
      events: (eventsResponse.data ?? []).map((row) => ({
        id: row.id, title: row.title, eventDate: row.event_date, type: row.type, notes: row.notes ?? '', createdAt: row.created_at,
      })),
    }

    const merged: PlannerData = {
      tasks: mergeById(cloud.tasks, local.tasks),
      goals: mergeById(cloud.goals, local.goals),
      steps: mergeById(cloud.steps, local.steps),
      events: mergeById(cloud.events, local.events),
    }
    saveLocalPlannerData(merged)
    return merged
  } catch (error) {
    console.error('Failed to load planner data:', error)
    return local
  }
}

export async function syncPlannerData(user: User | null, data: PlannerData) {
  if (!user) return
  try {
    await Promise.all([
      data.tasks.length ? supabase.from('planner_tasks').upsert(data.tasks.map((task) => ({
        id: task.id, user_id: user.id, title: task.title, subject: task.subject, due_date: task.dueDate || null,
        estimated_minutes: task.estimatedMinutes, priority: task.priority, completed: task.completed, created_at: task.createdAt,
      }))) : Promise.resolve(),
      data.goals.length ? supabase.from('life_goals').upsert(data.goals.map((goal) => ({
        id: goal.id, user_id: user.id, title: goal.title, description: goal.description, target_date: goal.targetDate || null, created_at: goal.createdAt,
      }))) : Promise.resolve(),
      data.steps.length ? supabase.from('goal_steps').upsert(data.steps.map((step) => ({
        id: step.id, user_id: user.id, goal_id: step.goalId, title: step.title, due_date: step.dueDate || null,
        completed: step.completed, order_index: step.orderIndex,
      }))) : Promise.resolve(),
      data.events.length ? supabase.from('planner_events').upsert(data.events.map((event) => ({
        id: event.id, user_id: user.id, title: event.title, event_date: event.eventDate, type: event.type, notes: event.notes, created_at: event.createdAt,
      }))) : Promise.resolve(),
    ])
  } catch (error) {
    console.error('Failed to sync planner data:', error)
  }
}

export async function removePlannerRecord(user: User | null, table: 'planner_tasks' | 'life_goals' | 'goal_steps' | 'planner_events', id: string) {
  if (!user) return
  try {
    await supabase.from(table).delete().eq('id', id).eq('user_id', user.id)
  } catch (error) {
    console.error('Failed to delete planner record:', error)
  }
}
