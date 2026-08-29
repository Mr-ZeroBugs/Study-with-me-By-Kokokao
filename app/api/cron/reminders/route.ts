import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { sendLinePush } from '@/lib/line'
import { createMorningReminderFlex } from '@/lib/line-flex'
import { decorateLineWorkspaceRow, loadLineWorkspaceContext } from '@/lib/line-workspaces'

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
    const today = new Date().toISOString().split('T')[0]

    // 1. Fetch all connected LINE users
    const { data: connections, error: connError } = await admin
      .from('user_line_connections')
      .select('user_id, line_user_id')
      .not('line_user_id', 'is', null)

    if (connError || !connections || connections.length === 0) {
      return NextResponse.json({ message: 'No connected users found', sentCount: 0 })
    }

    let sentCount = 0

    for (const conn of connections) {
      if (!conn.line_user_id) continue

      // 2. Fetch pending tasks due today or urgent for this user, including
      // every shared space they belong to.
      const workspaceContext = await loadLineWorkspaceContext(admin, conn.user_id)
      let taskQuery = admin
        .from('planner_tasks')
        .select('*')
        .eq('completed', false)
        .order('priority', { ascending: false })
        .order('due_date', { ascending: true })
        .limit(50)
      taskQuery = workspaceContext.ids.length
        ? taskQuery.or(`user_id.eq.${conn.user_id},workspace_id.in.(${workspaceContext.ids.join(',')})`)
        : taskQuery.eq('user_id', conn.user_id)
      const { data: pendingTasks } = await taskQuery
      const tasks = (pendingTasks ?? [])
        .filter((task) => task.due_date === today || Number(task.priority) === 3)
        .slice(0, 5)
        .map((task) => decorateLineWorkspaceRow(task, workspaceContext))

      if (tasks && tasks.length > 0) {
        const success = await sendLinePush(conn.line_user_id, [createMorningReminderFlex(tasks, today)])

        if (success) sentCount++
      }
    }

    return NextResponse.json({ success: true, sentCount })
  } catch (error: any) {
    console.error('Reminder cron error:', error)
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 })
  }
}
