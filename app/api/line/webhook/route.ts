import { NextResponse } from 'next/server'
import { verifyLineSignature, sendLineReply, parseTaskInput, parseEventInput } from '@/lib/line'
import { createEventsFlex, createStatusFlex, createTaskDoneFlex, createTasksFlex } from '@/lib/line-flex'
import { analyzeUserMessageWithGemini } from '@/lib/gemini'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { decorateLineWorkspaceRow, loadLineWorkspaceContext } from '@/lib/line-workspaces'
import type { LineWorkspaceContext } from '@/lib/line-workspaces'
import crypto from 'crypto'

type NaturalTeamTaskRequest = {
  targetIndex: number | null
  taskInput: string
}

const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://koko-study.vercel.app'
const appUrl = /^https?:\/\//i.test(configuredAppUrl) ? configuredAppUrl.replace(/\/$/, '') : 'https://koko-study.vercel.app'

function isWebsiteLinkRequest(text: string) {
  return /^\/(?:web|website|site|link)$/i.test(text)
    || /(?:ขอ|ส่ง|เปิด|เข้า).*(?:เว็บ|เว็บไซต์|website|site)/i.test(text)
    || /(?:เว็บ|เว็บไซต์|website|site).*(?:ลิงก์|ลิ้ง|link)/i.test(text)
}

function parseNaturalTeamTaskRequest(text: string, context: LineWorkspaceContext): NaturalTeamTaskRequest | null {
  const prefix = text.match(/^(?:เพิ่มงานทีม|สร้างงานทีม|add\s+(?:a\s+)?team\s+task)\s*(?:(?:ใน|เข้า|in|into)\s*)?/i)
  if (!prefix) return null

  let remainder = text.slice(prefix[0].length).trim()
  const candidates = context.ids
    .map((id, index) => ({ id, index, name: context.names[id] || '' }))
    .filter((candidate) => candidate.name)
    .sort((a, b) => b.name.length - a.name.length)
  const normalizedRemainder = remainder.toLocaleLowerCase()
  const matchedWorkspace = candidates.find((candidate) => {
    const normalizedName = candidate.name.toLocaleLowerCase()
    return normalizedRemainder === normalizedName || normalizedRemainder.startsWith(normalizedName + ' ') || normalizedRemainder.startsWith(normalizedName + ':') || normalizedRemainder.startsWith(normalizedName + '：')
  })

  if (matchedWorkspace) {
    remainder = remainder.slice(matchedWorkspace.name.length).replace(/^\s*(?:ให้|[:：,\-–—])\s*/i, '').trim()
    return { targetIndex: matchedWorkspace.index, taskInput: remainder }
  }

  // With one space, the user does not need to repeat its name. With several,
  // the caller will show a numbered picker instead of guessing.
  return { targetIndex: context.ids.length === 1 ? 0 : null, taskInput: remainder }
}

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
            text: `👋 ยินดีต้อนรับสู่ Study Manager.koko!\n\nในการเริ่มใช้งานและรับแจ้งเตือน To-Do:\n1. เข้าสู่ระบบบนเว็บ StudyTimer ของคุณ\n2. ไปที่หน้า Tasks / Planner แล้วกด "📱 เชื่อมต่อ LINE"\n3. นำรหัสที่ได้ (เช่น LINK-1234567890) มาพิมพ์ส่งให้บอทที่นี่ได้เลยครับ ✨`,
          },
        ])
        continue
      }

      // Handle one-tap actions coming back from a Flex card.
      if (event.type === 'postback' && event.postback?.data) {
        const { data: userConn } = await admin
          .from('user_line_connections')
          .select('user_id')
          .eq('line_user_id', lineUserId)
          .maybeSingle()

        if (!userConn) {
          await sendLineReply(replyToken, [{ type: 'text', text: '⚠️ บัญชี LINE นี้ยังไม่ได้เชื่อมต่อกับระบบครับ' }])
          continue
        }

        const params = new URLSearchParams(event.postback.data)
        if (params.get('action') === 'complete_task') {
          const taskId = params.get('taskId')
          if (!taskId) {
            await sendLineReply(replyToken, [{ type: 'text', text: 'ยังระบุงานที่ต้องทำไม่สำเร็จครับ ลองเปิด /list ใหม่อีกครั้งนะ' }])
            continue
          }

          const { data: taskToComplete } = await admin
            .from('planner_tasks')
            .select('title, workspace_id')
            .eq('id', taskId)
            .eq('user_id', userConn.user_id)
            .maybeSingle()

          if (taskToComplete?.workspace_id) {
            await sendLineReply(replyToken, [{ type: 'text', text: 'งานนี้มาจาก Team Space จึงกด done จาก LINE ไม่ได้ครับ — เปิดเว็บเพื่ออัปเดตสถานะใน workspace นะ' }])
            continue
          }

          const { data: completedTask, error: completeError } = await admin
            .from('planner_tasks')
            .update({ completed: true })
            .eq('id', taskId)
            .eq('user_id', userConn.user_id)
            .eq('completed', false)
            .select('title')
            .maybeSingle()

          if (completedTask && !completeError) {
            await sendLineReply(replyToken, [createTaskDoneFlex(completedTask.title)])
          } else {
            await sendLineReply(replyToken, [{ type: 'text', text: 'งานนี้อาจถูกทำเสร็จไปแล้ว หรือหาไม่พบครับ ลองกด /list เพื่อรีเฟรชรายการนะ' }])
          }
        }
        continue
      }

      // Handle Text Messages
      if (event.type === 'message' && event.message?.type === 'text') {
        const text = (event.message.text || '').trim()
        const today = new Date().toISOString().split('T')[0]

        // 1. New codes use ten digits. Keep accepting an old four-digit code
        // until it expires so users already mid-link are not interrupted.
        const linkMatch = text.match(/\b(LINK-(?:\d{10}|\d{4}))\b/i)
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

        // Website shortcut works even before a LINE account is linked.
        if (isWebsiteLinkRequest(text)) {
          await sendLineReply(replyToken, [{
            type: 'text',
            text: `นี่คือลิงก์เว็บไซต์ Study Manager.koko ครับ ✨\n${appUrl}`,
            quickReply: {
              items: [
                { type: 'action', action: { type: 'uri', label: 'เปิดเว็บไซต์', uri: appUrl } },
                { type: 'action', action: { type: 'message', label: 'วิธีใช้งาน', text: '/help' } },
              ],
            },
          }])
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
              text: `⚠️ บัญชี LINE นี้ยังไม่ได้เชื่อมต่อกับระบบ\n\nวิธีเชื่อมต่อ:\n1. เข้าเว็บ StudyTimer แล้วกดปุ่ม "📱 เชื่อมต่อ LINE"\n2. นำรหัสที่ได้ (เช่น LINK-1234567890) มาพิมพ์ที่นี่ครับ`,
            },
          ])
          continue
        }

        const userId = userConn.user_id
        const workspaceContext = await loadLineWorkspaceContext(admin, userId)

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
                `• /team <หมายเลข> <ชื่องาน> เพิ่มงานเข้า Team Space\n` +
                `• เพิ่มงานทีมใน<ชื่อ Team Space> <ชื่องาน>\n` +
                `• /web (ขอลิงก์เว็บไซต์)\n` +
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

        // Add a task directly to a shared Team Space. A number keeps the
        // command unambiguous when a user belongs to more than one space;
        // natural Thai/English phrasing can resolve a workspace by its name.
        const teamCommand = text.match(/^\/team(?:\s+(\d+))?\s*(.*)$/i)
        const naturalTeamRequest = teamCommand ? null : parseNaturalTeamTaskRequest(text, workspaceContext)
        if (teamCommand || naturalTeamRequest) {
          if (!workspaceContext.ids.length) {
            await sendLineReply(replyToken, [{ type: 'text', text: 'ตอนนี้คุณยังไม่มี Team Space ครับ สร้างหรือเข้าร่วม workspace จากหน้า Planner ก่อน แล้วค่อยลอง /team ใหม่ได้เลย' }])
            continue
          }

          const requestedIndex = teamCommand
            ? (teamCommand[1] ? Number(teamCommand[1]) - 1 : null)
            : (naturalTeamRequest?.targetIndex ?? null)
          const taskInput = teamCommand ? teamCommand[2].trim() : (naturalTeamRequest?.taskInput ?? '')
          if (requestedIndex === null && workspaceContext.ids.length > 1) {
            const spaces = workspaceContext.ids.map((id, index) => `${index + 1}. ${workspaceContext.names[id] || 'Team Space'}`).join('\n')
            const quickReplyItems = workspaceContext.ids.slice(0, 13).map((id, index) => ({
              type: 'action' as const,
              action: { type: 'message' as const, label: String(index + 1) + '. ' + (workspaceContext.names[id] || 'Team Space').slice(0, 16), text: `/team ${index + 1} ` },
            }))
            await sendLineReply(replyToken, [{
              type: 'text',
              text: `เลือก Team Space ที่จะใส่งานก่อนครับ:\n${spaces}\n\nตัวอย่าง: /team 1 ทำสไลด์ส่งพรุ่งนี้ !3`,
              quickReply: { items: quickReplyItems },
            }])
            continue
          }

          const targetIndex = requestedIndex ?? 0
          if (targetIndex < 0 || targetIndex >= workspaceContext.ids.length) {
            await sendLineReply(replyToken, [{ type: 'text', text: `ไม่พบ Team Space หมายเลข ${targetIndex + 1} ครับ ลองพิมพ์ /team เพื่อดูรายการอีกครั้ง` }])
            continue
          }
          if (!taskInput) {
            await sendLineReply(replyToken, [{ type: 'text', text: `พิมพ์รายละเอียดงานต่อท้ายได้เลยครับ เช่น /team ${targetIndex + 1} อ่านบทที่ 3 พรุ่งนี้ [Math] !2` }])
            continue
          }

          const parsed = parseTaskInput(taskInput)
          const teamTaskId = crypto.randomUUID()
          const targetWorkspaceId = workspaceContext.ids[targetIndex]
          const targetWorkspaceName = workspaceContext.names[targetWorkspaceId] || 'Team Space'
          const { error: teamInsertError } = await admin.from('planner_tasks').insert({
            id: teamTaskId,
            user_id: userId,
            workspace_id: targetWorkspaceId,
            title: parsed.title,
            subject: parsed.subject,
            due_date: parsed.dueDate || null,
            estimated_minutes: parsed.estimatedMinutes,
            priority: parsed.priority,
            completed: false,
            created_at: new Date().toISOString(),
          })

          if (teamInsertError) {
            console.error('Failed to create LINE team task:', teamInsertError)
            await sendLineReply(replyToken, [{ type: 'text', text: 'เพิ่มงานเข้า Team Space ไม่สำเร็จครับ ลองใหม่อีกครั้งนะ' }])
            continue
          }

          await sendLineReply(replyToken, [{
            type: 'text',
            text: `✅ เพิ่มงานเข้า Team Space แล้ว\n\n🏠 ${targetWorkspaceName}\n📌 งาน: ${parsed.title}\n📅 กำหนด: ${parsed.dueDate || 'ไม่ระบุ'}\n⚡ Priority: ${parsed.priority}`,
            quickReply: {
              items: [
                { type: 'action', action: { type: 'message', label: '📋 ดูงานทีม', text: '/list' } },
                { type: 'action', action: { type: 'message', label: '➕ เพิ่มอีกงาน', text: `/team ${targetIndex + 1} ` } },
              ],
            },
          }])
          continue
        }

        // 4. Fast Command: /status
        if (text === '/status') {
          let statusQuery = admin
            .from('planner_tasks')
            .select('*', { count: 'exact', head: true })
            .eq('completed', false)
          statusQuery = workspaceContext.ids.length
            ? statusQuery.or(`user_id.eq.${userId},workspace_id.in.(${workspaceContext.ids.join(',')})`)
            : statusQuery.eq('user_id', userId)
          const { count } = await statusQuery

          await sendLineReply(replyToken, [createStatusFlex(count)])
          continue
        }

        // 5b. Deterministic completion command for Flex buttons and power users.
        const doneCommand = text.match(/^\/done\s+(.+)$/i)
        if (doneCommand) {
          const taskQuery = doneCommand[1].trim()
          let doneQuery = admin
            .from('planner_tasks')
            .select('id, title, workspace_id')
            .eq('completed', false)
            .ilike('title', '%' + taskQuery + '%')
          doneQuery = workspaceContext.ids.length
            ? doneQuery.or(`user_id.eq.${userId},workspace_id.in.(${workspaceContext.ids.join(',')})`)
            : doneQuery.eq('user_id', userId)
          const { data: matchedTasks } = await doneQuery.limit(1)
          const matchedTask = matchedTasks?.[0]

          if (matchedTask) {
            if (matchedTask.workspace_id) {
              await sendLineReply(replyToken, [{ type: 'text', text: `งาน "${matchedTask.title}" มาจาก Team Space จึงกด done จาก LINE ไม่ได้ครับ — เปิดเว็บเพื่ออัปเดตสถานะใน workspace นะ` }])
              continue
            }
            await admin
              .from('planner_tasks')
              .update({ completed: true })
              .eq('id', matchedTask.id)
              .eq('user_id', userId)
            await sendLineReply(replyToken, [createTaskDoneFlex(matchedTask.title)])
          } else {
            await sendLineReply(replyToken, [{ type: 'text', text: 'ยังหา task ที่ชื่อใกล้กับ "' + taskQuery + '" ไม่เจอครับ ลองกด /list เพื่อดูรายการอีกครั้งนะ' }])
          }
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
            let completeQuery = admin
              .from('planner_tasks')
              .select('*')
              .eq('completed', false)
              .ilike('title', `%${query}%`)
            completeQuery = workspaceContext.ids.length
              ? completeQuery.or(`user_id.eq.${userId},workspace_id.in.(${workspaceContext.ids.join(',')})`)
              : completeQuery.eq('user_id', userId)
            const { data: matchedTasks } = await completeQuery.limit(1)

            if (matchedTasks && matchedTasks.length > 0) {
              const taskToComplete = matchedTasks[0]
              if (taskToComplete.workspace_id) {
                await sendLineReply(replyToken, [{ type: 'text', text: `งาน "${taskToComplete.title}" มาจาก Team Space จึงกด done จาก LINE ไม่ได้ครับ — เปิดเว็บเพื่ออัปเดตสถานะใน workspace นะ` }])
                continue
              }
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

            await sendLineReply(replyToken, [{ type: 'text', text: `ยังหา task ที่ชื่อใกล้กับ "${query}" ไม่เจอครับ ลองกด /list เพื่อดูรายการอีกครั้งนะ` }])
            continue
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
          let taskQuery = admin
            .from('planner_tasks')
            .select('*')
            .eq('completed', false)
          taskQuery = workspaceContext.ids.length
            ? taskQuery.or(`user_id.eq.${userId},workspace_id.in.(${workspaceContext.ids.join(',')})`)
            : taskQuery.eq('user_id', userId)
          const { data: tasks, error: taskError } = await taskQuery
            .order('priority', { ascending: false })
            .order('due_date', { ascending: true })
            .limit(10)

          const visibleTasks = taskError ? [] : (tasks ?? []).map((task) => decorateLineWorkspaceRow(task, workspaceContext))
          await sendLineReply(replyToken, [createTasksFlex(visibleTasks)])
          continue
        }

        // 7. Fallback Command: /events or /dates
        if (text === '/events' || text === '/dates' || text === 'ดูวันสำคัญ' || text === 'วันสำคัญ' || aiResult?.action === 'LIST_EVENTS') {
          let eventQuery = admin
            .from('planner_events')
            .select('*')
            .gte('event_date', today)
          eventQuery = workspaceContext.ids.length
            ? eventQuery.or(`user_id.eq.${userId},workspace_id.in.(${workspaceContext.ids.join(',')})`)
            : eventQuery.eq('user_id', userId)
          const { data: eventsList, error: eventError } = await eventQuery
            .order('event_date', { ascending: true })
            .limit(10)

          const visibleEvents = eventError ? [] : (eventsList ?? []).map((event) => decorateLineWorkspaceRow(event, workspaceContext))
          await sendLineReply(replyToken, [createEventsFlex(visibleEvents)])
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
