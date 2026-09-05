'use client'

import Link from 'next/link'
import {
  ArrowUpRight, CalendarDays, CheckCircle2, Circle,
  Flag, MessageCircle,
  Sparkles, Timer, Zap,
  ClipboardPenLine, BarChart3,
  BellRing, X,
} from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import type { PlannerEvent, PlannerTask } from '../lib/planner-storage'
import { type QuestDef, type QuestData, type GameState } from '../lib/gamification'
import type { SubjectDayLogs } from '../lib/storage'
import { setPendingFocusSubject, type NextBestAction } from '../lib/next-best-action'
import type { KokoPresentation } from '../lib/personalization'
import type { ProactiveWindow } from '../lib/proactive-window'

// ─── Types ────────────────────────────────────────────────────────

type Props = {
  now: Date
  user: User | null
  todayMinutes: number
  totalMinutes: number
  streak: number
  level: number
  xpIntoLevel: number
  xpToNextLevel: number
  xpProgress: number
  gameState: GameState
  quests: QuestDef[]
  questData: QuestData
  weekMinutes: number
  weekTimeLeft: string
  todayTasks: PlannerTask[]
  openTasks: PlannerTask[]
  completedTodayCount: number
  upcomingEvents: PlannerEvent[]
  subjectLogs: SubjectDayLogs
  nextBestAction: NextBestAction | null
  proactiveWindow: ProactiveWindow | null
  presentation: KokoPresentation
  onAcceptNextAction: (task: PlannerTask) => void
  onDismissNextAction: (task: PlannerTask, eventType?: 'dismissed' | 'not_helpful') => void
  onAcceptProactive: (task: PlannerTask) => void
  onDismissProactive: (task: PlannerTask) => void
  onOpenLine: () => void
  onOpenInbox: () => void
  onOpenWeeklyReview: () => void
}

// ─── Helpers ──────────────────────────────────────────────────────

function minutesLabel(m: number) {
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ''}`.trim()
}

function relDate(date: string, now: Date) {
  if (!date) return ''
  const diff = Math.round(
    (new Date(`${date}T00:00:00`).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime())
    / 86_400_000
  )
  if (diff < 0)  return `${Math.abs(diff)}d overdue`
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  return `in ${diff}d`
}

function priorityDot(p: number) {
  if (p === 1) return '#ee8d92'
  if (p === 2) return '#f9c74f'
  return '#9fcbb0'
}

function NextBestActionCard({ action, presentation, onAccept, onDismiss }: { action: NextBestAction | null; presentation: KokoPresentation; onAccept: (task: PlannerTask) => void; onDismiss: (task: PlannerTask, eventType?: 'dismissed' | 'not_helpful') => void }) {
  if (!action) {
    return (
      <div className="hd-next-action hd-next-action--empty">
        <div><p className="hd-eyebrow">koko&apos;s next move</p><h2>Nothing urgent to pull you.</h2><p>Add one small task when you&apos;re ready.</p></div>
        <div className="hd-next-action-empty-actions"><Link href="/tasks" className="hd-next-action-cta">ADD A TASK <ArrowUpRight className="size-3" /></Link></div>
      </div>
    )
  }
  const { task, reasons, role } = action
  return (
    <section className="hd-next-action" aria-label="Recommended next action">
      <div className="hd-next-action-mark"><Sparkles className="size-4" /></div>
      <div className="hd-next-action-copy">
        <p className="hd-eyebrow">koko&apos;s next move</p>
        <h2>{task.title}</h2>
        <p className="hd-next-action-meta">{task.subject} · {task.estimatedMinutes} min{role !== 'unassigned' ? ` · ${role}` : ''}</p>
        <p className="hd-next-action-reason">{[...reasons, presentation.gentleNudge].filter(Boolean).slice(0, 2).join(' · ')}</p>
      </div>
      <div className="hd-next-action-actions">
        <Link href="/focus" onClick={() => { setPendingFocusSubject(task.subject); onAccept(task) }} className="hd-next-action-cta">{presentation.focusCta} <Timer className="size-3" /></Link>
        <Link href="/tasks" className="hd-next-action-view">VIEW TASK <ArrowUpRight className="size-3" /></Link>
        <button type="button" onClick={() => onDismiss(task)} className="hd-next-action-dismiss">NOT NOW</button>
      </div>
    </section>
  )
}

function ProactiveWindowCard({ window, action, presentation, onAccept, onDismiss }: { window: ProactiveWindow | null; action: NextBestAction | null; presentation: KokoPresentation; onAccept: (task: PlannerTask) => void; onDismiss: (task: PlannerTask) => void }) {
  if (!window || !action || action.task.id !== window.taskId) return null
  return (
    <section className="hd-proactive-window" aria-label="A quiet focus-window suggestion">
      <div className="hd-proactive-icon"><BellRing className="size-3.5" /></div>
      <div className="hd-proactive-copy"><strong>{window.title}</strong><span>{window.detail}</span></div>
      <div className="hd-proactive-actions">
        <Link href="/focus" onClick={() => { setPendingFocusSubject(action.task.subject); onAccept(action.task) }}>{presentation.focusCta} <Timer className="size-3" /></Link>
        <button type="button" onClick={() => onDismiss(action.task)} aria-label="Dismiss this focus-window suggestion"><X className="size-3.5" /></button>
      </div>
    </section>
  )
}

// ─── Sub-cards ────────────────────────────────────────────────────

function TodayPlanCard({ tasks, completedCount, now }: { tasks: PlannerTask[]; completedCount: number; now: Date }) {
  const show = tasks.slice(0, 5)
  return (
    <div className="hd-card hd-plan">
      <div className="hd-card-top">
        <div>
          <p className="hd-eyebrow">your next moves</p>
          <h2 className="hd-card-title">today&apos;s little plan</h2>
        </div>
        <Link href="/tasks" className="hd-card-action">OPEN NOTEBOOK <ArrowUpRight className="size-3" /></Link>
      </div>
      <div className="hd-task-list">
        {show.length === 0 ? (
          <p className="hd-empty">No tasks for today — enjoy the calm, or <Link href="/tasks">add one</Link>.</p>
        ) : show.map((t, i) => (
          <div key={t.id} className="hd-task-row">
            <span className="hd-task-num">{String(i + 1).padStart(2, '0')}</span>
            <span className="hd-task-dot" style={{ background: priorityDot(t.priority) }} />
            <div className="hd-task-body">
              <span className="hd-task-title">{t.title}</span>
              <span className="hd-task-meta">
                {t.dueDate && relDate(t.dueDate, now)} · priority {t.priority} · {t.subject}
              </span>
            </div>
            <ArrowUpRight className="size-3 hd-task-arr" />
          </div>
        ))}
      </div>
      <div className="hd-card-foot">
        <span>{completedCount} tasks completed</span>
        <Link href="/tasks">planned for today</Link>
      </div>
    </div>
  )
}

function CalendarCard({ now, events, tasks }: { now: Date; events: PlannerEvent[]; tasks: PlannerTask[] }) {
  const month  = now.toLocaleDateString('en-US', { month: 'long' })
  const year   = now.getFullYear()
  const mStart = new Date(year, now.getMonth(), 1)
  const startDow = mStart.getDay()
  const daysInMonth = new Date(year, now.getMonth() + 1, 0).getDate()
  const eventDates = new Set(events.map(e => e.eventDate))
  const taskDates = new Set(tasks.filter((task) => !task.completed && task.dueDate).map((task) => task.dueDate))

  const days: (number | null)[] = [
    ...Array(startDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  const paddedDays = [...days, ...Array((7 - days.length % 7) % 7).fill(null)]

  return (
    <div className="hd-card hd-cal">
      <div className="hd-card-top">
        <div>
          <p className="hd-eyebrow">see the shape of your month</p>
          <h2 className="hd-cal-month">{month}</h2>
        </div>
        <Link href="/planner" className="hd-card-action">FULL CALENDAR <ArrowUpRight className="size-3" /></Link>
      </div>
      <div className="hd-cal-grid">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
          <span key={d} className="hd-cal-dow">{d}</span>
        ))}
        {paddedDays.map((d, i) => {
          if (!d) return <span key={`e-${i}`} />
          const dateKey = `${year}-${String(now.getMonth()+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
          const isToday = d === now.getDate()
          const hasEvent = eventDates.has(dateKey)
          const hasTask = taskDates.has(dateKey)
          return (
            <span key={dateKey} className={`hd-cal-day${isToday ? ' today' : ''}${hasEvent ? ' has-event' : ''}${hasTask ? ' has-task' : ''}`}>
              {d}
              {hasEvent && <i />}
              {hasTask && <i className="task-dot" />}
            </span>
          )
        })}
      </div>
      <div className="hd-cal-legend">
        <span><i className="hd-dot-event" />important date</span>
        <span><i className="hd-dot-task" />task due</span>
      </div>
    </div>
  )
}

function TodaySnapshot({ todayMinutes, streak, completedCount }: { todayMinutes: number; streak: number; completedCount: number }) {
  return (
    <section className="hd-snapshot" aria-label="Today at a glance">
      <div>
        <span>focus today</span>
        <strong>{minutesLabel(todayMinutes)}</strong>
      </div>
      <div>
        <span>current streak</span>
        <strong>{streak} <small>days</small></strong>
      </div>
      <div>
        <span>tasks completed</span>
        <strong>{completedCount}</strong>
      </div>
    </section>
  )
}

function FocusMixCard({ subjectLogs }: { subjectLogs: SubjectDayLogs }) {
  const subjects = Object.entries(subjectLogs)
    .map(([subject, days]) => ({ subject, minutes: Object.values(days).reduce((s, v) => s + v, 0) }))
    .filter(s => s.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 4)

  const total = subjects.reduce((s, x) => s + x.minutes, 0)
  const colors = ['#9fcbb0', '#f9c74f', '#c19bcf', '#ee8d92']

  return (
    <div className="hd-card hd-mix">
      <div className="hd-card-top">
        <p className="hd-eyebrow">where your focus goes</p>
        <Zap className="size-4 hd-card-icon" />
      </div>
      <h2 className="hd-card-title">your focus mix</h2>
      {subjects.length === 0 ? (
        <p className="hd-empty">No sessions yet. Start one to see your mix.</p>
      ) : (
        <>
          <div className="hd-mix-donut-wrap">
            <svg viewBox="0 0 80 80" className="hd-mix-donut">
              {(() => {
                let offset = 0
                const r = 28, circ = 2 * Math.PI * r
                return subjects.map((s, i) => {
                  const pct = total > 0 ? s.minutes / total : 0
                  const dash = pct * circ
                  const el = (
                    <circle key={s.subject} cx="40" cy="40" r={r}
                      fill="none" stroke={colors[i % colors.length]} strokeWidth="12"
                      strokeDasharray={`${dash} ${circ - dash}`}
                      strokeDashoffset={-offset * circ / 1}
                      transform="rotate(-90 40 40)" />
                  )
                  offset += pct * circ
                  return el
                })
              })()}
            </svg>
            <div className="hd-mix-donut-center">
              <strong>{minutesLabel(total)}</strong>
              <small>all-time</small>
            </div>
          </div>
          <div className="hd-mix-list">
            {subjects.map((s, i) => (
              <div key={s.subject} className="hd-mix-row">
                <span className="hd-mix-color" style={{ background: colors[i % colors.length] }} />
                <span className="hd-mix-name">{s.subject}</span>
                <span className="hd-mix-time">{minutesLabel(s.minutes)} all-time focus</span>
              </div>
            ))}
          </div>
        </>
      )}
      <Link href="/stats" className="hd-card-foot-link">OPEN FULL STATS <ArrowUpRight className="size-3" /></Link>
    </div>
  )
}

function OpenTasksCard({ tasks, now }: { tasks: PlannerTask[]; now: Date }) {
  const show = tasks.slice(0, 4)
  return (
    <div className="hd-card hd-tasks">
      <div className="hd-card-top">
        <p className="hd-eyebrow">next on your plate</p>
        <CheckCircle2 className="size-4 hd-card-icon" />
      </div>
      <h2 className="hd-card-title">open tasks</h2>
      <div className="hd-open-list">
        {show.length === 0 ? (
          <p className="hd-empty">All clear — nothing open right now.</p>
        ) : show.map(t => (
          <div key={t.id} className="hd-open-row">
            <Circle className="size-3.5 hd-open-circle" />
            <div className="hd-open-body">
              <span className="hd-open-title">{t.title}</span>
              <span className="hd-open-meta">{t.dueDate && relDate(t.dueDate, now)} · {t.subject}</span>
            </div>
            <ArrowUpRight className="size-3 hd-task-arr" />
          </div>
        ))}
      </div>
      <Link href="/tasks" className="hd-card-foot-link">VIEW TASK NOTEBOOK <ArrowUpRight className="size-3" /></Link>
    </div>
  )
}

function RhythmCard() {
  return (
    <div className="hd-card hd-goal">
      <div className="hd-card-top">
        <div>
          <p className="hd-eyebrow">the bigger picture</p>
          <h2 className="hd-card-title">one goal at a time</h2>
        </div>
        <Flag className="size-4 hd-card-icon" />
      </div>
      <p className="hd-goal-name">Build a rhythm that fits you.</p>
      <p className="hd-goal-meta">Choose one Major and one Minor, then let the rest stay lighter.</p>
      <Link href="/goals" className="hd-card-foot-link">OPEN KOKO RHYTHM <ArrowUpRight className="size-3" /></Link>
    </div>
  )
}

function UpcomingCard({ events }: { events: PlannerEvent[] }) {
  const show = events.slice(0, 3)
  return (
    <div className="hd-card hd-upcoming">
      <div className="hd-card-top">
        <div>
          <p className="hd-eyebrow">coming up</p>
          <h2 className="hd-card-title">important dates</h2>
        </div>
        <CalendarDays className="size-4 hd-card-icon" />
      </div>
      {show.length === 0 ? (
        <p className="hd-empty">No important dates yet. Give future-you a little reminder.</p>
      ) : (
        <div className="hd-upcoming-list">
          {show.map(e => (
            <div key={e.id} className="hd-upcoming-row">
              <span className="hd-upcoming-date">{new Date(`${e.eventDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              <span className="hd-upcoming-title">{e.title}</span>
              <span className={`hd-upcoming-type hd-type-${e.type}`}>{e.type}</span>
            </div>
          ))}
        </div>
      )}
      <Link href="/planner" className="hd-card-foot-link">OPEN CALENDAR <ArrowUpRight className="size-3" /></Link>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────

export function KokoRoom({
  now, user,
  todayMinutes, streak,
  todayTasks, openTasks, completedTodayCount,
  upcomingEvents,
  subjectLogs, nextBestAction, proactiveWindow, presentation, onAcceptNextAction, onDismissNextAction, onAcceptProactive, onDismissProactive, onOpenLine, onOpenInbox, onOpenWeeklyReview,
}: Props) {
  return (
    <main className="hd-page">
      <div className="hd-shell">

        <header className="hd-header">
          <div className="hd-header-left">
            <p className="hd-eyebrow">your study space</p>
            <h1 className="hd-heading">Make room for what matters.</h1>
            <p className="hd-subhead">A quiet overview of your focus, tasks, and the days ahead.</p>
            <div className="hd-header-badges">
              <span className="hd-sync-badge">
                <span className="hd-sync-dot" />
                {user ? 'your plan is synced' : 'saved on device'}
              </span>
              <button type="button" className="hd-line-badge" onClick={onOpenLine}>
                <MessageCircle className="size-3" />line reminders
              </button>
              <button type="button" className="hd-inbox-badge" onClick={onOpenInbox}>
                <ClipboardPenLine className="size-3" />koko inbox
              </button>
              <button type="button" className="hd-review-badge" onClick={onOpenWeeklyReview}>
                <BarChart3 className="size-3" />weekly review
              </button>
            </div>
          </div>
          <div className="hd-header-right">
            <div className="hd-date-card">
              <span className="hd-date-dow">{now.toLocaleDateString('en-US', { weekday: 'long' })}</span>
              <span className="hd-date-mon">{now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
            </div>
          </div>
        </header>

        <ProactiveWindowCard window={proactiveWindow} action={nextBestAction} presentation={presentation} onAccept={onAcceptProactive} onDismiss={onDismissProactive} />
        <NextBestActionCard action={nextBestAction} presentation={presentation} onAccept={onAcceptNextAction} onDismiss={onDismissNextAction} />
        <TodaySnapshot todayMinutes={todayMinutes} streak={streak} completedCount={completedTodayCount} />

        <div className="hd-grid">
          <div className="hd-main-grid">
            <TodayPlanCard tasks={todayTasks} completedCount={completedTodayCount} now={now} />
            <div className="hd-side-stack">
              <CalendarCard now={now} events={upcomingEvents} tasks={openTasks} />
              <UpcomingCard events={upcomingEvents} />
            </div>
          </div>
          <div className="hd-secondary-grid">
            <FocusMixCard subjectLogs={subjectLogs} />
            <OpenTasksCard tasks={openTasks} now={now} />
            <RhythmCard />
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────── */}
        <footer className="hd-footer">
          <Sparkles className="size-3.5" />
          made for the life you&apos;re building · {now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
        </footer>
      </div>
    </main>
  )
}
