import type { NextBestAction } from '@/lib/next-best-action'
import type { StudyInterval } from '@/lib/storage'

export type ProactiveWindow = {
  id: string
  title: string
  detail: string
  subject: string
  taskId: string
  typicalHour: number
}

function hourDistance(from: number, to: number) {
  return Math.min(Math.abs(from - to), 24 - Math.abs(from - to))
}

/**
 * A quiet, evidence-based moment to surface one action. It deliberately does
 * not infer mood or send a notification; the card exists only while the app
 * is open and only after enough recorded focus starts support the pattern.
 */
export function chooseProactiveWindow(input: { now: Date; intervals: StudyInterval[]; nextAction: NextBestAction | null; suppressed?: boolean }): ProactiveWindow | null {
  if (!input.nextAction || input.suppressed) return null
  const cutoff = input.now.getTime() - 28 * 86_400_000
  const hourCounts = new Map<number, number>()
  for (const interval of input.intervals) {
    const started = new Date(interval.startedAt)
    if (interval.mode !== 'focus' || interval.durationSeconds < 10 * 60 || !Number.isFinite(started.getTime()) || started.getTime() < cutoff) continue
    const hour = started.getHours()
    hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1)
  }
  const peak = [...hourCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
  if (!peak || peak[1] < 4 || input.now.getHours() < 6 || input.now.getHours() > 22 || hourDistance(input.now.getHours(), peak[0]) > 1) return null
  const action = input.nextAction
  return {
    id: `focus-window:${peak[0]}:${String(input.now.getFullYear())}-${String(input.now.getMonth() + 1).padStart(2, '0')}-${String(input.now.getDate()).padStart(2, '0')}:${action.task.id}`,
    title: 'Your usual focus window is open.',
    detail: `You often begin a real focus block around this time. “${action.task.title}” is ready when you are.`,
    subject: action.task.subject,
    taskId: action.task.id,
    typicalHour: peak[0],
  }
}
