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
  sourceWorkspaceId?: string
  sourceWorkspaceName?: string
}

export type LifeGoal = {
  id: string
  title: string
  description: string
  targetDate: string
  subjects: string[]
  shelfPosition?: number
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
  sourceWorkspaceId?: string
  sourceWorkspaceName?: string
}

export type PlannerData = {
  tasks: PlannerTask[]
  goals: LifeGoal[]
  steps: GoalStep[]
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

const STORAGE_KEY = 'study_timer_planner_v1'
const SHARED_STORAGE_KEY = 'study_timer_shared_planner_v1'
const emptyPlannerData = (): PlannerData => ({ tasks: [], goals: [], steps: [], events: [] })

function scopedStorageKey(scope?: User | null) {
  return scope?.id ? `${STORAGE_KEY}_${scope.id}` : STORAGE_KEY
}

function sharedStorageKey(workspaceId: string) {
  return `${SHARED_STORAGE_KEY}_${workspaceId}`
}

function personalPlannerData(data: PlannerData): PlannerData {
  return {
    ...data,
    tasks: data.tasks.filter((task) => !task.sourceWorkspaceId),
    events: data.events.filter((event) => !event.sourceWorkspaceId),
  }
}

function normalizeGoalSubjects(value: unknown) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim())))
}

export function createPlannerId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function loadLocalPlannerData(scope?: User | null): PlannerData {
  if (typeof window === 'undefined') return emptyPlannerData()
  try {
    const raw = localStorage.getItem(scopedStorageKey(scope))
    if (!raw) return emptyPlannerData()
    const parsed = JSON.parse(raw)
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks.filter((task: Partial<PlannerTask> | null) => !task?.sourceWorkspaceId) : [],
      goals: Array.isArray(parsed.goals) ? parsed.goals.map((goal: Partial<LifeGoal>) => ({
        ...goal,
        subjects: normalizeGoalSubjects(goal.subjects),
        shelfPosition: Number.isInteger(goal.shelfPosition) ? goal.shelfPosition : undefined,
      })) : [],
      steps: Array.isArray(parsed.steps) ? parsed.steps : [],
      events: Array.isArray(parsed.events) ? parsed.events.filter((event: Partial<PlannerEvent> | null) => !event?.sourceWorkspaceId) : [],
    }
  } catch {
    return emptyPlannerData()
  }
}

export function saveLocalPlannerData(data: PlannerData, scope?: User | null) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(scopedStorageKey(scope), JSON.stringify(personalPlannerData(data)))
  } catch (error) {
    console.error('Failed to save planner data:', error)
  }
}

function normalizePlannerRows(tasks: unknown, events: unknown): PlannerData {
  return {
    tasks: Array.isArray(tasks) ? tasks : [],
    goals: [],
    steps: [],
    events: Array.isArray(events) ? events : [],
  }
}

export function loadLocalSharedPlannerData(workspaceId: string): PlannerData {
  if (typeof window === 'undefined') return emptyPlannerData()
  try {
    const raw = localStorage.getItem(sharedStorageKey(workspaceId))
    if (!raw) return emptyPlannerData()
    const parsed = JSON.parse(raw)
    return normalizePlannerRows(parsed.tasks, parsed.events)
  } catch {
    return emptyPlannerData()
  }
}

export function saveLocalSharedPlannerData(workspaceId: string, data: PlannerData) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(sharedStorageKey(workspaceId), JSON.stringify(normalizePlannerRows(data.tasks, data.events)))
  } catch (error) {
    console.error('Failed to save shared planner data:', error)
  }
}

function mergeById<T extends { id: string }>(cloud: T[], local: T[]) {
  return Array.from(new Map([...cloud, ...local].map((item) => [item.id, item])).values())
}

export async function loadPlannerData(user: User | null): Promise<PlannerData> {
  const local = loadLocalPlannerData(user)
  if (!user) return local

  try {
    const sharedWorkspaces = await loadSharedWorkspaces(user)
    const workspaceIds = sharedWorkspaces.map((workspace) => workspace.id)
    const workspaceById = new Map(sharedWorkspaces.map((workspace) => [workspace.id, workspace]))
    const [tasksResponse, goalsResponse, stepsResponse, eventsResponse] = await Promise.all([
      supabase.from('planner_tasks').select('*').eq('user_id', user.id),
      supabase.from('life_goals').select('*').eq('user_id', user.id),
      supabase.from('goal_steps').select('*').eq('user_id', user.id),
      supabase.from('planner_events').select('*').eq('user_id', user.id),
    ])

    if (tasksResponse.error || goalsResponse.error || stepsResponse.error || eventsResponse.error) return local

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
      goals: (goalsResponse.data ?? []).map((row) => ({
        id: row.id, title: row.title, description: row.description ?? '', targetDate: row.target_date ?? '', subjects: normalizeGoalSubjects(row.subjects), shelfPosition: Number.isInteger(row.shelf_position) ? row.shelf_position : undefined, createdAt: row.created_at,
      })),
      steps: (stepsResponse.data ?? []).map((row) => ({
        id: row.id, goalId: row.goal_id, title: row.title, dueDate: row.due_date ?? '', completed: row.completed ?? false, orderIndex: row.order_index ?? 0,
      })),
      events: [...(eventsResponse.data ?? []).filter((row) => row.workspace_id == null).map((row) => plannerEventFromRow(row)), ...sharedEvents],
    }

    // Cloud is the source of truth for records that already exist remotely.
    // The previous order let a stale local cache overwrite a newer server
    // value (for example, completing a task from the LINE bot), so the web
    // page would resurrect the task as incomplete on its next load.
    const merged: PlannerData = {
      tasks: mergeById(local.tasks, cloud.tasks),
      goals: mergeById(local.goals, cloud.goals),
      steps: mergeById(local.steps, cloud.steps),
      events: mergeById(local.events, cloud.events),
    }
    saveLocalPlannerData(merged, user)
    return merged
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
        id: row.id, title: row.title, subject: row.subject ?? 'General', dueDate: row.due_date ?? '',
        estimatedMinutes: row.estimated_minutes ?? 25, priority: row.priority ?? 2, completed: row.completed ?? false, createdAt: row.created_at,
      })),
      (eventsResponse.data ?? []).map((row) => ({
        id: row.id, title: row.title, eventDate: row.event_date, type: row.type, notes: row.notes ?? '', createdAt: row.created_at,
      })),
    )
    const merged: PlannerData = {
      tasks: mergeById(local.tasks, cloud.tasks),
      goals: [],
      steps: [],
      events: mergeById(local.events, cloud.events),
    }
    saveLocalSharedPlannerData(workspaceId, merged)
    return merged
  } catch (error) {
    console.error('Failed to load shared planner data:', error)
    return local
  }
}

export async function syncSharedPlannerData(user: User | null, workspaceId: string, data: PlannerData) {
  if (!user) return
  try {
    await Promise.all([
      data.tasks.length ? supabase.from('planner_tasks').upsert(data.tasks.map((task) => ({
        id: task.id, user_id: user.id, workspace_id: workspaceId, title: task.title, subject: task.subject,
        due_date: task.dueDate || null, estimated_minutes: task.estimatedMinutes, priority: task.priority,
        completed: task.completed, created_at: task.createdAt,
      }))) : Promise.resolve(),
      data.events.length ? supabase.from('planner_events').upsert(data.events.map((event) => ({
        id: event.id, user_id: user.id, workspace_id: workspaceId, title: event.title, event_date: event.eventDate,
        type: event.type, notes: event.notes, created_at: event.createdAt,
      }))) : Promise.resolve(),
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
    const goalRows = data.goals.map((goal) => ({
      id: goal.id, user_id: user.id, title: goal.title, description: goal.description, target_date: goal.targetDate || null,
      subjects: normalizeGoalSubjects(goal.subjects), shelf_position: Number.isInteger(goal.shelfPosition) ? goal.shelfPosition : null, created_at: goal.createdAt,
    }))
    const goalRowsWithoutExtras = goalRows.map(({ subjects: _subjects, shelf_position: _shelfPosition, ...goal }) => goal)
    const goalSync = data.goals.length
      ? supabase.from('life_goals').upsert(goalRows).then(({ error }) => {
        // Older databases may not have the optional playlist/shelf columns yet.
        // Keep the core goal syncing while the UI still stores the extras locally.
        if (error) return supabase.from('life_goals').upsert(goalRowsWithoutExtras)
        return null
      })
      : Promise.resolve()
    await Promise.all([
      personalTasks.length ? supabase.from('planner_tasks').upsert(personalTasks.map((task) => ({
        id: task.id, user_id: user.id, title: task.title, subject: task.subject, due_date: task.dueDate || null,
        estimated_minutes: task.estimatedMinutes, priority: task.priority, completed: task.completed, created_at: task.createdAt,
      }))) : Promise.resolve(),
      goalSync,
      data.steps.length ? supabase.from('goal_steps').upsert(data.steps.map((step) => ({
        id: step.id, user_id: user.id, goal_id: step.goalId, title: step.title, due_date: step.dueDate || null,
        completed: step.completed, order_index: step.orderIndex,
      }))) : Promise.resolve(),
      personalEvents.length ? supabase.from('planner_events').upsert(personalEvents.map((event) => ({
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
