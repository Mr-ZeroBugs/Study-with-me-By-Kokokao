import type { PlannerBehaviorEvent } from '@/lib/adaptive-planner'
import type { PlannerTask } from '@/lib/planner-storage'
import { rhythmRoleForSubject, type KokoRhythmPlan } from '@/lib/rhythm-storage'
import type { DayLog, SubjectDayLogs } from '@/lib/storage'

export type WeeklyReviewAction =
  | { kind: 'route'; label: string; href: '/focus' | '/tasks' | '/stats' }
  | { kind: 'adaptive'; label: string }

export type WeeklyManagerReview = {
  periodLabel: string
  focusMinutes: number
  focusDifference: number
  activeDays: number
  completedTasks: number
  majorMinutes: number
  minorMinutes: number
  headline: string
  summary: string
  wins: string[]
  nextStep: { title: string; detail: string; action: WeeklyReviewAction } | null
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function daysEnding(now: Date, daysAgoStart: number) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now)
    date.setHours(12, 0, 0, 0)
    date.setDate(date.getDate() - daysAgoStart - (6 - index))
    return localDateKey(date)
  })
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

function dayDifference(from: string, to: string) {
  return Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86_400_000)
}

/** A compact, evidence-led weekly review. It deliberately does not diagnose
 * mood or prescribe a schedule; it simply surfaces one useful next decision. */
export function createWeeklyManagerReview(input: {
  now: Date
  logs: DayLog
  subjectLogs: SubjectDayLogs
  tasks: PlannerTask[]
  behaviorEvents: PlannerBehaviorEvent[]
  rhythmPlan: KokoRhythmPlan | null
  adaptiveProposalCount: number
}): WeeklyManagerReview {
  const currentDays = daysEnding(input.now, 0)
  const previousDays = daysEnding(input.now, 7)
  const currentSet = new Set(currentDays)
  const focusMinutes = currentDays.reduce((total, key) => total + Math.max(0, input.logs[key] ?? 0), 0)
  const previousMinutes = previousDays.reduce((total, key) => total + Math.max(0, input.logs[key] ?? 0), 0)
  const activeDays = currentDays.filter((key) => (input.logs[key] ?? 0) > 0).length
  const focusDifference = focusMinutes - previousMinutes
  const completedTasks = input.behaviorEvents.filter((event) => event.type === 'task_completed' && currentSet.has(localDateKey(new Date(event.occurredAt)))).length
  const subjectMinutes = (role: 'major' | 'minor') => Object.entries(input.subjectLogs).reduce((total, [subject, days]) => rhythmRoleForSubject(subject, input.rhythmPlan) === role
    ? total + currentDays.reduce((sum, key) => sum + Math.max(0, days[key] ?? 0), 0)
    : total, 0)
  const majorMinutes = subjectMinutes('major')
  const minorMinutes = subjectMinutes('minor')
  const openPersonal = input.tasks.filter((task) => !task.completed && !task.sourceWorkspaceId)
  const todayKey = localDateKey(input.now)
  const overdue = openPersonal.filter((task) => task.dueDate && dayDifference(task.dueDate, todayKey) > 0)
  const majorTasks = openPersonal.filter((task) => rhythmRoleForSubject(task.subject, input.rhythmPlan) === 'major')

  const wins: string[] = []
  if (activeDays > 0) wins.push(`You showed up on ${activeDays} of the last 7 days.`)
  if (focusDifference > 0 && previousMinutes > 0) wins.push(`${formatMinutes(focusDifference)} more focus than the week before.`)
  if (completedTasks > 0) wins.push(`${completedTasks} task${completedTasks === 1 ? '' : 's'} marked complete from your actual planner activity.`)
  if (majorMinutes > 0) wins.push(`${formatMinutes(majorMinutes)} invested in your Major.`)
  if (!wins.length && focusMinutes > 0) wins.push(`${formatMinutes(focusMinutes)} of real focus still counts as a week in motion.`)

  let headline = 'A quiet week is still data.'
  let summary = 'There is enough here to choose one clear next move without rebuilding your whole life.'
  if (focusMinutes >= 180 && activeDays >= 3) {
    headline = 'Your rhythm had real traction this week.'
    summary = `${formatMinutes(focusMinutes)} across ${activeDays} days is a pattern you can build from.`
  } else if (focusMinutes > 0) {
    headline = 'You kept a thread going.'
    summary = `${formatMinutes(focusMinutes)} across ${activeDays} day${activeDays === 1 ? '' : 's'} gives Koko something concrete to work with.`
  }

  let nextStep: WeeklyManagerReview['nextStep'] = null
  if (overdue.length) nextStep = {
    title: `Reset ${overdue.length} old task${overdue.length === 1 ? '' : 's'}.`,
    detail: 'A deadline that has already passed should become a real decision, not background noise.',
    action: input.adaptiveProposalCount > 0 ? { kind: 'adaptive', label: 'review plan tweaks' } : { kind: 'route', label: 'open tasks', href: '/tasks' },
  }
  else if (majorTasks.length && majorMinutes === 0) nextStep = {
    title: 'Give your Major one small return.',
    detail: 'It stayed quiet this week. One focus block is enough to keep your chosen direction alive.',
    action: { kind: 'route', label: 'start focus', href: '/focus' },
  }
  else if (input.adaptiveProposalCount > 0) nextStep = {
    title: 'Your planner has one useful adjustment.',
    detail: 'Koko found a task that could be made more realistic. Review it before the new week gets busy.',
    action: { kind: 'adaptive', label: 'review plan tweak' },
  }
  else if (focusMinutes > 0 && focusDifference < 0) nextStep = {
    title: 'Keep next week lighter, not stricter.',
    detail: `You logged ${formatMinutes(Math.abs(focusDifference))} less than the previous week. Start with one protected block rather than trying to recover everything at once.`,
    action: { kind: 'route', label: 'open focus', href: '/focus' },
  }
  else if (minorMinutes === 0 && input.rhythmPlan?.minorGroupId) nextStep = {
    title: 'Let your Minor have a small turn.',
    detail: 'Your Major moved this week; a short Minor block can keep the overall plan balanced.',
    action: { kind: 'route', label: 'view rhythm', href: '/stats' },
  }

  const start = new Date(`${currentDays[0]}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const end = new Date(`${currentDays.at(-1)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return { periodLabel: `${start} – ${end}`, focusMinutes, focusDifference, activeDays, completedTasks, majorMinutes, minorMinutes, headline, summary, wins: wins.slice(0, 3), nextStep }
}
