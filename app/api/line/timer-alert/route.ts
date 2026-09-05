import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { sendLinePush } from '@/lib/line'

export async function POST(request: Request) {
  try {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = getSupabaseAdmin()
    const { data: { user }, error } = await admin.auth.getUser(token)
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const payload = await request.json() as { kind?: string; subject?: string; minutes?: number }
    if (payload.kind !== 'long_focus' && payload.kind !== 'auto_stopped') {
      return NextResponse.json({ error: 'Invalid alert type' }, { status: 400 })
    }
    const subject = String(payload.subject || 'General').replace(/\s+/g, ' ').trim().slice(0, 40) || 'General'
    const minutes = Math.min(240, Math.max(0, Math.round(Number(payload.minutes) || 0)))
    const { data: connection } = await admin
      .from('user_line_connections')
      .select('line_user_id')
      .eq('user_id', user.id)
      .maybeSingle()
    if (!connection?.line_user_id) return NextResponse.json({ success: true, delivered: false })

    const text = payload.kind === 'long_focus'
      ? `⏳ Koko ขอเตือนนิดนึง\nคุณโฟกัส ${subject} ต่อเนื่องมา ${minutes} นาทีแล้ว พักสายตาและขยับตัวสักหน่อยนะ`
      : `⏸️ Koko หยุดเวลาให้อัตโนมัติ\nวิชา: ${subject}\nบันทึกไว้ประมาณ ${minutes} นาที เพราะไม่ได้รับการยืนยันหลังครบ 3 ชั่วโมง คุณสามารถกลับไปปรับเวลาจริงในหน้า Focus ได้`
    const delivered = await sendLinePush(connection.line_user_id, [{ type: 'text', text }])
    return NextResponse.json({ success: true, delivered })
  } catch (error) {
    console.error('Timer LINE alert failed:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
