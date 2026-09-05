import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { sendLinePush } from '@/lib/line'
import { createMorningReminderFlex } from '@/lib/line-flex'
import { loadLineWorkspaceContext } from '@/lib/line-workspaces'
import { adaptiveSubjectBoost, type AdaptiveSignals } from '@/lib/adaptive-planner'
import { deriveKokoPresentation } from '@/lib/personalization'
import { compilePersonalOntologySnapshot } from '@/lib/personal-ontology-context'
import { createDailyBriefing } from '@/lib/daily-briefing'
import { claimReminderDelivery, completeReminderDelivery } from '@/lib/reminder-delivery'

function reminderScore(task: Record<string, unknown>, today: string, signals: AdaptiveSignals) {
  const dueDate = typeof task.due_date === 'string' ? task.due_date : ''
  const overdue = dueDate && dueDate < today ? 120 : 0
  const dueToday = dueDate === today ? 80 : 0
  const priority = Number(task.priority) === 1 ? 24 : Number(task.priority) === 2 ? 10 : 0
  const subject = typeof task.subject === 'string' ? task.subject : 'General'
  return overdue + dueToday + priority + adaptiveSubjectBoost(subject, signals)
}

function bangkokDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

export async function GET(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET
    const authorization = request.headers.get('authorization')

    if (!cronSecret) {
      console.error('CRON_SECRET is not configured')
      return NextResponse.json({ error: 'Cron secret is not configured' }, { status: 500 })
    }

    if (authorization !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getSupabaseAdmin()
    const today = bangkokDateKey()
    const upcomingDate = new Date(`${today}T00:00:00+07:00`)
    upcomingDate.setDate(upcomingDate.getDate() + 7)
    const upcomingThrough = bangkokDateKey(upcomingDate)

    // Important dates are one-off markers. Once their Bangkok calendar day
    // has passed, remove them centrally so they do not linger in the web,
    // personal view, Team Space, or LINE results.
    const { error: cleanupError } = await admin.from('planner_events').delete().lt('event_date', today)
    if (cleanupError) console.warn('Expired important-date cleanup failed:', cleanupError.message)

    // 1. Fetch all connected LINE users
    const { data: connections, error: connError } = await admin
      .from('user_line_connections')
      .select('user_id, line_user_id')
      .not('line_user_id', 'is', null)

    if (connError || !connections || connections.length === 0) {
      return NextResponse.json({ message: 'No connected users found', sentCount: 0 })
    }

    let sentCount = 0
    let skippedCount = 0
    let failedCount = 0
    let legacyDeliveryCount = 0

    for (const conn of connections) {
      if (!conn.line_user_id) continue

      // One compiled Personal Ontology now drives both the AI and the morning
      // manager. Rebuilding here also provides the account's daily backup.
      const workspaceContext = await loadLineWorkspaceContext(admin, conn.user_id)
      const snapshot = await compilePersonalOntologySnapshot(admin, conn.user_id, { workspaceContext, persist: true })
      const adaptiveSignals: AdaptiveSignals = Object.fromEntries(snapshot.objects.behavior.map((signal) => [signal.subject, { accepted: signal.accepted, completed: signal.completed }]))
      const presentation = deriveKokoPresentation(snapshot.objects.memory, adaptiveSignals)
      const briefing = createDailyBriefing(snapshot, today)
      const tasks = snapshot.objects.tasks
        .map((task) => ({
          id: task.id, title: task.title, subject: task.subject, due_date: task.dueDate,
          estimated_minutes: task.estimatedMinutes, priority: task.priority,
          workspace_id: task.workspaceId, workspace_name: task.workspaceName,
        }))
        .filter((task) => typeof task.due_date === 'string' && task.due_date <= today)
        .sort((a, b) => reminderScore(b, today, adaptiveSignals) - reminderScore(a, today, adaptiveSignals))
        .slice(0, 5)
      const importantDates = snapshot.objects.importantDates
        .filter((event) => event.eventDate <= upcomingThrough)
        .slice(0, 3)
        .map((event) => ({
          id: event.id, title: event.title, event_date: event.eventDate, type: event.type,
          workspace_id: event.workspaceId, workspace_name: event.workspaceName,
        }))

      if (tasks.length > 0 || importantDates.length > 0) {
        const delivery = await claimReminderDelivery(admin, conn.user_id, `line-morning:${today}`)
        if (delivery.mode === 'protected' && !delivery.deliveryId) {
          skippedCount++
          continue
        }

        if (delivery.mode === 'legacy') legacyDeliveryCount++
        const success = await sendLinePush(conn.line_user_id, [createMorningReminderFlex(tasks, today, {
          ticker: briefing.ticker || presentation.reminderLine,
          events: importantDates,
          briefing: { title: briefing.title, detail: briefing.detail },
        })])

        if (delivery.deliveryId) await completeReminderDelivery(admin, delivery.deliveryId, success)

        if (success) sentCount++
        else failedCount++
      }
    }

    return NextResponse.json({
      success: true,
      sentCount,
      skippedCount,
      failedCount,
      deliveryProtection: legacyDeliveryCount ? 'migration_required' : 'enabled',
    })
  } catch (error: any) {
    console.error('Reminder cron error:', error)
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 })
  }
}
