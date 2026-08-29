'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, Check, ChevronRight, Circle, Flag, Plus, Sparkles, Trash2 } from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import { getLocalDateKey } from '../lib/storage'
import { TaskNotebook } from './task-notebook'
import {
  createPlannerId,
  loadPlannerData,
  removePlannerRecord,
  saveLocalPlannerData,
  syncPlannerData,
  type GoalStep,
  type LifeGoal,
  type PlannerData,
  type PlannerEvent,
  type PlannerEventType,
  type PlannerTask,
  type TaskPriority,
} from '../lib/planner-storage'

const emptyData: PlannerData = { tasks: [], goals: [], steps: [], events: [] }
const eventLabels: Record<PlannerEventType, string> = { competition: 'competition', project: 'project', exam: 'exam', important: 'important' }
export type PlannerSection = 'all' | 'planner' | 'tasks' | 'goals' | 'events'

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

// Deadlines lead the sort. Priority only breaks a near-tie (same day or one day apart).
const NO_DEADLINE_DAYS = 100_000
const PRIORITY_TIE_WINDOW_DAYS = 1
function compareTaskUrgency(a: PlannerTask, b: PlannerTask) {
  const aDays = a.dueDate ? daysUntil(a.dueDate) : NO_DEADLINE_DAYS
  const bDays = b.dueDate ? daysUntil(b.dueDate) : NO_DEADLINE_DAYS
  const deadlineDifference = aDays - bDays
  if (Math.abs(deadlineDifference) > PRIORITY_TIE_WINDOW_DAYS) return deadlineDifference
  if (a.priority !== b.priority) return a.priority - b.priority
  return deadlineDifference
}

function formatDate(dateKey: string) {
  if (!dateKey) return 'no date yet'
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function PlannerHub({ user, subjects, section = 'all' }: { user: User | null; subjects: string[]; section?: PlannerSection }) {
  const [data, setData] = useState<PlannerData>(emptyData)
  const [loaded, setLoaded] = useState(false)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskSubject, setTaskSubject] = useState('General')
  const [taskDue, setTaskDue] = useState('')
  const [taskMinutes, setTaskMinutes] = useState(30)
  const [taskPriority, setTaskPriority] = useState<TaskPriority>(2)
  const [goalTitle, setGoalTitle] = useState('')
  const [goalDate, setGoalDate] = useState('')
  const [eventTitle, setEventTitle] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [eventType, setEventType] = useState<PlannerEventType>('important')
  const [stepDrafts, setStepDrafts] = useState<Record<string, string>>({})

  useEffect(() => {
    setData(emptyData)
    setLoaded(false)
    const today = getLocalDateKey()
    setTaskDue((current) => current || today)
    setEventDate((current) => current || today)
    let active = true
    let loading = false

    const refresh = async (syncLocalRecords = false) => {
      if (loading) return
      loading = true
      try {
        const next = await loadPlannerData(user)
        if (!active) return
        setData(next)
        setLoaded(true)
        // Initial load still uploads local-only records after sign-in. Later
        // background refreshes only read, so a stale tab never writes over a
        // completion made from LINE.
        if (syncLocalRecords) void syncPlannerData(user, next)
      } finally {
        loading = false
      }
    }

    void refresh(true)

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
  }, [user])

  const persist = (next: PlannerData) => {
    setData(next)
    saveLocalPlannerData(next, user)
    void syncPlannerData(user, next)
  }

  const openTasks = useMemo(() => data.tasks.filter((task) => !task.completed).sort(compareTaskUrgency), [data.tasks])
  const upcomingEvents = useMemo(() => data.events.filter((event) => daysUntil(event.eventDate) >= -1).sort((a, b) => a.eventDate.localeCompare(b.eventDate)).slice(0, 5), [data.events])
  const completedToday = data.tasks.filter((task) => task.completed).length

  const addTask = () => {
    const title = taskTitle.trim()
    if (!title) return
    const task: PlannerTask = { id: createPlannerId(), title, subject: taskSubject, dueDate: taskDue, estimatedMinutes: taskMinutes, priority: taskPriority, completed: false, createdAt: new Date().toISOString() }
    persist({ ...data, tasks: [task, ...data.tasks] })
    setTaskTitle('')
  }

  const toggleTask = (id: string) => {
    persist({ ...data, tasks: data.tasks.map((task) => task.id === id ? { ...task, completed: !task.completed } : task) })
  }

  const deleteTask = (id: string) => {
    persist({ ...data, tasks: data.tasks.filter((task) => task.id !== id) })
    void removePlannerRecord(user, 'planner_tasks', id)
  }

  const addGoal = () => {
    const title = goalTitle.trim()
    if (!title) return
    const goal: LifeGoal = { id: createPlannerId(), title, description: '', targetDate: goalDate, subjects: [], shelfPosition: data.goals.length, createdAt: new Date().toISOString() }
    persist({ ...data, goals: [goal, ...data.goals] })
    setGoalTitle('')
    setGoalDate('')
  }

  const addStep = (goalId: string) => {
    const title = stepDrafts[goalId]?.trim()
    if (!title) return
    const goalSteps = data.steps.filter((step) => step.goalId === goalId)
    const step: GoalStep = { id: createPlannerId(), goalId, title, dueDate: '', completed: false, orderIndex: goalSteps.length }
    persist({ ...data, steps: [...data.steps, step] })
    setStepDrafts((previous) => ({ ...previous, [goalId]: '' }))
  }

  const toggleStep = (id: string) => persist({ ...data, steps: data.steps.map((step) => step.id === id ? { ...step, completed: !step.completed } : step) })

  const deleteGoal = (goalId: string) => {
    const removedStepIds = data.steps.filter((step) => step.goalId === goalId).map((step) => step.id)
    persist({ ...data, goals: data.goals.filter((goal) => goal.id !== goalId), steps: data.steps.filter((step) => step.goalId !== goalId) })
    void removePlannerRecord(user, 'life_goals', goalId)
    removedStepIds.forEach((id) => void removePlannerRecord(user, 'goal_steps', id))
  }

  const addEvent = () => {
    const title = eventTitle.trim()
    if (!title || !eventDate) return
    const event: PlannerEvent = { id: createPlannerId(), title, eventDate, type: eventType, notes: '', createdAt: new Date().toISOString() }
    persist({ ...data, events: [...data.events, event] })
    setEventTitle('')
  }

  const deleteEvent = (id: string) => {
    persist({ ...data, events: data.events.filter((event) => event.id !== id) })
    void removePlannerRecord(user, 'planner_events', id)
  }

  const sectionTitle = section === 'tasks' ? 'to do & deadlines' : section === 'goals' ? 'life goals' : section === 'events' ? 'important dates' : section === 'planner' ? 'planner notebook' : 'planning hub'
  const sectionDescription = section === 'tasks' ? 'Turn every deadline into a next step you can actually start.' : section === 'goals' ? 'Keep the big dream visible, then make it smaller and kinder.' : section === 'events' ? 'Keep competitions, exams, project dates, and important moments in sight.' : section === 'planner' ? 'One notebook for tasks, deadlines, and the dates you cannot miss.' : 'Plan the next task, build the bigger dream, and remember the dates that matter.'

  if (section === 'tasks' || section === 'planner') return <TaskNotebook user={user} data={data} showEvents={section === 'planner'} loaded={loaded} openTasks={openTasks} subjects={subjects} taskTitle={taskTitle} taskSubject={taskSubject} taskDue={taskDue} taskMinutes={taskMinutes} taskPriority={taskPriority} eventTitle={eventTitle} eventDate={eventDate} eventType={eventType} setTaskTitle={setTaskTitle} setTaskSubject={setTaskSubject} setTaskDue={setTaskDue} setTaskMinutes={setTaskMinutes} setTaskPriority={setTaskPriority} setEventTitle={setEventTitle} setEventDate={setEventDate} setEventType={setEventType} addTask={addTask} addEvent={addEvent} toggleTask={toggleTask} deleteTask={deleteTask} deleteEvent={deleteEvent} />


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

        {(section === 'all' || section === 'goals') && <article className="paper-card planner-card goals-card">
          <div className="planner-card-heading"><div><p className="eyebrow">the bigger picture</p><h3>life goals</h3></div><Flag className="size-5" /></div>
          <div className="planner-form goal-form"><input aria-label="Life goal" value={goalTitle} placeholder="e.g. Get into BBA" onChange={(event) => setGoalTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addGoal() }} /><div className="form-row"><input aria-label="Goal target date" type="date" value={goalDate} onChange={(event) => setGoalDate(event.target.value)} /><button className="planner-add" onClick={addGoal}><Plus className="size-4" /> add goal</button></div></div>
          <div className="goal-list">
            {data.goals.length ? data.goals.map((goal) => { const steps = data.steps.filter((step) => step.goalId === goal.id).sort((a, b) => a.orderIndex - b.orderIndex); const complete = steps.filter((step) => step.completed).length; const progress = steps.length ? Math.round((complete / steps.length) * 100) : 0; return <div className="goal-item" key={goal.id}><div className="goal-title-row"><div><strong>{goal.title}</strong><span>{goal.targetDate ? `target ${formatDate(goal.targetDate)}` : 'set a target date when ready'}</span></div><button aria-label={`Delete ${goal.title}`} className="delete-button" onClick={() => deleteGoal(goal.id)}><Trash2 className="size-3.5" /></button></div><div className="goal-progress"><span style={{ width: `${progress}%` }} /></div><p>{complete}/{steps.length} milestones · {progress}% complete</p>{steps.map((step) => <button className={`goal-step ${step.completed ? 'done' : ''}`} key={step.id} onClick={() => toggleStep(step.id)}>{step.completed ? <Check className="size-3.5" /> : <ChevronRight className="size-3.5" />}{step.title}</button>)}<div className="step-adder"><input aria-label={`New milestone for ${goal.title}`} value={stepDrafts[goal.id] ?? ''} placeholder="Add a small next step" onChange={(event) => setStepDrafts((previous) => ({ ...previous, [goal.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter') addStep(goal.id) }} /><button onClick={() => addStep(goal.id)}>add</button></div></div> }) : <p className="planner-empty">A goal is a direction, not a deadline. Add one, then break it into tiny milestones.</p>}
          </div>
        </article>}

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
