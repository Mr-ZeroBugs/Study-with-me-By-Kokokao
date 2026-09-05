import type { PlannerTask } from '@/lib/planner-storage'
import type { KokoRhythmPlan } from '@/lib/rhythm-storage'
import { rhythmRoleForSubject } from '@/lib/rhythm-storage'
import type { DayLog, StudyInterval, SubjectDayLogs } from '@/lib/storage'

export type StudyInsight = {
  id: 'deadline-start' | 'best-window' | 'steady-rhythm' | 'small-win' | 'overdue-reset' | 'major-gap' | 'focus-balance' | 'long-flow'
  title: string
  detail: string
  action: { label: string; href: '/focus' | '/tasks' | '/stats' } | null
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function dayDifference(from: string, to: string) {
  return Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86_400_000)
}

function recentSubjectMinutes(subjectLogs: SubjectDayLogs, subject: string, today: Date) {
  const days = subjectLogs[subject] ?? {}
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today)
    date.setDate(today.getDate() - index)
    return days[dateKey(date)] ?? 0
  }).reduce((sum, minutes) => sum + minutes, 0)
}

function bestFocusWindow(intervals: StudyInterval[]) {
  const buckets = new Map<number, number>()
  for (const interval of intervals) {
    if (interval.mode !== 'focus') continue
    const start = new Date(interval.startedAt)
    if (!Number.isFinite(start.getTime())) continue
    buckets.set(start.getHours(), (buckets.get(start.getHours()) ?? 0) + interval.durationSeconds / 60)
  }
  const best = [...buckets.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!best || best[1] < 30) return null
  return best[0] < 12 ? 'morning' : best[0] < 17 ? 'afternoon' : 'evening'
}

// Insights describe evidence already present in the learner's data. They do
// not diagnose mood, infer health, or turn a temporary dip into a judgment.
function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes} minutes`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

function largestFocusSession(intervals: StudyInterval[]) {
  return intervals.filter((interval) => interval.mode === 'focus').reduce((max, interval) => Math.max(max, interval.durationSeconds / 60), 0)
}

export function createActionableInsights(input: { now: Date; logs: DayLog; intervals: StudyInterval[]; subjectLogs: SubjectDayLogs; tasks: PlannerTask[]; rhythmPlan?: KokoRhythmPlan | null }): StudyInsight[] {
  const todayKey = dateKey(input.now)
  const insights: StudyInsight[] = []
  const closeDeadline = input.tasks
    .filter((task) => !task.completed && task.dueDate)
    .map((task) => ({ task, days: dayDifference(todayKey, task.dueDate) }))
    .filter(({ days }) => days >= 0 && days <= 3)
    .sort((a, b) => a.days - b.days)[0]

  if (closeDeadline && recentSubjectMinutes(input.subjectLogs, closeDeadline.task.subject, input.now) === 0) {
    const timing = closeDeadline.days === 0 ? 'is due today' : closeDeadline.days === 1 ? 'is due tomorrow' : `is due in ${closeDeadline.days} days`
    insights.push({ id: 'deadline-start', title: `A small start could protect “${closeDeadline.task.title}”.`, detail: `${closeDeadline.task.subject} ${timing}, and there is no recent focus logged for it. One short round is enough to make the next step clearer.`, action: { label: 'focus this subject', href: '/focus' } })
  }

  const overdue = input.tasks
    .filter((task) => !task.completed && !task.sourceWorkspaceId && task.dueDate && dayDifference(task.dueDate, todayKey) > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
  if (overdue) insights.push({
    id: 'overdue-reset',
    title: `“${overdue.title}” still carries an old date.`,
    detail: 'An overdue date is useful only if it still helps you choose a next step. Refresh it in Koko’s plan adjustments, or decide deliberately to let it go.',
    action: { label: 'review planner', href: '/tasks' },
  })

  const majorSubjects = Array.from(new Set(input.tasks
    .filter((task) => !task.completed && rhythmRoleForSubject(task.subject, input.rhythmPlan) === 'major')
    .map((task) => task.subject)))
  const neglectedMajor = majorSubjects.find((subject) => recentSubjectMinutes(input.subjectLogs, subject, input.now) === 0)
  if (neglectedMajor && !insights.some((insight) => insight.id === 'deadline-start')) insights.push({
    id: 'major-gap',
    title: `${neglectedMajor} has not had a focus block this week.`,
    detail: 'It is part of your chosen Major, so a short return can protect the direction without turning it into a guilt task.',
    action: { label: 'focus this subject', href: '/focus' },
  })

  const subjectTotals = Object.entries(input.subjectLogs)
    .map(([subject, days]) => ({ subject, minutes: Object.values(days).reduce((sum, minutes) => sum + minutes, 0) }))
    .filter((item) => item.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes)
  const allSubjectMinutes = subjectTotals.reduce((sum, item) => sum + item.minutes, 0)
  const dominant = subjectTotals[0]
  const openSubjects = new Set(input.tasks.filter((task) => !task.completed).map((task) => task.subject))
  if (dominant && allSubjectMinutes >= 180 && dominant.minutes / allSubjectMinutes >= .78 && openSubjects.size >= 2) insights.push({
    id: 'focus-balance',
    title: `${dominant.subject} holds most of your recorded focus.`,
    detail: `${Math.round((dominant.minutes / allSubjectMinutes) * 100)}% of all tracked study time is there. That may be intentional; if not, choose one small block for another open subject this week.`,
    action: { label: 'view subjects', href: '/stats' },
  })

  const window = bestFocusWindow(input.intervals)
  if (window) insights.push({ id: 'best-window', title: `Your focus often lands best in the ${window}.`, detail: 'That pattern comes from your recorded start times—not a guess about your energy. Protect that window for the work that needs more thinking.', action: null })

  const currentWeek = Array.from({ length: 7 }, (_, index) => { const date = new Date(input.now); date.setDate(input.now.getDate() - index); return input.logs[dateKey(date)] ?? 0 }).reduce((sum, minutes) => sum + minutes, 0)
  const previousWeek = Array.from({ length: 7 }, (_, index) => { const date = new Date(input.now); date.setDate(input.now.getDate() - 7 - index); return input.logs[dateKey(date)] ?? 0 }).reduce((sum, minutes) => sum + minutes, 0)
  if (currentWeek >= 60 && currentWeek > previousWeek * 1.2) insights.push({ id: 'steady-rhythm', title: 'Your rhythm is gaining shape.', detail: `You logged ${currentWeek - previousWeek} more focused minutes than the previous 7 days. Keep the routine small enough to repeat.`, action: null })

  const longestFlow = largestFocusSession(input.intervals)
  if (longestFlow >= 150) insights.push({
    id: 'long-flow',
    title: `Your longest focus block reached ${formatMinutes(Math.round(longestFlow))}.`,
    detail: 'That is a real deep-work stretch. Treat recovery as part of the system so long sessions remain useful instead of quietly draining the next one.',
    action: { label: 'open focus', href: '/focus' },
  })

  const smallTask = input.tasks.find((task) => !task.completed && task.estimatedMinutes <= 25 && (!task.dueDate || dayDifference(todayKey, task.dueDate) <= 7))
  if (smallTask && !insights.some((insight) => insight.id === 'deadline-start')) insights.push({ id: 'small-win', title: `“${smallTask.title}” fits a small win.`, detail: `It is estimated at ${smallTask.estimatedMinutes} minutes, so it can be a useful bridge when starting feels heavier than the task itself.`, action: { label: 'open task', href: '/tasks' } })

  // Keep the read compact: the engine should leave the learner with one or
  // two useful decisions, not a dashboard of judgments.
  return insights.slice(0, 3)
}
