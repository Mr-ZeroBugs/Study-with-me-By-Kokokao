import type { PlannerTask } from '@/lib/planner-storage'
import type { KokoRhythmPlan } from '@/lib/rhythm-storage'
import { rhythmRoleForSubject } from '@/lib/rhythm-storage'
import type { DayLog, StudyInterval, SubjectDayLogs } from '@/lib/storage'

export type PlannerBehaviorType = 'next_action_accepted' | 'task_completed'

export type PlannerBehaviorEvent = {
  id: string
  type: PlannerBehaviorType
  subject: string
  taskId?: string
  occurredAt: string
}

export type AdaptiveSignals = Record<string, { accepted: number; completed: number }>

export function buildAdaptiveSignals(events: PlannerBehaviorEvent[]): AdaptiveSignals {
  return events.reduce<AdaptiveSignals>((signals, event) => {
    const subject = event.subject.trim() || 'General'
    const signal = signals[subject] ?? { accepted: 0, completed: 0 }
    if (event.type === 'next_action_accepted') signal.accepted += 1
    if (event.type === 'task_completed') signal.completed += 1
    signals[subject] = signal
    return signals
  }, {})
}

// Bounded on purpose: behavioral fit can settle a close choice, but it can
// never overpower a real deadline.
export function adaptiveSubjectBoost(subject: string, signals: AdaptiveSignals) {
  const signal = signals[subject]
  if (!signal) return 0
  return Math.min(9, signal.accepted * 2 + signal.completed)
}

export type AdaptiveProposal =
  | {
      id: string
      kind: 'reschedule'
      task: PlannerTask
      suggestedDate: string
      title: string
      detail: string
    }
  | {
      id: string
      kind: 'split'
      task: PlannerTask
      firstPartDueDate: string
      title: string
      detail: string
    }
  | {
      id: string
      kind: 'estimate'
      task: PlannerTask
      suggestedMinutes: number
      title: string
      detail: string
    }
  | {
      id: string
      kind: 'capacity'
      dateKey: string
      plannedMinutes: number
      typicalMinutes: number
      title: string
      detail: string
    }

function localDayDifference(from: string, to: string) {
  return Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86_400_000)
}

function dateAfter(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00`)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function recentSubjectMinutes(subjectLogs: SubjectDayLogs, subject: string, todayKey: string) {
  const days = subjectLogs[subject] ?? {}
  return Array.from({ length: 7 }, (_, index) => days[dateAfter(todayKey, -index)] ?? 0).reduce((sum, minutes) => sum + minutes, 0)
}

function median(values: number[]) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

function roundedMinutes(minutes: number) {
  return Math.max(5, Math.min(180, Math.round(minutes / 5) * 5))
}

function typicalDailyFocus(logs: DayLog, todayKey: string) {
  const recent = Array.from({ length: 14 }, (_, index) => logs[dateAfter(todayKey, -index)] ?? 0)
    .filter((minutes) => minutes >= 20 && minutes <= 360)
  return recent.length >= 3 ? median(recent) : 0
}

function typicalSubjectFocus(intervals: StudyInterval[], subject: string) {
  const matching = intervals
    .filter((interval) => interval.subject === subject && interval.mode === 'focus')
    .map((interval) => Math.round(interval.durationSeconds / 60))
    .filter((minutes) => minutes >= 10 && minutes <= 180)
    .slice(-12)
  return matching.length >= 3 ? median(matching) : 0
}

/**
 * Produces a deliberately small set of explainable plan repairs. A proposal is
 * never a mutation: the UI must show it and the learner must explicitly apply
 * it through the Action Gateway. Shared tasks stay read-only in this flow.
 */
export function buildAdaptiveProposals(input: {
  tasks: PlannerTask[]
  todayKey: string
  subjectLogs: SubjectDayLogs
  rhythmPlan: KokoRhythmPlan | null
  dailyLogs?: DayLog
  intervals?: StudyInterval[]
}): AdaptiveProposal[] {
  const personalOpen = input.tasks.filter((task) => !task.completed && !task.sourceWorkspaceId)
  const proposals: AdaptiveProposal[] = []
  const handled = new Set<string>()

  // Capacity is deliberately based only on recorded focus and task estimates.
  // Important dates have no duration field, so Koko never pretends it knows a
  // calendar conflict that the data cannot actually prove.
  const typicalDay = typicalDailyFocus(input.dailyLogs ?? {}, input.todayKey)
  const todayPlanned = personalOpen.filter((task) => task.dueDate === input.todayKey)
  const plannedMinutes = todayPlanned.reduce((sum, task) => sum + Math.max(0, task.estimatedMinutes), 0)
  if (todayPlanned.length >= 2 && typicalDay > 0 && plannedMinutes > typicalDay + 45) {
    proposals.push({
      id: `capacity:${input.todayKey}`,
      kind: 'capacity',
      dateKey: input.todayKey,
      plannedMinutes,
      typicalMinutes: typicalDay,
      title: 'Today is carrying more than your usual focus load.',
      detail: `${plannedMinutes} minutes of due-today work is planned, while your recent focused days usually land near ${typicalDay} minutes. Nothing was moved—choose which task gets the first protected block.`,
    })
  }

  const overdue = personalOpen
    .filter((task) => task.dueDate && localDayDifference(input.todayKey, task.dueDate) < 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
  if (overdue) {
    const daysOverdue = Math.abs(localDayDifference(input.todayKey, overdue.dueDate))
    proposals.push({
      id: `reschedule:${overdue.id}`,
      kind: 'reschedule',
      task: overdue,
      suggestedDate: dateAfter(input.todayKey, 1),
      title: `Give “${overdue.title}” a real next date.`,
      detail: `It is ${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue. Moving it to tomorrow keeps it visible without pretending the old date still works.`,
    })
    handled.add(overdue.id)
  }

  const largeNearDeadline = personalOpen
    .filter((task) => !handled.has(task.id) && task.estimatedMinutes > 50 && task.dueDate)
    .map((task) => ({ task, days: localDayDifference(input.todayKey, task.dueDate) }))
    .filter(({ days }) => days >= 0 && days <= 7)
    .sort((a, b) => a.days - b.days || b.task.estimatedMinutes - a.task.estimatedMinutes)[0]
  if (largeNearDeadline) {
    const { task, days } = largeNearDeadline
    const firstPartDueDate = days > 1 ? input.todayKey : task.dueDate
    proposals.push({
      id: `split:${task.id}`,
      kind: 'split',
      task,
      firstPartDueDate,
      title: `Split “${task.title}” into two starts.`,
      detail: `${task.estimatedMinutes} minutes is a lot to hold in one task${days === 0 ? ' today' : ''}. Koko can replace it with two smaller steps while keeping the same subject and final deadline.`,
    })
    handled.add(task.id)
  }

  // A neglected major should surface only when it has a concrete open task.
  // This is a gentle route back to the learner's chosen direction, never an
  // assumption about their mood or a demand to abandon a true deadline.
  const majorTask = personalOpen
    .filter((task) => !handled.has(task.id) && task.estimatedMinutes > 30 && rhythmRoleForSubject(task.subject, input.rhythmPlan) === 'major')
    .find((task) => recentSubjectMinutes(input.subjectLogs, task.subject, input.todayKey) === 0)
  if (majorTask && (!majorTask.dueDate || localDayDifference(input.todayKey, majorTask.dueDate) > 1)) {
    proposals.push({
      id: `split:${majorTask.id}`,
      kind: 'split',
      task: majorTask,
      firstPartDueDate: input.todayKey,
      title: `Make a smaller doorway into your Major.`,
      detail: `“${majorTask.title}” belongs to your Major and has not had focus in the last 7 days. Splitting it preserves the direction while lowering the cost of starting.`,
    })
  }

  // A focus interval is not proof that one exact task took longer. It is only
  // a transparent subject-level calibration suggestion that the learner can
  // accept or ignore before a deadline becomes misleading.
  const estimateCandidate = personalOpen
    .filter((task) => !handled.has(task.id) && task.estimatedMinutes <= 90)
    .map((task) => ({ task, typicalMinutes: typicalSubjectFocus(input.intervals ?? [], task.subject) }))
    .filter(({ task, typicalMinutes }) => typicalMinutes >= task.estimatedMinutes + 20)
    .sort((a, b) => (b.typicalMinutes - b.task.estimatedMinutes) - (a.typicalMinutes - a.task.estimatedMinutes))[0]
  if (estimateCandidate) {
    const suggestedMinutes = roundedMinutes(estimateCandidate.typicalMinutes)
    proposals.push({
      id: `estimate:${estimateCandidate.task.id}:${suggestedMinutes}`,
      kind: 'estimate', task: estimateCandidate.task, suggestedMinutes,
      title: `Calibrate the estimate for “${estimateCandidate.task.title}”.`,
      detail: `Your recent ${estimateCandidate.task.subject} focus blocks usually last about ${estimateCandidate.typicalMinutes} minutes. This is not a claim about this task—just a chance to make the plan less tight.`,
    })
  }

  return proposals.slice(0, 3)
}
