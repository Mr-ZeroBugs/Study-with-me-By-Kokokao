'use client'

import { useEffect, useMemo, useState } from 'react'
import { BookOpen, CalendarDays, Circle, Coffee, Droplets, Flower2, Heart, ListChecks, MessageCircle, Moon, NotebookPen, Plus, Sparkles, Trash2 } from 'lucide-react'
import { getLocalDateKey } from '../lib/storage'
import type { GoalStep, LifeGoal, PlannerData, PlannerEvent, PlannerEventType, PlannerTask, TaskPriority } from '../lib/planner-storage'
import type { User } from '@supabase/supabase-js'
import { LineConnectModal } from './line-connect-modal'
import { AuthModal } from './auth-modal'

const eventLabels: Record<PlannerEventType, string> = { competition: 'competition', project: 'project', exam: 'exam', important: 'important' }
const NOTEBOOK_KEY = 'study_timer_task_notebook_v1'

type TaskNotebookProps = {
  user?: User | null
  data: PlannerData
  showEvents: boolean
  loaded: boolean
  openTasks: PlannerTask[]
  subjects: string[]
  taskTitle: string
  taskSubject: string
  taskDue: string
  taskMinutes: number
  taskPriority: TaskPriority
  eventTitle: string
  eventDate: string
  eventType: PlannerEventType
  setTaskTitle: (value: string) => void
  setTaskSubject: (value: string) => void
  setTaskDue: (value: string) => void
  setTaskMinutes: (value: number) => void
  setTaskPriority: (value: TaskPriority) => void
  setEventTitle: (value: string) => void
  setEventDate: (value: string) => void
  setEventType: (value: PlannerEventType) => void
  addTask: () => void
  addEvent: () => void
  toggleTask: (id: string) => void
  deleteTask: (id: string) => void
  deleteEvent: (id: string) => void
}


type CaptureType = 'task' | 'event'

function formatDate(dateKey: string) {
  if (!dateKey) return 'no deadline'
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function goalProgress(goal: LifeGoal, steps: GoalStep[]) {
  const goalSteps = steps.filter((step) => step.goalId === goal.id)
  return goalSteps.length ? Math.round((goalSteps.filter((step) => step.completed).length / goalSteps.length) * 100) : 0
}

function calendarParts(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay()
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return [...Array(first).fill(null), ...Array.from({ length: count }, (_, index) => index + 1)]
}

function calendarDateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function shortCalendarTitle(title: string) {
  return title.length > 17 ? `${title.slice(0, 16)}…` : title
}

export function TaskNotebook({
  user = null,
  data,
  showEvents,
  loaded,
  openTasks,
  subjects,
  taskTitle,
  taskSubject,
  taskDue,
  taskMinutes,
  taskPriority,
  eventTitle,
  eventDate,
  eventType,
  setTaskTitle,
  setTaskSubject,
  setTaskDue,
  setTaskMinutes,
  setTaskPriority,
  setEventTitle,
  setEventDate,
  setEventType,
  addTask,
  addEvent,
  toggleTask,
  deleteTask,
  deleteEvent,
}: TaskNotebookProps) {
  const [currentUser, setCurrentUser] = useState<User | null>(user ?? null)
  const [isLineModalOpen, setIsLineModalOpen] = useState(false)
  const [isAuthOpen, setIsAuthOpen] = useState(false)
  const [rememberNote, setRememberNote] = useState('')
  const [pageNote, setPageNote] = useState('')
  const [notesReady, setNotesReady] = useState(false)
  const [calendarDate, setCalendarDate] = useState(() => new Date(2000, 0, 1))
  const [selectedDate, setSelectedDate] = useState('')
  const [captureType, setCaptureType] = useState<CaptureType>('task')

  useEffect(() => {
    setCurrentUser(user ?? null)
  }, [user])


  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(NOTEBOOK_KEY) ?? '{}') as Record<string, unknown>
      setRememberNote(typeof saved.remember === 'string' ? saved.remember : '')
      setPageNote(typeof saved.page === 'string' ? saved.page : '')
    } catch {
      // Notes are optional; a malformed local value should never block the task page.
    }
    setNotesReady(true)
  }, [])

  useEffect(() => {
    if (!notesReady) return
    window.localStorage.setItem(NOTEBOOK_KEY, JSON.stringify({ remember: rememberNote, page: pageNote }))
  }, [notesReady, pageNote, rememberNote])

  useEffect(() => {
    const now = new Date()
    setCalendarDate(new Date(now.getFullYear(), now.getMonth(), 1))
    setSelectedDate(getLocalDateKey(now))
  }, [])

  const priorityTasks = openTasks.slice(0, 3)
  const goals = data.goals.slice(0, 3)
  const calendar = useMemo(() => calendarParts(calendarDate.getFullYear(), calendarDate.getMonth()), [calendarDate])
  const calendarEventDays = useMemo(() => new Set(data.events.filter((event) => event.eventDate.startsWith(`${calendarDate.getFullYear()}-${String(calendarDate.getMonth() + 1).padStart(2, '0')}`)).map((event) => Number(event.eventDate.slice(-2)))), [calendarDate, data.events])
  const upcomingEvents = useMemo(() => data.events.slice().sort((a, b) => a.eventDate.localeCompare(b.eventDate)).slice(0, 5), [data.events])
  const eventsByDate = useMemo(() => data.events.reduce<Record<string, PlannerEvent[]>>((grouped, event) => { (grouped[event.eventDate] ??= []).push(event); return grouped }, {}), [data.events])
  const tasksByDate = useMemo(() => data.tasks.reduce<Record<string, PlannerTask[]>>((grouped, task) => { if (task.dueDate) (grouped[task.dueDate] ??= []).push(task); return grouped }, {}), [data.tasks])
  const selectedEvents = selectedDate ? eventsByDate[selectedDate] ?? [] : []
  const selectedTasks = selectedDate ? tasksByDate[selectedDate] ?? [] : []

  const selectCalendarDay = (dateKey: string) => {
    setSelectedDate(dateKey)
    setEventDate(dateKey)
  }

  const changeCalendarMonth = (amount: number) => {
    setCalendarDate((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1))
    setSelectedDate('')
  }

  return (
    <section className="task-notebook-page">
      <div className="task-notebook-shell">
        <div className="notebook-topline">
          <span>study with me · daily page</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsLineModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1 text-xs font-semibold text-ink hover:border-[#06C755] hover:text-[#06C755] transition shadow-2xs cursor-pointer"
            >
              <MessageCircle className="size-3.5 text-[#06C755]" />
              <span>📱 เชื่อมต่อ LINE Bot</span>
            </button>
            <span>✦ {openTasks.length} things on your mind</span>
          </div>
        </div>


        <header className="task-notebook-header">
          <div className="notebook-sticky">you<br />got this! <span>♡</span></div>
          <div className="notebook-title-wrap">
            <p className="eyebrow">a kinder plan for today</p>
            <h1>to do list<span>.</span></h1>
            <p>plan it. do it. achieve it.</p>
            <div className="notebook-underline" />
          </div>
          <div className="notebook-sprig" aria-hidden="true">❧</div>
        </header>

        <div className="task-notebook-grid">
          <section className={`notebook-paper tasks-paper ${captureType === 'event' && showEvents ? 'dates-swap-paper' : ''}`} aria-labelledby="tasks-paper-heading">
            <div className="paper-heading"><h2 id="tasks-paper-heading">{captureType === 'event' && showEvents ? 'important dates' : 'tasks'}</h2>{captureType === 'event' && showEvents ? <CalendarDays className="size-6" /> : <Flower2 className="size-6" />}</div>
            <div className="notebook-task-form">
              {showEvents && <div className="capture-type-toggle" role="group" aria-label="Choose what to add"><span>add to planner</span><button type="button" className={captureType === 'task' ? 'active' : ''} onClick={() => setCaptureType('task')}><ListChecks className="size-3.5" /> task</button><button type="button" className={captureType === 'event' ? 'active event' : ''} onClick={() => setCaptureType('event')}><CalendarDays className="size-3.5" /> important date</button></div>}
              {captureType === 'task' || !showEvents ? <>
                <div className="notebook-input-line"><input aria-label="Task title" value={taskTitle} placeholder="write a task here…" onChange={(event) => setTaskTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addTask() }} /><button aria-label="Add task" onClick={addTask}><Plus className="size-4" /></button></div>
                <div className="notebook-form-options">
                  <select aria-label="Task subject" value={taskSubject} onChange={(event) => setTaskSubject(event.target.value)}>{subjects.map((subject) => <option key={subject}>{subject}</option>)}</select>
                  <input aria-label="Task deadline" type="date" value={taskDue} onChange={(event) => setTaskDue(event.target.value)} />
                  <select aria-label="Task priority" value={taskPriority} onChange={(event) => setTaskPriority(Number(event.target.value) as TaskPriority)}><option value={1}>priority 1</option><option value={2}>priority 2</option><option value={3}>priority 3</option></select>
                  <input aria-label="Estimated minutes" type="number" min="5" step="5" value={taskMinutes} onChange={(event) => setTaskMinutes(Math.max(5, Number(event.target.value)))} />
                </div>
                <p className="notebook-form-hint">subject · deadline · priority · estimated minutes</p>
              </> : <>
                <div className="notebook-input-line"><input aria-label="Event title" value={eventTitle} placeholder="competition, project, exam…" onChange={(event) => setEventTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addEvent() }} /><button aria-label="Add important date" onClick={addEvent}><Plus className="size-4" /></button></div>
                <div className="notebook-form-options event-options"><input aria-label="Event date" type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} /><select aria-label="Event type" value={eventType} onChange={(event) => setEventType(event.target.value as PlannerEventType)}>{Object.entries(eventLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
                <p className="notebook-form-hint">date · type · a moment worth remembering</p>
              </>}
            </div>

            {captureType === 'event' && showEvents ? <>
              <div className="swapped-date-list">
                {!loaded ? <p className="notebook-empty">opening your dates…</p> : upcomingEvents.length ? upcomingEvents.map((event, index) => <div className="swapped-date-item" key={event.id}>
                  <span className="swapped-date-number">{String(index + 1).padStart(2, '0')}</span>
                  <span className="swapped-date-calendar"><strong>{new Date(`${event.eventDate}T00:00:00`).getDate()}</strong><small>{new Date(`${event.eventDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short' })}</small></span>
                  <div className="lined-task-copy"><strong>{event.title}</strong><span>{eventLabels[event.type]} · {formatDate(event.eventDate)}</span></div>
                  <button aria-label={`Delete ${event.title}`} className="notebook-delete swapped-date-delete" onClick={() => deleteEvent(event.id)}><Trash2 className="size-3.5" /></button>
                </div>) : <div className="notebook-empty"><CalendarDays className="size-5" /><span>no important dates yet — add one above.</span></div>}
              </div>
              <div className="task-paper-footer"><span>{data.events.length} dates saved</span><span>keep the moments that matter close ♡</span></div>
            </> : <>
              <div className="lined-task-list">
                {!loaded ? <p className="notebook-empty">opening your page…</p> : openTasks.length ? openTasks.slice(0, 8).map((task, index) => <div className="lined-task" key={task.id}>
                  <button aria-label={`Mark ${task.title} complete`} className="notebook-check" onClick={() => toggleTask(task.id)}><Circle className="size-4" /></button>
                  <span className="lined-task-number">{String(index + 1).padStart(2, '0')}</span>
                  <div className="lined-task-copy"><strong>{task.title}</strong><span>{task.subject} · {task.estimatedMinutes}m · {task.dueDate ? formatDate(task.dueDate) : 'no deadline'}</span></div>
                  <span className={`notebook-priority priority-${task.priority}`}>P{task.priority}</span>
                  <button aria-label={`Delete ${task.title}`} className="notebook-delete" onClick={() => deleteTask(task.id)}><Trash2 className="size-3.5" /></button>
                </div>) : <div className="notebook-empty"><ListChecks className="size-5" /><span>your page is clear — add the next small thing.</span></div>}
              </div>
              <div className="task-paper-footer"><span>{data.tasks.filter((task) => task.completed).length} completed</span><span>{openTasks.length > 8 ? `+ ${openTasks.length - 8} more` : 'keep going, gently ♡'}</span></div>
            </>}
          </section>

          <div className="notebook-side-column">
            <section className="notebook-paper priorities-paper" aria-labelledby="priorities-heading">
              <div className="paper-heading"><h2 id="priorities-heading">priorities</h2><Heart className="size-5" /></div>
              <div className="priority-list">{priorityTasks.length ? priorityTasks.map((task, index) => <div className="priority-line" key={task.id}><span className="priority-index">{index + 1}.</span><div><strong>{task.title}</strong><span>priority {task.priority} · {task.dueDate ? formatDate(task.dueDate) : 'no deadline'}</span></div></div>) : <p className="priority-empty">nothing queued yet — add the next small thing.</p>}</div>
              <p className="side-note">the list follows deadline first, then priority when dates are close.</p>
            </section>

            <section className="notebook-paper remember-paper" aria-labelledby="remember-heading">
              <div className="paper-heading"><h2 id="remember-heading">remember</h2><Sparkles className="size-5" /></div>
              <textarea aria-label="Remember note" value={rememberNote} placeholder="a little note for later…" onChange={(event) => setRememberNote(event.target.value)} />
              <span className="paper-corner-heart">♥</span>
            </section>
          </div>
        </div>

        {showEvents && <section className="notebook-paper dates-paper" aria-labelledby="dates-heading">
          <div className="paper-heading"><h2 id="dates-heading">important dates</h2><CalendarDays className="size-5" /></div>
          <p className="dates-paper-hint"><Sparkles className="size-3.5" /> choose <strong>important date</strong> in the add box above to put a new moment on this calendar.</p>
          <div className="notebook-calendar-heading"><button aria-label="Previous month" onClick={() => changeCalendarMonth(-1)}>‹</button><strong>{calendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</strong><button aria-label="Next month" onClick={() => changeCalendarMonth(1)}>›</button></div>
          <div className="notebook-calendar-weekdays">{['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((day) => <span key={day}>{day}</span>)}</div>
          <div className="notebook-calendar-grid">{calendar.map((day, index) => {
            if (!day) return <span key={`empty-${index}`} className="notebook-calendar-day empty" />
            const dateKey = calendarDateKey(calendarDate.getFullYear(), calendarDate.getMonth(), day)
            const dayEvents = eventsByDate[dateKey] ?? []
            const dayTasks = tasksByDate[dateKey] ?? []
            const itemCount = dayEvents.length + dayTasks.length
            return <button type="button" key={dateKey} className={`notebook-calendar-day ${calendarEventDays.has(day) ? 'has-event' : ''} ${selectedDate === dateKey ? 'selected' : ''}`} onClick={() => selectCalendarDay(dateKey)}><span className="calendar-day-number">{day}</span>{dayEvents.slice(0, 1).map((event) => <small className="calendar-event-label" key={event.id}>{shortCalendarTitle(event.title)}</small>)}{dayTasks.slice(0, 2).map((task) => <small className={`calendar-task-label ${task.completed ? 'completed' : ''}`} key={task.id}>+ {shortCalendarTitle(task.title)}</small>)}{itemCount > 3 && <small className="calendar-more-label">+{itemCount - 3} more</small>}</button>
          })}</div>
          <div className="selected-date-details" aria-live="polite">{selectedDate ? <><div className="selected-date-heading"><div><p className="eyebrow">selected day</p><strong>{formatDate(selectedDate)}</strong></div><span>{selectedEvents.length + selectedTasks.length} items</span></div>{selectedEvents.length || selectedTasks.length ? <div className="selected-date-list">{selectedEvents.map((event) => <div className="selected-date-item event-detail" key={event.id}><CalendarDays className="size-3.5" /><div><strong>{event.title}</strong><span>{eventLabels[event.type]}</span></div></div>)}{selectedTasks.map((task) => <div className={`selected-date-item task-detail ${task.completed ? 'completed' : ''}`} key={task.id}><ListChecks className="size-3.5" /><div><strong>+ {task.title}</strong><span>{task.subject} · {task.completed ? 'completed' : `${task.estimatedMinutes}m · priority ${task.priority}`}</span></div></div>)}</div> : <p className="selected-date-empty">nothing planned yet — a lovely blank page.</p>}</> : <p className="selected-date-empty">tap any day to see what&apos;s happening there.</p>}</div>
          <div className="notebook-event-list">{upcomingEvents.length ? upcomingEvents.map((event: PlannerEvent) => <div className="notebook-event-item" key={event.id}><CalendarDays className="size-4" /><div><strong>{event.title}</strong><span>{formatDate(event.eventDate)} · {eventLabels[event.type]}</span></div>{captureType !== 'event' && <button aria-label={`Delete ${event.title}`} className="notebook-delete" onClick={() => deleteEvent(event.id)}><Trash2 className="size-3.5" /></button>}</div>) : <p className="notebook-event-empty">add the dates future-you should remember.</p>}</div>
        </section>}

        <div className="task-notebook-lower-grid">
          <section className="notebook-paper study-goals-paper" aria-labelledby="study-goals-heading">
            <div className="paper-heading"><h2 id="study-goals-heading">study goals</h2><BookOpen className="size-5" /></div>
            <div className="goal-lines">{goals.length ? goals.map((goal) => <div className="goal-line" key={goal.id}><span>•</span><div><strong>{goal.title}</strong><small>{goalProgress(goal, data.steps)}% complete</small></div></div>) : [1, 2, 3].map((item) => <div className="empty-goal-line" key={item}><span>•</span><i /></div>)}</div>
            {!goals.length && <p className="goal-paper-hint">your big dreams can live here too.</p>}
            {goals.length > 0 && <a className="notebook-text-link" href="/goals">open life goals →</a>}
          </section>

          <section className="notebook-paper notes-paper" aria-labelledby="notes-heading">
            <div className="paper-heading"><h2 id="notes-heading">notes</h2><NotebookPen className="size-5" /></div>
            <textarea aria-label="Notebook notes" value={pageNote} placeholder="ideas, reminders, tiny wins…" onChange={(event) => setPageNote(event.target.value)} />
            <div className="notes-grid" aria-hidden="true" />
          </section>
        </div>

        <section className="dont-forget" aria-label="Self care reminders">
          <p>don&apos;t forget to… <Heart className="size-4" /></p>
          <div className="forget-items"><span><Droplets className="size-5" /><b>drink water</b></span><span><Moon className="size-5" /><b>get enough sleep</b></span><span><Coffee className="size-5" /><b>take breaks</b></span><span><Heart className="size-5" /><b>be kind to yourself</b></span></div>
        </section>
        <p className="notebook-caption">small steps every day <Flower2 className="size-4" /> big results <Heart className="size-4" /></p>
      </div>

      <LineConnectModal
        isOpen={isLineModalOpen}
        onClose={() => setIsLineModalOpen(false)}
        user={currentUser}
        onOpenAuth={() => setIsAuthOpen(true)}
      />

      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        user={currentUser}
        onUserChange={(newUser) => setCurrentUser(newUser)}
      />
    </section>
  )
}

