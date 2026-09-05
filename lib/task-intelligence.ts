export type DeadlineConfidence = 'explicit' | 'inferred' | 'none'

type TaskLike = {
  title: string
  subject: string
  dueDate?: string
  completed?: boolean
}

const subjectAliases: Record<string, string> = {
  maths: 'Math',
  mathematics: 'Math',
  math: 'Math',
  english: 'English',
  biology: 'Biology',
  physics: 'Physics',
  chemistry: 'Chemistry',
}

export function normalizeTaskTitle(value: string) {
  const normalized = value
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^[\s•·\-–—]+|[\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.:!?])/g, '$1')
    .trim()
  return normalized.slice(0, 180) || 'Untitled task'
}

export function normalizeSubjectName(value: string) {
  const normalized = value
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  if (!normalized) return 'General'
  return subjectAliases[normalized.toLocaleLowerCase()] ?? normalized
}

export function subjectKey(value: string) {
  return normalizeSubjectName(value)
    .toLocaleLowerCase()
    .replace(/[\s_\-/]+/g, '')
}

export function taskTitleKey(value: string) {
  return normalizeTaskTitle(value)
    .toLocaleLowerCase()
    .replace(/[\s_\-/]+/g, '')
}

export function taskFingerprint(task: TaskLike) {
  return `${taskTitleKey(task.title)}|${subjectKey(task.subject)}|${task.dueDate || ''}`
}

// Exact duplicates are a high-confidence case. Similar wording deliberately
// remains separate: two tasks that sound alike may still be distinct work.
export function findExactOpenDuplicate<T extends TaskLike>(tasks: T[], candidate: TaskLike) {
  const fingerprint = taskFingerprint(candidate)
  return tasks.find((task) => !task.completed && taskFingerprint(task) === fingerprint) ?? null
}

export function prepareTaskInput(input: { title: string; subject: string; dueDate?: string; deadlineConfidence?: DeadlineConfidence }) {
  const title = normalizeTaskTitle(input.title)
  const subject = normalizeSubjectName(input.subject)
  const dueDate = input.dueDate || ''
  return {
    title,
    subject,
    normalizedTitle: taskTitleKey(title),
    subjectKey: subjectKey(subject),
    deadlineConfidence: input.deadlineConfidence ?? (dueDate ? 'inferred' : 'none') as DeadlineConfidence,
  }
}
