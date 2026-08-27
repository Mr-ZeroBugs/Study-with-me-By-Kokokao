import { NextResponse } from 'next/server'
import { verifyLineSignature, sendLineReply, parseTaskInput, parseEventInput } from '@/lib/line'
import { createEventsFlex, createStatusFlex, createTasksFlex } from '@/lib/line-flex'
import { analyzeUserMessageWithGemini } from '@/lib/gemini'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import crypto from 'crypto'

export async function POST(request: Request) {
  try {
    const rawBody = await request.text()
    const signature = request.headers.get('x-line-signature')

    // Verify that request is from LINE
    if (!verifyLineSignature(rawBody, signature)) {
      console.warn('Invalid LINE signature')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const payload = JSON.parse(rawBody)
    const events = payload.events || []

    const admin = getSupabaseAdmin()

    for (const event of events) {
      const lineUserId = event.source?.userId
      const replyToken = event.replyToken

      if (!lineUserId || !replyToken) continue

      // Handle Follow event (When user adds bot as friend)
      if (event.type === 'follow') {
        await sendLineReply(replyToken, [
          {
            type: 'text',
            text: `👋 ยินดีต้อนรับสู่ Study Manager.koko!\n\nในการเริ่มใช้งานและรับแจ้งเตือน To-Do:\n1. เข้าสู่ระบบบนเว็บ StudyTimer ของคุณ\n2. ไปที่หน้า Tasks / Planner แล้วกด "📱 เชื่อมต่อ LINE"\n3. นำรหัสที่ได้ (เช่น LINK-1234) มาพิมพ์ส่งให้บอทที่นี่ได้เลยครับ ✨`,
          },
        ])
        continue
      }

      // Handle Text Messages
      if (event.type === 'message' && event.message?.type === 'text') {
        const text = (event.message.text || '').trim()
        const today = new Date().toISOString().split('T')[0]

        // 1. Check for Link Code e.g. "LINK-1234" or "/link LINK-1234"
        const linkMatch = text.match(/\b(LINK-\d{4})\b/i)
        if (linkMatch) {
          const code = linkMatch[1].toUpperCase()
          const { data: connection } = await admin
            .from('user_line_connections')
            .select('*')
            .eq('link_code', code)
            .gt('link_code_expires_at', new Date().toISOString())
            .maybeSingle()

          if (!connection) {
            await sendLineReply(replyToken, [
              {
                type: 'text',
                text: '❌ ไม่พบรหัสเชื่อมต่อนี้ หรือรหัสหมดอายุแล้ว (รหัสมีอายุ 15 นาที)\nกรุณากดขอรหัสใหม่บนหน้าเว็บ StudyTimer ครับ',
              },
            ])
            continue
          }

          // Link this LINE User ID
          await admin
            .from('user_line_connections')
            .update({
              line_user_id: lineUserId,
              link_code: null,
              link_code_expires_at: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', connection.id)

          await sendLineReply(replyToken, [
            {
              type: 'text',
              text: `🎉 เชื่อมต่อบัญชีกับ StudyTimer สำเร็จแล้ว!\n🤖 Study Manager.koko พร้อมรับคำสั่งภาษาพูดแล้ว พิมพ์สั่งงานได้สบายๆ เลยครับ เช่น:\n"พรุ่งนี้เตือนอ่านหนังสือชีวะตอน 2 ทุ่มด้วยนะ"`,
              quickReply: {
                items: [
                  {
                    type: 'action',
                    action: { type: 'message', label: '📋 ดูรายการงาน', text: '/list' },
                  },
                  {
                    type: 'action',
                    action: { type: 'message', label: '📅 ดูวันสำคัญ', text: '/events' },
                  },
                  {
                    type: 'action',
                    action: { type: 'message', label: '❓ ช่วยเหลือ', text: '/help' },
                  },
                ],
              },
            },
          ])
          continue
        }

        // 2. Check if this LINE user is linked to an account
        const { data: userConn } = await admin
          .from('user_line_connections')
          .select('user_id')
          .eq('line_user_id', lineUserId)
          .maybeSingle()

        if (!userConn) {
          await sendLineReply(replyToken, [
            {
              type: 'text',
              text: `⚠️ บัญชี LINE นี้ยังไม่ได้เชื่อมต่อกับระบบ\n\nวิธีเชื่อมต่อ:\n1. เข้าเว็บ StudyTimer แล้วกดปุ่ม "📱 เชื่อมต่อ LINE"\n2. นำรหัสที่ได้ (เช่น LINK-1234) มาพิมพ์ที่นี่ครับ`,
            },
          ])
          continue
        }

        const userId = userConn.user_id

        // 3. Fast Command: /help
        if (text === '/help' || text === 'เมนู' || text === 'ช่วยเหลือ' || text === '/menu') {
          await sendLineReply(replyToken, [
            {
              type: 'text',
              text: `📖 คำสั่งที่รองรับใน Study Manager.koko:\n\n` +
                `✨ พิมพ์คุยภาษาพูดได้เลย เช่น:\n` +
                `• "พรุ่งนี้มีสอบฟิสิกส์ตอนบ่าย"\n` +
                `• "ช่วยเตือนทำการบ้านเลขหน่อย ด่วนมาก"\n` +
                `• "อ่านชีวะเสร็จแล้วจ้า"\n` +
                `• "มีงานอะไรต้องทำบ้าง"\n\n` +
                `📌 หรือใช้คำสั่งลัด:\n` +
                `• /todo <ชื่องาน> [วิชา] วันนี้/พรุ่งนี้ !1/!2/!3\n` +
                `• /event <วันสำคัญ> [exam/project/competition/important]\n` +
                `• /list (ดู To-Do)\n` +
                `• /events (ดูวันสำคัญ)\n` +
                `• /done <ชื่องาน>\n` +
                `• /status (เช็คสถานะ)`,
              quickReply: {
                items: [
                  {
                    type: 'action',
                    action: { type: 'message', label: '📋 ดูงานวันนี้', text: '/list' },
                  },
                  {
                    type: 'action',
                    action: { type: 'message', label: '📅 ดูวันสำคัญ', text: '/events' },
                  },
                  {
                    type: 'action',
                    action: { type: 'message', label: '✍️ เพิ่ม To-Do', text: '/todo ' },
                  },
                ],
              },
            },
          ])
          continue
        }

        // 4. Fast Command: /status
        if (text === '/status') {
          const { count } = await admin
            .from('planner_tasks')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('completed', false)

          await sendLineReply(replyToken, [createStatusFlex(count)])
          continue
        }

        // 5. Try Gemini AI Understanding First!
        const aiResult = await analyzeUserMessageWithGemini(text, today)

        if (aiResult) {
          // --- AI ACTION: ADD_TODO ---
          if (aiResult.action === 'ADD_TODO') {
            const taskId = crypto.randomUUID()
            const { error: insertError } = await admin.from('planner_tasks').insert({
              id: taskId,
              user_id: userId,
              title: aiResult.title,
              subject: aiResult.subject || 'General',
              due_date: aiResult.dueDate || today,
              estimated_minutes: aiResult.estimatedMinutes || 25,
              priority: aiResult.priority || 2,
              completed: false,
              created_at: new Date().toISOString(),
            })

            if (!insertError) {
              const priorityLabel = aiResult.priority === 3 ? '🔴 สูงมาก (ด่วน)' : aiResult.priority === 2 ? '🟡 ปานกลาง' : '🟢 ทั่วไป'
              let replyMessage =
                `✨ บันทึก To-Do สำเร็จแล้ว! 🤖\n\n` +
                `📌 งาน: ${aiResult.title}\n` +
                `📚 วิชา: ${aiResult.subject || 'General'}\n` +
                `📅 กำหนด: ${aiResult.dueDate || today}\n` +
                `⚡ ความสำคัญ: ${priorityLabel}`

              if (aiResult.aiComment) {
                replyMessage += `\n\n💬 ${aiResult.aiComment}`
              }

              await sendLineReply(replyToken, [
                {
                  type: 'text',
                  text: replyMessage,
                  quickReply: {
                    items: [
                      {
                        type: 'action',
                        action: { type: 'message', label: '📋 ดูงานทั้งหมด', text: '/list' },
                      },
                      {
                        type: 'action',
                        action: { type: 'message', label: '📅 ดูวันสำคัญ', text: '/events' },
                      },
                    ],
                  },
                },
              ])
              continue
            }
          }

          // --- AI ACTION: ADD_EVENT ---
          if (aiResult.action === 'ADD_EVENT') {
            const eventId = crypto.randomUUID()
            const { error: insertEventError } = await admin.from('planner_events').insert({
              id: eventId,
              user_id: userId,
              title: aiResult.title,
              event_date: aiResult.eventDate || today,
              type: aiResult.type || 'important',
              notes: aiResult.notes || '',
              created_at: new Date().toISOString(),
            })

            if (!insertEventError) {
              const typeNames: Record<string, string> = {
                exam: '📝 การสอบ (Exam)',
                competition: '🏆 การแข่งขัน (Competition)',
                project: '📂 โปรเจกต์ / ส่งงาน (Project)',
                important: '📌 วันสำคัญทั่วไป (Important)',
              }

              let replyMessage =
                `🎉 บันทึกวันสำคัญลง Planner สำเร็จแล้ว! 🤖\n\n` +
                `🏷️ ชื่อ: ${aiResult.title}\n` +
                `📅 วันที่: ${aiResult.eventDate || today}\n` +
                `🔖 หมวด: ${typeNames[aiResult.type] || aiResult.type}`

              if (aiResult.aiComment) {
                replyMessage += `\n\n💬 ${aiResult.aiComment}`
              }

              await sendLineReply(replyToken, [
                {
                  type: 'text',
                  text: replyMessage,
                  quickReply: {
                    items: [
                      {
                        type: 'action',
                        action: { type: 'message', label: '📅 ดูวันสำคัญทั้งหมด', text: '/events' },
                      },
                      {
                        type: 'action',
                        action: { type: 'message', label: '📋 ดู To-Do', text: '/list' },
                      },
                    ],
                  },
                },
              ])
              continue
            }
          }

          // --- AI ACTION: COMPLETE_TASK ---
          if (aiResult.action === 'COMPLETE_TASK') {
            const query = aiResult.taskQuery || text
            const { data: matchedTasks } = await admin
              .from('planner_tasks')
              .select('*')
              .eq('user_id', userId)
              .eq('completed', false)
              .ilike('title', `%${query}%`)
              .limit(1)

            if (matchedTasks && matchedTasks.length > 0) {
              const taskToComplete = matchedTasks[0]
              await admin
                .from('planner_tasks')
                .update({ completed: true })
                .eq('id', taskToComplete.id)

              await sendLineReply(replyToken, [
                {
                  type: 'text',
                  text: `✅ ทำรายการสำเร็จแล้ว:\n"${taskToComplete.title}"\n\nเก่งมากครับ! 🔥 ${aiResult.aiComment || ''}`,
                  quickReply: {
                    items: [
                      {
                        type: 'action',
                        action: { type: 'message', label: '📋 ดูกิจกรรมที่เหลือ', text: '/list' },
                      },
                    ],
                  },
                },
              ])
              continue
            }
          }

          // --- AI ACTION: CHAT ---
          if (aiResult.action === 'CHAT') {
            await sendLineReply(replyToken, [
              {
                type: 'text',
                text: aiResult.replyText,
                quickReply: {
                  items: [
                    {
                      type: 'action',
                      action: { type: 'message', label: '📋 ดูงานของฉัน', text: '/list' },
                    },
                    {
                      type: 'action',
                      action: { type: 'message', label: '📅 ดูวันสำคัญ', text: '/events' },
                    },
                    {
                      type: 'action',
                      action: { type: 'message', label: '❓ วิธีใช้งาน', text: '/help' },
                    },
                  ],
                },
              },
            ])
            continue
          }
        }

        // 6. Fallback Command: /list or /today
        if (text === '/list' || text === '/today' || text === 'ดูงาน' || text === 'งานวันนี้' || aiResult?.action === 'LIST_TODOS') {
          const { data: tasks, error: taskError } = await admin
            .from('planner_tasks')
            .select('*')
            .eq('user_id', userId)
            .eq('completed', false)
            .order('priority', { ascending: false })
            .order('due_date', { ascending: true })
            .limit(10)

          await sendLineReply(replyToken, [createTasksFlex(taskError ? [] : (tasks ?? []))])
          continue
        }

        // 7. Fallback Command: /events or /dates
        if (text === '/events' || text === '/dates' || text === 'ดูวันสำคัญ' || text === 'วันสำคัญ' || aiResult?.action === 'LIST_EVENTS') {
          const { data: eventsList, error: eventError } = await admin
            .from('planner_events')
            .select('*')
            .eq('user_id', userId)
            .gte('event_date', today)
            .order('event_date', { ascending: true })
            .limit(10)

          await sendLineReply(replyToken, [createEventsFlex(eventError ? [] : (eventsList ?? []))])
          continue
        }

        // 8. Final Fallback: Direct regex parser
        const parsed = parseTaskInput(text)
        const taskId = crypto.randomUUID()

        await admin.from('planner_tasks').insert({
          id: taskId,
          user_id: userId,
          title: parsed.title,
          subject: parsed.subject,
          due_date: parsed.dueDate || null,
          estimated_minutes: parsed.estimatedMinutes,
          priority: parsed.priority,
          completed: false,
          created_at: new Date().toISOString(),
        })

        const priorityLabel = parsed.priority === 3 ? '🔴 สูงมาก (ด่วน)' : parsed.priority === 2 ? '🟡 ปานกลาง' : '🟢 ทั่วไป'
        await sendLineReply(replyToken, [
          {
            type: 'text',
            text: `✨ บันทึก To-Do สำเร็จแล้ว!\n\n📌 งาน: ${parsed.title}\n📚 วิชา: ${parsed.subject}\n📅 กำหนด: ${parsed.dueDate || 'ไม่ระบุ'}\n⚡ ความสำคัญ: ${priorityLabel}`,
            quickReply: {
              items: [
                {
                  type: 'action',
                  action: { type: 'message', label: '📋 ดูรายการทั้งหมด', text: '/list' },
                },
              ],
            },
          },
        ])
      }
    }

    return NextResponse.json({ status: 'ok' })
  } catch (err: any) {
    console.error('Webhook error:', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}
