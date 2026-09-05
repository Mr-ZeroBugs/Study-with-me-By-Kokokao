import type { PlannerTask } from '@/lib/planner-storage'
import { rhythmRoleForSubject, type KokoRhythmPlan, type RhythmRole } from '@/lib/rhythm-storage'
import type { SubjectDayLogs } from '@/lib/storage'
import { adaptiveSubjectBoost, type AdaptiveSignals } from '@/lib/adaptive-planner'

export type NextBestAction = {
  task: PlannerTask
  score: number
  reasons: string[]
  role: RhythmRole
}

const PENDING_FOCUS_SUBJECT_KEY = 'koko_pending_focus_subject_v1'

function localDayDifference(dueDate: string, todayKey: string) {
  if (!dueDate) return null
  const today = new Date(`${todayKey}T00:00:00`)
  const due = new Date(`${dueDate}T00:00:00`)
  return Math.round((due.getTime() - today.getTime()) / 86_400_000)
}

function deadlineSignal(days: number | null) {
  if (days === null) return { score: 8, reason: '' }
  if (days < 0) return { score: 92, reason: 'overdue' }
  if (days === 0) return { score: 78, reason: 'due today' }
  if (days === 1) return { score: 60, reason: 'due tomorrow' }
  if (days <= 3) return { score: 42, reason: `due in ${days} days` }
  if (days <= 7) return { score: 24, reason: `due this week` }
  return { score: 12, reason: '' }
}

function startabilitySignal(minutes: number) {
  if (minutes <= 25) return { score: 18, reason: 'small enough to start now' }
  if (minutes <= 45) return { score: 11, reason: 'fits one focus block' }
  if (minutes <= 60) return { score: 5, reason: '' }
  return { score: 0, reason: '' }
}

function rhythmSignal(role: RhythmRole) {
  if (role === 'major') return { score: 16, reason: 'moves your major forward' }
  if (role === 'minor') return { score: 10, reason: 'keeps your minor moving' }
  if (role === 'maintenance') return { score: 4, reason: 'a light maintenance step' }
  return { score: 0, reason: '' }
}

// A deterministic, explainable ranker is the right first version. It gives us
// outcome data before we ever try to learn opaque per-user weights.
export function chooseNextBestAction(input: {
  tasks: PlannerTask[]
  todayKey: string
  rhythmPlan: KokoRhythmPlan | null
  subjectLogs: SubjectDayLogs
  adaptiveSignals?: AdaptiveSignals
  excludedTaskIds?: string[]
}): NextBestAction | null {
  const excluded = new Set(input.excludedTaskIds ?? [])
  const candidates = input.tasks.filter((task) => !task.completed && !excluded.has(task.id))
  if (!candidates.length) return null

  const ranked = candidates.map((task) => {
    const days = localDayDifference(task.dueDate, input.todayKey)
    const deadline = deadlineSignal(days)
    const role = rhythmRoleForSubject(task.subject, input.rhythmPlan)
    const rhythm = rhythmSignal(role)
    const startability = startabilitySignal(task.estimatedMinutes)
    const studiedToday = input.subjectLogs[task.subject]?.[input.todayKey] ?? 0
    // A very long session in one subject should make room for another task;
    // it is a gentle tiebreaker, never strong enough to ignore a deadline.
    const saturation = studiedToday >= 120 ? -7 : studiedToday >= 75 ? -3 : 0
    const priority = task.priority === 3 ? 6 : task.priority === 2 ? 3 : 0
    const adaptive = adaptiveSubjectBoost(task.subject, input.adaptiveSignals ?? {})
    const score = deadline.score + rhythm.score + startability.score + saturation + priority + adaptive
    const behaviorReason = adaptive >= 4 ? 'a subject you often follow through with' : ''
    const reasons = [deadline.reason, rhythm.reason, behaviorReason, startability.reason].filter(Boolean).slice(0, 2)
    return { task, score, reasons, role }
  })

  return ranked.sort((a, b) => b.score - a.score || a.task.createdAt.localeCompare(b.task.createdAt))[0] ?? null
}

export function setPendingFocusSubject(subject: string) {
  if (typeof window === 'undefined' || !subject.trim()) return
  window.localStorage.setItem(PENDING_FOCUS_SUBJECT_KEY, subject.trim())
}

export function takePendingFocusSubject() {
  if (typeof window === 'undefined') return null
  const subject = window.localStorage.getItem(PENDING_FOCUS_SUBJECT_KEY)?.trim() || null
  window.localStorage.removeItem(PENDING_FOCUS_SUBJECT_KEY)
  return subject
}
