'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, CalendarDays, Check, CheckCircle2, ChevronRight, Flame, Flag, ListTodo, MessageCircle, Sparkles, Target } from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { calculateStreak, getLocalDateKey, getLocalSubjects, loadStudyLogs, loadSubjectLogs, type DayLog, type SubjectDayLogs } from '../lib/storage'
import { loadPlannerData, type PlannerData } from '../lib/planner-storage'
import { LineConnectModal } from './line-connect-modal'
import { AuthModal } from './auth-modal'


function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

function formatDate(dateKey: string) {
  if (!dateKey) return 'no date'
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function daysUntil(dateKey: string) {
  const today = new Date(`${getLocalDateKey()}T00:00:00`)
  const date = new Date(`${dateKey}T00:00:00`)
  return Math.round((date.getTime() - today.getTime()) / 86_400_000)
}

function calendarParts(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay()
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return [...Array(first).fill(null), ...Array.from({ length: count }, (_, index) => index + 1)]
}

function calendarDateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function DashboardPage() {
  const [user, setUser] = useState<User | null>(null)
  const [isLineModalOpen, setIsLineModalOpen] = useState(false)
  const [isAuthOpen, setIsAuthOpen] = useState(false)
  const [logs, setLogs] = useState<DayLog>({})
  const [subjectLogs, setSubjectLogs] = useState<SubjectDayLogs>({})
  const [subjects, setSubjects] = useState<string[]>(['General'])
  const [planner, setPlanner] = useState<PlannerData>({ tasks: [], goals: [], steps: [], events: [] })
  // Keep the first server/client render identical; replace with the real clock after mount.
  const [now, setNow] = useState(() => new Date(2000, 0, 1, 12, 0, 0))


  useEffect(() => {
    setNow(new Date())
    const loadData = async (nextUser: User | null) => {
      const [nextLogs, nextSubjectLogs, nextPlanner] = await Promise.all([loadStudyLogs(nextUser), loadSubjectLogs(nextUser), loadPlannerData(nextUser)])
      setLogs(nextLogs)
      setSubjectLogs(nextSubjectLogs)
      setPlanner(nextPlanner)
      setSubjects((previous) => Array.from(new Set([...previous, ...getLocalSubjects(), ...Object.keys(nextSubjectLogs)])))
    }
    void loadData(null)
    supabase.auth.getSession().then(({ data }) => {
      const nextUser = data.session?.user ?? null
      setUser(nextUser)
      void loadData(nextUser)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null
      setUser(nextUser)
      void loadData(nextUser)
    })
    const interval = window.setInterval(() => setNow(new Date()), 60_000)
    return () => { listener.subscription.unsubscribe(); window.clearInterval(interval) }
  }, [])

  const todayKey = getLocalDateKey(now)
  const todayMinutes = logs[todayKey] ?? 0
  const streak = useMemo(() => calculateStreak(logs), [logs])
  const allOpenTasks = useMemo(() => planner.tasks.filter((task) => !task.completed).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')), [planner.tasks])
  const openTasks = allOpenTasks.slice(0, 4)
  const todayTasks = useMemo(() => allOpenTasks.filter((task) => task.dueDate === todayKey), [allOpenTasks, todayKey])
  const upcomingTasks = useMemo(() => allOpenTasks.filter((task) => Boolean(task.dueDate && task.dueDate > todayKey)), [allOpenTasks, todayKey])
  const planTasks = todayTasks.length ? todayTasks : upcomingTasks.length ? upcomingTasks : openTasks
  const planMode = todayTasks.length ? 'today' : planTasks.length ? 'upcoming' : 'empty'
  const upcomingEvents = useMemo(() => planner.events.filter((event) => daysUntil(event.eventDate) >= 0).sort((a, b) => a.eventDate.localeCompare(b.eventDate)).slice(0, 3), [planner.events])
  const dashboardCalendar = useMemo(() => calendarParts(now.getFullYear(), now.getMonth()), [now])
  const dashboardEventDays = useMemo(() => new Set(planner.events.map((event) => event.eventDate)), [planner.events])
  const dashboardTasksByDate = useMemo(() => planner.tasks.reduce<Record<string, number>>((counts, task) => { if (task.dueDate) counts[task.dueDate] = (counts[task.dueDate] ?? 0) + 1; return counts }, {}), [planner.tasks])
  const featuredGoal = planner.goals[0]
  const featuredGoalSteps = featuredGoal ? planner.steps.filter((step) => step.goalId === featuredGoal.id) : []
  const goalProgress = featuredGoalSteps.length ? Math.round((featuredGoalSteps.filter((step) => step.completed).length / featuredGoalSteps.length) * 100) : 0
  const subjectSummary = useMemo(() => Object.entries(subjectLogs).map(([subject, days]) => ({ subject, minutes: Object.values(days).reduce((sum, value) => sum + value, 0) })).sort((a, b) => b.minutes - a.minutes)[0], [subjectLogs])

  return <main className="dashboard-page min-h-screen overflow-hidden px-4 py-6 pb-28 text-ink sm:px-8 lg:px-12"><div className="mx-auto max-w-7xl">
    <header className="dashboard-hero paper-card">
      <div className="dashboard-hero-copy">
        <p className="eyebrow">your cozy command center</p>
        <h1 className="font-display">welcome back<span className="text-coral">.</span></h1>
        <p>One calm place for the work, goals, and moments you care about.</p>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <span className="dashboard-sync"><span /> {user ? 'your plan is synced' : 'your plan is saved on this device'}</span>
          <button
            type="button"
            onClick={() => setIsLineModalOpen(true)}
            className="dashboard-line-link"
          >
            <MessageCircle className="size-3.5" />
            <span>LINE reminders</span>
          </button>
        </div>
      </div>
      <div className="dashboard-date-card"><span>{now.toLocaleDateString('en-US', { weekday: 'long' })}</span><strong>{now.getDate()}</strong><small>{now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</small></div>
    </header>


    <section className="dashboard-command-board" aria-label="Planner preview">
      <div className="paper-card dashboard-next-board">
        <div className="dashboard-board-heading"><div><p className="eyebrow">{planMode === 'today' ? 'your next moves' : 'coming up next'}</p><h2>{planMode === 'today' ? "today's little plan" : planMode === 'upcoming' ? 'upcoming tasks' : "today's little plan"}</h2></div><Link href="/tasks" className="board-open-link">open notebook <ArrowUpRight className="size-3.5" /></Link></div>
        <div className="dashboard-next-list">{planTasks.length ? planTasks.map((task, index) => <Link href="/tasks" className="dashboard-next-item" key={task.id}><span className="next-rank">{String(index + 1).padStart(2, '0')}</span><span className="next-check" /><span className="next-copy"><strong>{task.title}</strong><small>{task.dueDate ? formatDate(task.dueDate) : 'no deadline'} · priority {task.priority} · {task.subject}</small></span><ChevronRight className="size-4" /></Link>) : <div className="dashboard-next-empty"><ListTodo className="size-5" /><span>No open tasks yet. Add one small next step.</span></div>}</div>
        <div className="dashboard-next-footer"><span>{planner.tasks.filter((task) => task.completed).length} tasks completed</span><span>{planMode === 'today' ? 'planned for today' : planMode === 'upcoming' ? 'nothing planned today · next deadlines below' : 'a clear page is okay too'}</span></div>
      </div>
      <div className="paper-card dashboard-month-board">
        <div className="dashboard-board-heading"><div><p className="eyebrow">see the shape of your month</p><h2>{now.toLocaleDateString('en-US', { month: 'long' })}</h2></div><Link href="/planner" className="board-open-link">full calendar <ArrowUpRight className="size-3.5" /></Link></div>
        <div className="dashboard-calendar-weekdays">{['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((day) => <span key={day}>{day}</span>)}</div>
        <div className="dashboard-calendar-grid">{dashboardCalendar.map((day, index) => { if (!day) return <span className="dashboard-calendar-day empty" key={`empty-${index}`} />; const dateKey = calendarDateKey(now.getFullYear(), now.getMonth(), day); const taskCount = dashboardTasksByDate[dateKey] ?? 0; const hasEvent = dashboardEventDays.has(dateKey); return <Link href="/planner" className={`dashboard-calendar-day ${hasEvent ? 'has-event' : ''} ${taskCount ? 'has-task' : ''}`} key={dateKey}><strong>{day}</strong>{hasEvent && <small>date</small>}{taskCount > 0 && <small>+{taskCount} task</small>}</Link> })}</div>
        <div className="dashboard-calendar-legend"><span><i className="legend-event" /> important date</span><span><i className="legend-task" /> task due</span></div>
      </div>
    </section>

    <section className="dashboard-overview-grid" aria-label="Your day at a glance">
      <div className="paper-card today-card"><div className="dashboard-card-heading"><div><p className="eyebrow">today&apos;s progress</p><h2>study time today</h2></div><Sparkles className="size-5" /></div><div className="today-focus"><strong>{formatMinutes(todayMinutes)}</strong><span>studied today</span></div><div className="today-stats"><span><Flame className="size-4" /> {streak} day streak</span><span><CheckCircle2 className="size-4" /> {planner.tasks.filter((task) => task.completed).length} tasks done</span></div><Link href="/focus" className="dashboard-card-link">start another round <ChevronRight className="size-4" /></Link></div>
      <div className="paper-card focus-mix-card"><div className="dashboard-card-heading"><div><p className="eyebrow">where your focus goes</p><h2>your focus mix</h2></div><Target className="size-5" /></div>{subjectSummary ? <><div className="mix-highlight"><div className="mix-ring" /><div><strong>{subjectSummary.subject}</strong><span>{formatMinutes(subjectSummary.minutes)} all-time focus</span></div></div><Link href="/stats" className="dashboard-card-link">open full stats <ChevronRight className="size-4" /></Link></> : <p className="dashboard-empty">Start a session to see your subjects bloom here.</p>}</div>
      <div className="paper-card dashboard-tasks-card"><div className="dashboard-card-heading"><div><p className="eyebrow">next on your plate</p><h2>open tasks</h2></div><ListTodo className="size-5" /></div>{openTasks.length ? <div className="dashboard-list">{openTasks.map((task) => <Link href="/tasks" key={task.id}><span className="dashboard-list-dot" /><span><strong>{task.title}</strong><small>{task.dueDate ? formatDate(task.dueDate) : 'no deadline'} · {task.subject}</small></span><ChevronRight className="size-4" /></Link>)}</div> : <p className="dashboard-empty">No open tasks. A soft landing is still productive.</p>}<Link href="/tasks" className="dashboard-card-link">view task notebook <ChevronRight className="size-4" /></Link></div>
      <div className="paper-card dashboard-goal-card"><div className="dashboard-card-heading"><div><p className="eyebrow">the bigger picture</p><h2>one goal at a time</h2></div><Flag className="size-5" /></div>{featuredGoal ? <><strong className="featured-goal-title">{featuredGoal.title}</strong><div className="featured-goal-track"><span style={{ width: `${goalProgress}%` }} /></div><p className="featured-goal-meta">{goalProgress}% complete · {featuredGoalSteps.length} milestones</p>{featuredGoalSteps.slice(0, 2).map((step) => <div key={step.id} className={`featured-step ${step.completed ? 'done' : ''}`}><Check className="size-3.5" />{step.title}</div>)}<Link href="/goals" className="dashboard-card-link">keep building <ChevronRight className="size-4" /></Link></> : <p className="dashboard-empty">What would feel meaningful to make real this year?</p>}</div>
      <div className="paper-card dashboard-events-card"><div className="dashboard-card-heading"><div><p className="eyebrow">coming up</p><h2>important dates</h2></div><CalendarDays className="size-5" /></div>{upcomingEvents.length ? <div className="dashboard-events-list">{upcomingEvents.map((event) => <Link href="/planner" key={event.id}><time><strong>{new Date(`${event.eventDate}T00:00:00`).getDate()}</strong><span>{new Date(`${event.eventDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short' })}</span></time><span><strong>{event.title}</strong><small>{daysUntil(event.eventDate) === 0 ? 'today' : `${daysUntil(event.eventDate)} days away`}</small></span></Link>)}</div> : <p className="dashboard-empty">No important dates yet. Give future-you a little reminder.</p>}<Link href="/planner" className="dashboard-card-link">open calendar <ChevronRight className="size-4" /></Link></div>
    </section>

    <footer className="dashboard-footer">made for the life you&apos;re building · {now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} <span>♡</span></footer>

    <LineConnectModal
      isOpen={isLineModalOpen}
      onClose={() => setIsLineModalOpen(false)}
      user={user}
      onOpenAuth={() => setIsAuthOpen(true)}
    />

    <AuthModal
      isOpen={isAuthOpen}
      onClose={() => setIsAuthOpen(false)}
      user={user}
      onUserChange={(nextUser) => setUser(nextUser)}
    />
  </div></main>
}
