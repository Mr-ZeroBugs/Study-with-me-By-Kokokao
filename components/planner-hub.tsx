'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, Check, Circle, Plus, Sparkles, Trash2 } from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import { getLocalDateKey } from '../lib/storage'
import { TaskNotebook } from './task-notebook'
import {
  createPlannerId,
  loadSharedPlannerData,
  loadPlannerData,
  removeSharedPlannerRecord,
  removePlannerRecord,
  saveLocalSharedPlannerData,
  saveLocalPlannerData,
  syncSharedPlannerEvent,
  syncSharedPlannerTask,
  syncPlannerEvent,
  syncPlannerTask,
  type PlannerData,
  type PlannerEvent,
  type PlannerEventType,
  type PlannerTask,
  type SharedWorkspace,
  type SharedWorkspaceMember,
  type TaskPriority,
} from '../lib/planner-storage'
import { createDefaultKokoRhythmPlan, loadKokoRhythmPlan, rhythmRoleForSubject, saveKokoRhythmPlan, type KokoRhythmPlan } from '../lib/rhythm-storage'
import { loadRhythmPlanFromOntology } from '../lib/rhythm-ontology'
import { ensureOntologySubject } from '../lib/ontology-client'
import { findExactOpenDuplicate, prepareTaskInput } from '../lib/task-intelligence'
import { adaptiveSubjectBoost, buildAdaptiveSignals, type AdaptiveSignals, type PlannerBehaviorEvent } from '../lib/adaptive-planner'
import { loadPlannerBehaviorEvents, recordPlannerBehaviorEvent } from '../lib/adaptive-planner-client'

const emptyData: PlannerData = { tasks: [], events: [] }
const eventLabels: Record<PlannerEventType, string> = { competition: 'competition', project: 'project', exam: 'exam', important: 'important' }
export type PlannerSection = 'all' | 'planner' | 'tasks' | 'events'

function daysUntil(dateKey: string) {
  if (!dateKey) return 999
  const today = new Date(`${getLocalDateKey()}T00:00:00`)
  const due = new Date(`${dateKey}T00:00:00`)
  return Math.round((due.getTime() - today.getTime()) / 86_400_000)
}

function urgency(task: PlannerTask) {
  const days = daysUntil(task.dueDate)
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, tone: 'late' }
  if (days === 0) return { label: 'due today', tone: 'late' }
  if (days <= 2) return { label: `${days}d left`, tone: 'urgent' }
  if (days <= 7) return { label: `${days}d left`, tone: 'soon' }
  return { label: task.dueDate ? `${days}d left` : 'no deadline', tone: 'calm' }
}

// Deadlines lead the sort. Koko Rhythm roles break a near-tie when configured;
// the old 1–3 priority remains a safe fallback for users without a rhythm yet.
const NO_DEADLINE_DAYS = 100_000
const PRIORITY_TIE_WINDOW_DAYS = 1
function rhythmRank(task: PlannerTask, plan: KokoRhythmPlan | null) {
  const role = rhythmRoleForSubject(task.subject, plan)
  return role === 'major' ? 0 : role === 'minor' ? 1 : role === 'maintenance' ? 2 : 3
}
function compareTaskUrgency(a: PlannerTask, b: PlannerTask, plan: KokoRhythmPlan | null, signals: AdaptiveSignals) {
  const aDays = a.dueDate ? daysUntil(a.dueDate) : NO_DEADLINE_DAYS
  const bDays = b.dueDate ? daysUntil(b.dueDate) : NO_DEADLINE_DAYS
  const deadlineDifference = aDays - bDays
  if (Math.abs(deadlineDifference) > PRIORITY_TIE_WINDOW_DAYS) return deadlineDifference
  if (plan) {
    const rhythmDifference = rhythmRank(a, plan) - rhythmRank(b, plan)
    if (rhythmDifference !== 0) return rhythmDifference
  }
  const adaptiveDifference = adaptiveSubjectBoost(b.subject, signals) - adaptiveSubjectBoost(a.subject, signals)
  if (adaptiveDifference !== 0) return adaptiveDifference
  if (a.priority !== b.priority) return a.priority - b.priority
  return deadlineDifference
}

type PlannerHubProps = {
  user: User | null
  subjects: string[]
  section?: PlannerSection
  workspaces: SharedWorkspace[]
  workspaceId: string | null
  onWorkspaceChange: (workspaceId: string | null) => void
  onCreateWorkspace: (name: string) => Promise<void>
  onJoinWorkspace: (inviteCode: string) => Promise<void>
  onLeaveWorkspace: (workspaceId: string) => Promise<void>
  onDeleteWorkspace: (workspaceId: string) => Promise<void>
  workspaceMembers: SharedWorkspaceMember[]
  workspaceMembersLoading?: boolean
  workspaceLoading?: boolean
  workspaceError?: string | null
  onUserChange?: (user: User | null) => void
}

export function PlannerHub({
  user,
  subjects,
  section = 'all',
  workspaces,
  workspaceId,
  onWorkspaceChange,
  onCreateWorkspace,
  onJoinWorkspace,
  onLeaveWorkspace,
  onDeleteWorkspace,
  workspaceMembers,
  workspaceMembersLoading = false,
  workspaceLoading = false,
  workspaceError = null,
  onUserChange,
}: PlannerHubProps) {
  const [data, setData] = useState<PlannerData>(emptyData)
  const [rhythmPlan, setRhythmPlan] = useState<KokoRhythmPlan | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskSubject, setTaskSubject] = useState('General')
  const [taskDue, setTaskDue] = useState('')
  const [taskMinutes, setTaskMinutes] = useState(30)
  const [taskPriority, setTaskPriority] = useState<TaskPriority>(2)
  const [taskHint, setTaskHint] = useState('')
  const [behaviorEvents, setBehaviorEvents] = useState<PlannerBehaviorEvent[]>([])
  const [eventTitle, setEventTitle] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [eventType, setEventType] = useState<PlannerEventType>('important')
  const persistenceQueueRef = useRef<Promise<void>>(Promise.resolve())
  const activeWorkspace = useMemo(() => workspaces.find((workspace) => workspace.id === workspaceId) ?? null, [workspaces, workspaceId])

  const enqueuePersistence = useCallback((write: () => Promise<void>) => {
    const next = persistenceQueueRef.current.catch(() => {}).then(write)
    persistenceQueueRef.current = next
  }, [])

  useEffect(() => {
    setData(emptyData)
    setLoaded(false)
    const today = getLocalDateKey()
    setTaskDue((current) => current || today)
    setEventDate((current) => current || today)
    let active = true
    let loading = false

    const refresh = async () => {
      if (loading) return
      loading = true
      try {
        const next = workspaceId && user
          ? await loadSharedPlannerData(user, workspaceId)
          : await loadPlannerData(user)
        if (!active) return
        setData(next)
        setLoaded(true)
      } finally {
        loading = false
      }
    }

    void refresh()

    // LINE actions happen outside this tab. Refresh when the user returns to
    // the page, and poll while visible so an already-open page catches the
    // update without requiring a manual reload.
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener('focus', refreshIfVisible)
    document.addEventListener('visibilitychange', refreshIfVisible)
    const interval = window.setInterval(refreshIfVisible, 30_000)

    return () => {
      active = false
      window.removeEventListener('focus', refreshIfVisible)
      document.removeEventListener('visibilitychange', refreshIfVisible)
      window.clearInterval(interval)
    }
  }, [user, workspaceId])

  useEffect(() => {
    let active = true
    setRhythmPlan(loadKokoRhythmPlan(user))
    if (user) void loadRhythmPlanFromOntology(createDefaultKokoRhythmPlan(subjects)).then((cloudPlan) => {
      if (!active || !cloudPlan) return
      saveKokoRhythmPlan(user, cloudPlan)
      setRhythmPlan(cloudPlan)
    }).catch(() => {})
    const refreshRhythm = () => setRhythmPlan(loadKokoRhythmPlan(user))
    window.addEventListener('koko-rhythm-updated', refreshRhythm)
    return () => { active = false; window.removeEventListener('koko-rhythm-updated', refreshRhythm) }
  }, [subjects, user])

  useEffect(() => {
    let active = true
    void loadPlannerBehaviorEvents(user).then((events) => { if (active) setBehaviorEvents(events) })
    return () => { active = false }
  }, [user])

  const persist = (next: PlannerData, changed?: { kind: 'task'; value: PlannerTask } | { kind: 'event'; value: PlannerEvent }) => {
    setData(next)
    if (workspaceId && user) {
      saveLocalSharedPlannerData(workspaceId, next)
    } else {
      saveLocalPlannerData(next, user)
    }
    if (!changed || !user) return
    if (workspaceId && changed.kind === 'task') {
      enqueuePersistence(() => syncSharedPlannerTask(user, workspaceId, changed.value))
    } else if (workspaceId && changed.kind === 'event') {
      enqueuePersistence(() => syncSharedPlannerEvent(user, workspaceId, changed.value))
    } else if (changed.kind === 'task') {
      enqueuePersistence(() => syncPlannerTask(user, changed.value))
    } else {
      enqueuePersistence(() => syncPlannerEvent(user, changed.value))
    }
  }

  const adaptiveSignals = useMemo(() => buildAdaptiveSignals(behaviorEvents), [behaviorEvents])
  const openTasks = useMemo(() => data.tasks.filter((task) => !task.completed).sort((a, b) => compareTaskUrgency(a, b, rhythmPlan, adaptiveSignals)), [data.tasks, rhythmPlan, adaptiveSignals])
  const upcomingEvents = useMemo(() => data.events.filter((event) => daysUntil(event.eventDate) >= -1).sort((a, b) => a.eventDate.localeCompare(b.eventDate)).slice(0, 5), [data.events])
  const completedToday = data.tasks.filter((task) => task.completed).length

  const addTask = () => {
    if (!taskTitle.trim()) return
    const prepared = prepareTaskInput({ title: taskTitle, subject: taskSubject, dueDate: taskDue, deadlineConfidence: taskDue ? 'explicit' : 'none' })
    const duplicate = findExactOpenDuplicate(data.tasks, { title: prepared.title, subject: prepared.subject, dueDate: taskDue })
    if (duplicate) {
      setTaskHint('Already in your list — kept one clean copy.')
      setTaskTitle('')
      return
    }
    const task: PlannerTask = { id: createPlannerId(), title: prepared.title, subject: prepared.subject, dueDate: taskDue, estimatedMinutes: taskMinutes, priority: taskPriority, completed: false, createdAt: new Date().toISOString(), normalizedTitle: prepared.normalizedTitle, subjectKey: prepared.subjectKey, deadlineConfidence: prepared.deadlineConfidence }
    persist({ ...data, tasks: [task, ...data.tasks] }, { kind: 'task', value: task })
    if (user) {
      void ensureOntologySubject(task.subject).then((subjectId) => {
        setData((current) => {
          const next = { ...current, tasks: current.tasks.map((item) => item.id === task.id ? { ...item, subjectId } : item) }
          if (workspaceId) {
            saveLocalSharedPlannerData(workspaceId, next)
          } else {
            saveLocalPlannerData(next, user)
          }
          const enrichedTask = next.tasks.find((item) => item.id === task.id)
          if (enrichedTask) {
            if (workspaceId) enqueuePersistence(() => syncSharedPlannerTask(user, workspaceId, enrichedTask))
            else enqueuePersistence(() => syncPlannerTask(user, enrichedTask))
          }
          return next
        })
      }).catch(() => {
        // Ontology migration is optional during rollout; the text subject still saves.
      })
    }
    setTaskTitle('')
    setTaskHint('')
  }

  const toggleTask = (id: string) => {
    const currentTask = data.tasks.find((task) => task.id === id)
    if (!currentTask || (!workspaceId && currentTask.sourceWorkspaceId)) return
    if (!currentTask.completed) void recordPlannerBehaviorEvent(user, { type: 'task_completed', subject: currentTask.subject, taskId: currentTask.id }).then((event) => setBehaviorEvents((current) => [...current, event].slice(-250)))
    const nextTask = { ...currentTask, completed: !currentTask.completed }
    persist({ ...data, tasks: data.tasks.map((task) => task.id === id ? nextTask : task) }, { kind: 'task', value: nextTask })
  }

  const deleteTask = (id: string) => {
    if (!workspaceId && data.tasks.find((task) => task.id === id)?.sourceWorkspaceId) return
    persist({ ...data, tasks: data.tasks.filter((task) => task.id !== id) })
    if (workspaceId && user) enqueuePersistence(() => removeSharedPlannerRecord(user, workspaceId, 'planner_tasks', id))
    else if (user) enqueuePersistence(() => removePlannerRecord(user, 'planner_tasks', id))
  }

  const updateTask = (id: string, changes: Pick<PlannerTask, 'title' | 'subject' | 'dueDate' | 'estimatedMinutes' | 'priority'>) => {
    const currentTask = data.tasks.find((task) => task.id === id)
    if (!currentTask || (!workspaceId && currentTask.sourceWorkspaceId)) return
    const prepared = prepareTaskInput({ title: changes.title, subject: changes.subject, dueDate: changes.dueDate, deadlineConfidence: changes.dueDate ? 'explicit' : 'none' })
    const nextTask: PlannerTask = {
      ...currentTask,
      ...changes,
      title: prepared.title,
      subject: prepared.subject,
      dueDate: changes.dueDate,
      estimatedMinutes: Math.min(480, Math.max(5, Math.round(changes.estimatedMinutes || 25))),
      priority: changes.priority,
      normalizedTitle: prepared.normalizedTitle,
      subjectKey: prepared.subjectKey,
      deadlineConfidence: prepared.deadlineConfidence,
    }
    persist({ ...data, tasks: data.tasks.map((task) => task.id === id ? nextTask : task) }, { kind: 'task', value: nextTask })
    if (user) {
      void ensureOntologySubject(nextTask.subject).then((subjectId) => {
        setData((current) => {
          const next = { ...current, tasks: current.tasks.map((task) => task.id === id ? { ...task, subjectId } : task) }
          if (workspaceId) {
            saveLocalSharedPlannerData(workspaceId, next)
          } else {
            saveLocalPlannerData(next, user)
          }
          const enrichedTask = next.tasks.find((task) => task.id === id)
          if (enrichedTask) {
            if (workspaceId) enqueuePersistence(() => syncSharedPlannerTask(user, workspaceId, enrichedTask))
            else enqueuePersistence(() => syncPlannerTask(user, enrichedTask))
          }
          return next
        })
      }).catch(() => {})
    }
  }

  const addEvent = () => {
    const title = eventTitle.trim()
    if (!title || !eventDate) return
    const event: PlannerEvent = { id: createPlannerId(), title, eventDate, type: eventType, notes: '', createdAt: new Date().toISOString() }
    persist({ ...data, events: [...data.events, event] }, { kind: 'event', value: event })
    setEventTitle('')
  }

  const deleteEvent = (id: string) => {
    if (!workspaceId && data.events.find((event) => event.id === id)?.sourceWorkspaceId) return
    persist({ ...data, events: data.events.filter((event) => event.id !== id) })
    if (workspaceId && user) enqueuePersistence(() => removeSharedPlannerRecord(user, workspaceId, 'planner_events', id))
    else if (user) enqueuePersistence(() => removePlannerRecord(user, 'planner_events', id))
  }

  const updateEvent = (id: string, changes: Pick<PlannerEvent, 'title' | 'eventDate' | 'type' | 'notes'>) => {
    const currentEvent = data.events.find((event) => event.id === id)
    if (!currentEvent || (!workspaceId && currentEvent.sourceWorkspaceId)) return
    const title = changes.title.trim().slice(0, 160)
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(changes.eventDate)) return
    const nextEvent = { ...currentEvent, ...changes, title }
    persist({ ...data, events: data.events.map((event) => event.id === id ? nextEvent : event) }, { kind: 'event', value: nextEvent })
  }

  const sectionTitle = section === 'tasks' ? 'to do & deadlines' : section === 'events' ? 'important dates' : section === 'planner' ? 'planner notebook' : 'planning hub'
  const sectionDescription = section === 'tasks' ? 'Turn every deadline into a next step you can actually start.' : section === 'events' ? 'Keep competitions, exams, project dates, and important moments in sight.' : section === 'planner' ? 'One notebook for tasks, deadlines, and the dates you cannot miss.' : 'Plan the next task and remember the dates that matter.'

  if (section === 'tasks' || section === 'planner') return <>
    <TaskNotebook user={user} data={data} showEvents={section === 'planner'} loaded={loaded} openTasks={openTasks} subjects={subjects} rhythmPlan={rhythmPlan} taskTitle={taskTitle} taskSubject={taskSubject} taskDue={taskDue} taskMinutes={taskMinutes} taskPriority={taskPriority} taskHint={taskHint} eventTitle={eventTitle} eventDate={eventDate} eventType={eventType} setTaskTitle={setTaskTitle} setTaskSubject={setTaskSubject} setTaskDue={setTaskDue} setTaskMinutes={setTaskMinutes} setTaskPriority={setTaskPriority} setEventTitle={setEventTitle} setEventDate={setEventDate} setEventType={setEventType} addTask={addTask} addEvent={addEvent} toggleTask={toggleTask} deleteTask={deleteTask} deleteEvent={deleteEvent} updateTask={updateTask} updateEvent={updateEvent} workspaceId={workspaceId} workspace={activeWorkspace} workspaces={workspaces} onWorkspaceChange={onWorkspaceChange} onCreateWorkspace={onCreateWorkspace} onJoinWorkspace={onJoinWorkspace} onLeaveWorkspace={onLeaveWorkspace} onDeleteWorkspace={onDeleteWorkspace} workspaceMembers={workspaceMembers} workspaceMembersLoading={workspaceMembersLoading} workspaceLoading={workspaceLoading} workspaceError={workspaceError} onUserChange={onUserChange} />
  </>


  return (
    <section className="planner-hub mt-5" aria-labelledby="planner-heading">
      <div className="paper-card planner-intro">
        <div><p className="eyebrow">your life, in gentle focus</p><h2 id="planner-heading" className="font-display text-2xl font-bold">{sectionTitle}</h2><p>{sectionDescription}</p></div>
        <div className="planner-mini-stats"><span><Check className="size-4" /> {completedToday} done</span><span><CalendarClock className="size-4" /> {upcomingEvents.length} upcoming</span></div>
      </div>

      <div className={`planner-grid ${section !== 'all' ? 'planner-single-grid' : ''}`}>
        {section === 'all' && <>
        <article className="paper-card planner-card task-card">
          <div className="planner-card-heading"><div><p className="eyebrow">right now</p><h3>to do & deadlines</h3></div><Circle className="size-5" /></div>
          <div className="planner-form task-form">
            <input aria-label="Task title" value={taskTitle} placeholder="What needs to get done?" onChange={(event) => setTaskTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addTask() }} />
            <div className="form-row"><select aria-label="Task subject" value={taskSubject} onChange={(event) => setTaskSubject(event.target.value)}>{subjects.map((subject) => <option key={subject}>{subject}</option>)}</select><input aria-label="Task deadline" type="date" value={taskDue} onChange={(event) => setTaskDue(event.target.value)} /></div>
            <div className="form-row"><select aria-label="Task priority" value={taskPriority} onChange={(event) => setTaskPriority(Number(event.target.value) as TaskPriority)}><option value={1}>priority 1</option><option value={2}>priority 2</option><option value={3}>priority 3</option></select><input aria-label="Estimated minutes" type="number" min="5" step="5" value={taskMinutes} onChange={(event) => setTaskMinutes(Math.max(5, Number(event.target.value)))} /></div>
            <button className="planner-add" onClick={addTask}><Plus className="size-4" /> add task</button>
          </div>
          <div className="task-list">
            {!loaded ? <p className="planner-loading">loading your plan…</p> : openTasks.length ? openTasks.slice(0, 5).map((task) => { const level = urgency(task); return <div key={task.id} className="task-item"><button aria-label={`Mark ${task.title} complete`} className="complete-toggle" onClick={() => toggleTask(task.id)}><Circle className="size-4" /></button><div className="task-copy"><strong>{task.title}</strong><span>{task.subject} · {task.estimatedMinutes}m · priority {task.priority}</span></div><span className={`urgency ${level.tone}`}>{level.label}</span><button aria-label={`Delete ${task.title}`} className="delete-button" onClick={() => deleteTask(task.id)}><Trash2 className="size-3.5" /></button></div> }) : <p className="planner-empty">Add a task and its deadline — deadlines come first, with priority 1–3 breaking close ties.</p>}
          </div>
        </article>
        </>}

        {(section === 'all' || section === 'events') && <article className="paper-card planner-card events-card">
          <div className="planner-card-heading"><div><p className="eyebrow">don&apos;t miss it</p><h3>important dates</h3></div><CalendarClock className="size-5" /></div>
          <div className="planner-form event-form"><input aria-label="Event title" value={eventTitle} placeholder="Competition, project, exam…" onChange={(event) => setEventTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addEvent() }} /><div className="form-row"><input aria-label="Event date" type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} /><select aria-label="Event type" value={eventType} onChange={(event) => setEventType(event.target.value as PlannerEventType)}>{Object.entries(eventLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><button className="planner-add" onClick={addEvent}><Plus className="size-4" /> save date</button></div>
          <div className="event-list">{upcomingEvents.length ? upcomingEvents.map((event) => <div className="event-item" key={event.id}><time><strong>{new Date(`${event.eventDate}T00:00:00`).getDate()}</strong><span>{new Date(`${event.eventDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short' })}</span></time><div><strong>{event.title}</strong><span>{eventLabels[event.type]} · {daysUntil(event.eventDate) === 0 ? 'today' : `${daysUntil(event.eventDate)} days away`}</span></div><button aria-label={`Delete ${event.title}`} className="delete-button" onClick={() => deleteEvent(event.id)}><Trash2 className="size-3.5" /></button></div>) : <p className="planner-empty">Put competitions, project dates, exams, and moments you don&apos;t want to forget here.</p>}</div>
          <p className="event-tip"><Sparkles className="size-4" /> This is your personal timeline — separate from daily to-dos.</p>
        </article>}
      </div>
    </section>
  )
}
