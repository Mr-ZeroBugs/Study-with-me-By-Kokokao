import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { sendLinePush } from '@/lib/line'

export async function GET(request: Request) {
  try {
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

      // 2. Fetch pending tasks due today or urgent for this user
      const { data: tasks } = await admin
        .from('planner_tasks')
        .select('*')
        .eq('user_id', conn.user_id)
        .eq('completed', false)
        .or(`due_date.eq.${today},priority.eq.3`)
        .order('priority', { ascending: false })
        .limit(5)

      if (tasks && tasks.length > 0) {
        let text = `☀️ สวัสดีครับ! แจ้งเตือนงานที่ต้องทำวันนี้ (📅 ${today}):\n`
        tasks.forEach((t, idx) => {
          const priorityBadge = t.priority === 3 ? '🔴' : t.priority === 2 ? '🟡' : '🟢'
          const subjectTag = t.subject && t.subject !== 'General' ? ` [${t.subject}]` : ''
          text += `\n${idx + 1}. ${priorityBadge} ${t.title}${subjectTag}`
        })
        text += `\n\n💪 สู้ๆ กับการเรียนและการทำงานวันนี้นะครับ!\nพิมพ์ /list เพื่อดูทั้งหมด`

        const success = await sendLinePush(conn.line_user_id, [
          {
            type: 'text',
            text,
            quickReply: {
              items: [
                {
                  type: 'action',
                  action: { type: 'message', label: '📋 ดูรายการงาน', text: '/list' },
                },
                {
                  type: 'action',
                  action: { type: 'message', label: '➕ เพิ่ม To-Do', text: '/todo ' },
                },
              ],
            },
          },
        ])

        if (success) sentCount++
      }
    }

    return NextResponse.json({ success: true, sentCount })
  } catch (error: any) {
    console.error('Reminder cron error:', error)
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 })
  }
}
