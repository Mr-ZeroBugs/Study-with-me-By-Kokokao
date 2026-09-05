import type { PersonalOntologySnapshot } from '@/lib/personal-ontology-context'

export type DailyBriefing = {
  title: string
  detail: string
  ticker: string
}

function daysFromToday(today: string, date: string | null) {
  if (!date) return null
  return Math.round((new Date(`${date}T00:00:00+07:00`).getTime() - new Date(`${today}T00:00:00+07:00`).getTime()) / 86_400_000)
}

/**
 * One shared morning read for every surface. The snapshot is already scoped to
 * one account, and this function only turns verified planner facts into a
 * compact suggestion—it never mutates the plan or claims to know the user's
 * emotional state.
 */
export function createDailyBriefing(snapshot: PersonalOntologySnapshot, today: string): DailyBriefing {
  const tasks = snapshot.objects.tasks
  const overdue = tasks.find((task) => (daysFromToday(today, task.dueDate) ?? 99) < 0)
  if (overdue) return {
    title: `Start by resetting “${overdue.title}”.`,
    detail: `${overdue.subject} has an old deadline. Make it a real next decision before adding more pressure.`,
    ticker: 'เริ่มจากงานค้างหนึ่งงาน แล้วเลือกว่าจะทำ เลื่อน หรือแบ่งมันออก',
  }

  const dueToday = tasks.find((task) => daysFromToday(today, task.dueDate) === 0)
  if (dueToday) return {
    title: `First move: “${dueToday.title}”.`,
    detail: `${dueToday.subject} is due today. ${dueToday.estimatedMinutes <= 30 ? 'It is small enough for one focused start.' : 'Break the first piece open before the day gets busy.'}`,
    ticker: 'วันนี้มี deadline — เริ่มก่อนสั้น ๆ แล้วค่อยดูงานที่เหลือ',
  }

  const eventToday = snapshot.objects.importantDates.find((event) => event.eventDate === today)
  if (eventToday) return {
    title: `Today: ${eventToday.title}.`,
    detail: 'Keep the important date in sight, then leave yourself room around it.',
    ticker: 'วันนี้มีวันสำคัญ — เว้นที่ว่างไว้ให้สิ่งนี้ด้วยนะ',
  }

  const nextTask = tasks[0]
  if (nextTask) return {
    title: `A calm start: “${nextTask.title}”.`,
    detail: `${nextTask.subject} · about ${nextTask.estimatedMinutes} min${nextTask.workspaceName ? ` · from ${nextTask.workspaceName}` : ''}`,
    ticker: 'ไม่ต้องทำทุกอย่างพร้อมกัน เลือกหนึ่ง next move ก่อนก็พอ',
  }

  return {
    title: 'A clear page for today.',
    detail: 'There is nothing urgent in your planner right now. Add one small next step only when you need it.',
    ticker: 'วันโล่งก็เป็นส่วนหนึ่งของแผนที่ดี',
  }
}
