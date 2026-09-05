import { NextResponse } from 'next/server'
import { verifyLineSignature, sendLineReply, parseTaskInput } from '@/lib/line'
import { createBatchCaptureFlex, createEventsFlex, createStatusFlex, createTaskDoneFlex, createTasksFlex, type BatchCaptureSummaryItem } from '@/lib/line-flex'
import { analyzeUserMessageWithGemini } from '@/lib/gemini'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { loadApprovedPersonalMemory, stagePersonalMemoryProposal } from '@/lib/personal-memory-server'
import { findExactOpenDuplicate, prepareTaskInput } from '@/lib/task-intelligence'
import { decorateLineWorkspaceRow, loadLineWorkspaceContext } from '@/lib/line-workspaces'
import type { LineWorkspaceContext } from '@/lib/line-workspaces'
import { loadLineAiContext, resolveLineSubjectName, type LineAiContext } from '@/lib/line-ai-context'
import crypto from 'crypto'

type NaturalTeamTaskRequest = {
  targetIndex: number | null
  taskInput: string
}

const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://koko-study.vercel.app'
const appUrl = /^https?:\/\//i.test(configuredAppUrl) ? configuredAppUrl.replace(/\/$/, '') : 'https://koko-study.vercel.app'

function bangkokDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

// The AI may interpret language, but it may never create a new subject from
// that interpretation. The per-user ontology snapshot is the authority.
function resolveLineSubject(context: LineAiContext, rawName: string) {
  const name = resolveLineSubjectName(rawName, context)
  return { name, id: context.subjectIds[name] ?? null }
}

async function insertLineTask(admin: ReturnType<typeof getSupabaseAdmin>, task: Record<string, unknown>) {
  const intelligence = prepareTaskInput({
    title: typeof task.title === 'string' ? task.title : '',
    subject: typeof task.subject === 'string' ? task.subject : 'General',
    dueDate: typeof task.due_date === 'string' ? task.due_date : '',
    deadlineConfidence: task.deadline_confidence === 'explicit' || task.deadline_confidence === 'inferred' || task.deadline_confidence === 'none' ? task.deadline_confidence : undefined,
  })
  const normalizedTask: Record<string, unknown> = {
    ...task,
    title: intelligence.title,
    subject: intelligence.subject,
    normalized_title: intelligence.normalizedTitle,
    subject_key: intelligence.subjectKey,
    deadline_confidence: intelligence.deadlineConfidence,
  }
  const workspaceId = typeof normalizedTask.workspace_id === 'string' ? normalizedTask.workspace_id : null
  let duplicateQuery = admin
    .from('planner_tasks')
    .select('id, title, subject, due_date, completed')
    .eq('completed', false)
    .order('created_at', { ascending: false })
    .limit(100)
  duplicateQuery = workspaceId
    ? duplicateQuery.eq('workspace_id', workspaceId)
    : duplicateQuery.eq('user_id', String(normalizedTask.user_id)).is('workspace_id', null)
  const { data: existingTasks } = await duplicateQuery
  const duplicate = findExactOpenDuplicate(
    (existingTasks ?? []).map((item) => ({ ...item, dueDate: item.due_date ?? '' })),
    { title: intelligence.title, subject: intelligence.subject, dueDate: typeof normalizedTask.due_date === 'string' ? normalizedTask.due_date : '' },
  )
  if (duplicate) return { error: null, duplicate }

  const { subject_id: _subjectId, normalized_title: _normalizedTitle, subject_key: _subjectKey, deadline_confidence: _deadlineConfidence, ...legacyTask } = normalizedTask as Record<string, unknown>
  const result = await admin.from('planner_tasks').insert(normalizedTask)
  // V1 is additive and may not have been run on every environment yet. Do not
  // turn a harmless missing column into a lost LINE task during rollout.
  if (result.error && /subject_id|linked subject|must belong to you|normalized_title|subject_key|deadline_confidence|schema cache|column/i.test(result.error.message)) {
    const fallback = await admin.from('planner_tasks').insert(legacyTask)
    return { ...fallback, duplicate: null }
  }
  return { ...result, duplicate: null }
}

async function insertLineEvent(admin: ReturnType<typeof getSupabaseAdmin>, event: Record<string, unknown>) {
  const userId = String(event.user_id ?? '')
  const title = typeof event.title === 'string' ? event.title.replace(/\s+/g, ' ').trim().slice(0, 160) : ''
  const eventDate = typeof event.event_date === 'string' ? event.event_date : ''
  if (!userId || !title || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return { error: new Error('Invalid event'), duplicate: null }

  const { data: duplicate } = await admin
    .from('planner_events')
    .select('id, title, event_date')
    .eq('user_id', userId)
    .is('workspace_id', null)
    .eq('event_date', eventDate)
    .ilike('title', title)
    .limit(1)
    .maybeSingle()
  if (duplicate) return { error: null, duplicate }

  const result = await admin.from('planner_events').insert({ ...event, title })
  return { ...result, duplicate: null }
}

/** LINE uses a service-role client, so it deliberately writes the display
 * subject rather than an RLS-protected subject_id reference. The web client
 * can enrich that relation later without blocking a plain-language edit. */
async function updateLineTask(admin: ReturnType<typeof getSupabaseAdmin>, userId: string, taskId: string, current: Record<string, unknown>, changes: Record<string, unknown>) {
  const title = typeof changes.title === 'string' ? changes.title : String(current.title ?? '')
  const subject = typeof changes.subject === 'string' ? changes.subject : String(current.subject ?? 'General')
  const dueDate = changes.clear_deadline === true ? null : typeof changes.due_date === 'string' ? changes.due_date : current.due_date ?? null
  const intelligence = prepareTaskInput({ title, subject, dueDate: typeof dueDate === 'string' ? dueDate : '', deadlineConfidence: dueDate ? 'explicit' : 'none' })
  const row = {
    title: intelligence.title,
    subject: intelligence.subject,
    due_date: dueDate,
    estimated_minutes: typeof changes.estimated_minutes === 'number' ? changes.estimated_minutes : current.estimated_minutes ?? 25,
    priority: typeof changes.priority === 'number' ? changes.priority : current.priority ?? 2,
    normalized_title: intelligence.normalizedTitle,
    subject_key: intelligence.subjectKey,
    deadline_confidence: intelligence.deadlineConfidence,
  }
  let result = await admin.from('planner_tasks').update(row).eq('id', taskId).eq('user_id', userId).is('workspace_id', null).select('id, title, subject, due_date, estimated_minutes, priority').maybeSingle()
  if (result.error && /normalized_title|subject_key|deadline_confidence|schema cache|column/i.test(result.error.message)) {
    const { normalized_title: _normalizedTitle, subject_key: _subjectKey, deadline_confidence: _deadlineConfidence, ...legacyRow } = row
    result = await admin.from('planner_tasks').update(legacyRow).eq('id', taskId).eq('user_id', userId).is('workspace_id', null).select('id, title, subject, due_date, estimated_minutes, priority').maybeSingle()
  }
  return result
}

async function updateLineEvent(admin: ReturnType<typeof getSupabaseAdmin>, userId: string, eventId: string, current: Record<string, unknown>, changes: Record<string, unknown>) {
  const row = {
    title: typeof changes.title === 'string' ? changes.title : current.title,
    event_date: typeof changes.event_date === 'string' ? changes.event_date : current.event_date,
    type: typeof changes.type === 'string' ? changes.type : current.type,
    notes: typeof changes.notes === 'string' ? changes.notes : current.notes ?? '',
  }
  return admin.from('planner_events').update(row).eq('id', eventId).eq('user_id', userId).is('workspace_id', null).select('id, title, event_date, type').maybeSingle()
}

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
            .select('title, subject, workspace_id')
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
            await admin.from('user_planner_behavior_events').insert({
              user_id: userConn.user_id,
              event_type: 'task_completed',
              subject: taskToComplete?.subject || 'General',
              task_id: taskId,
            })
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
        const today = bangkokDateKey()

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
        let ontologyContextPromise: Promise<LineAiContext> | null = null
        const getOntologyContext = () => {
          ontologyContextPromise ??= loadLineAiContext(admin, userId, workspaceContext)
          return ontologyContextPromise
        }

        // 3. Fast Command: /help
        if (text === '/help' || text === 'เมนู' || text === 'ช่วยเหลือ' || text === '/menu') {
          await sendLineReply(replyToken, [
            {
              type: 'text',
              text: `📖 คำสั่งที่รองรับใน Study Manager.koko:\n\n` +
                `✨ พิมพ์คุยภาษาพูดได้เลย เช่น:\n` +
                `• "พรุ่งนี้มีสอบฟิสิกส์ตอนบ่าย"\n` +
                `• "ช่วยเตือนทำการบ้านเลขหน่อย ด่วนมาก"\n` +
                `• "เลขส่งศุกร์ อังกฤษท่องศัพท์พรุ่งนี้ แล้ววันจันทร์สอบชีวะ"\n` +
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

          const ontologyContext = await getOntologyContext()
          const parsed = parseTaskInput(taskInput)
          const resolvedSubject = resolveLineSubject(ontologyContext, parsed.subject)
          const teamTaskId = crypto.randomUUID()
          const targetWorkspaceId = workspaceContext.ids[targetIndex]
          const targetWorkspaceName = workspaceContext.names[targetWorkspaceId] || 'Team Space'
          const { error: teamInsertError, duplicate: teamDuplicate } = await insertLineTask(admin, {
            id: teamTaskId,
            user_id: userId,
            workspace_id: targetWorkspaceId,
            title: parsed.title,
            subject: resolvedSubject.name,
            subject_id: resolvedSubject.id,
            due_date: parsed.dueDate || null,
            deadline_confidence: parsed.deadlineConfidence,
            estimated_minutes: parsed.estimatedMinutes,
            priority: parsed.priority,
            completed: false,
            created_at: new Date().toISOString(),
          })

          if (teamDuplicate) {
            await sendLineReply(replyToken, [{ type: 'text', text: `งาน "${teamDuplicate.title}" มีอยู่ใน Team Space นี้แล้ว จึงเก็บไว้แค่รายการเดียวครับ` }])
            continue
          }
          if (teamInsertError) {
            console.error('Failed to create LINE team task:', teamInsertError)
            await sendLineReply(replyToken, [{ type: 'text', text: 'เพิ่มงานเข้า Team Space ไม่สำเร็จครับ ลองใหม่อีกครั้งนะ' }])
            continue
          }

          await sendLineReply(replyToken, [{
            type: 'text',
            text: `✅ เพิ่มงานเข้า Team Space แล้ว\n\n🏠 ${targetWorkspaceName}\n📌 งาน: ${parsed.title}\n📚 วิชา: ${resolvedSubject.name}\n📅 กำหนด: ${parsed.dueDate || 'ไม่ระบุ'}\n⚡ Priority: ${parsed.priority}`,
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
            .select('id, title, subject, workspace_id')
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
            await admin.from('user_planner_behavior_events').insert({ user_id: userId, event_type: 'task_completed', subject: matchedTask.subject || 'General', task_id: matchedTask.id })
            await sendLineReply(replyToken, [createTaskDoneFlex(matchedTask.title)])
          } else {
            await sendLineReply(replyToken, [{ type: 'text', text: 'ยังหา task ที่ชื่อใกล้กับ "' + taskQuery + '" ไม่เจอครับ ลองกด /list เพื่อดูรายการอีกครั้งนะ' }])
          }
          continue
        }

        // 5. Try Gemini AI Understanding First!
        const personalMemory = await loadApprovedPersonalMemory(admin, userId)
        const ontologyContext = await getOntologyContext()
        const aiResult = await analyzeUserMessageWithGemini(text, today, personalMemory, ontologyContext.prompt)

        if (aiResult) {
          // Only conversational input may create an optional personal-memory
          // proposal. Commands, tasks, dates, and Team Space data never do.
          if (aiResult.action === 'CHAT' && !/(?:team\s*space|workspace|งานทีม|ทีม)/i.test(text)) {
            await stagePersonalMemoryProposal(admin, userId, aiResult.memoryProposal)
          }

          // --- AI ACTION: ADD_BATCH ---
          // A single school message often contains several unrelated subjects
          // and deadlines. Persist each item independently, then return one
          // receipt so the learner can verify the interpretation at a glance.
          if (aiResult.action === 'ADD_BATCH') {
            const summary: BatchCaptureSummaryItem[] = []
            for (const item of aiResult.items.slice(0, 8)) {
              if (item.kind === 'task') {
                const resolvedSubject = resolveLineSubject(ontologyContext, item.subject)
                const { error, duplicate } = await insertLineTask(admin, {
                  id: crypto.randomUUID(), user_id: userId, title: item.title, subject: resolvedSubject.name,
                  subject_id: resolvedSubject.id, due_date: item.dueDate, deadline_confidence: 'inferred',
                  estimated_minutes: item.estimatedMinutes, priority: item.priority, completed: false,
                  created_at: new Date().toISOString(),
                })
                if (error) console.error('Failed to create LINE batch task:', { title: item.title, error: error.message, code: 'code' in error ? error.code : undefined })
                summary.push({ kind: 'task', title: item.title, subject: resolvedSubject.name, date: item.dueDate, status: duplicate ? 'duplicate' : error ? 'failed' : 'created' })
                continue
              }

              const { error, duplicate } = await insertLineEvent(admin, {
                id: crypto.randomUUID(), user_id: userId, title: item.title, event_date: item.eventDate,
                type: item.type, notes: item.notes, created_at: new Date().toISOString(),
              })
              if (error) console.error('Failed to create LINE batch event:', { title: item.title, error: error.message, code: 'code' in error ? error.code : undefined })
              summary.push({ kind: 'event', title: item.title, date: item.eventDate, status: duplicate ? 'duplicate' : error ? 'failed' : 'created' })
            }
            await sendLineReply(replyToken, [createBatchCaptureFlex(summary)])
            continue
          }

          // --- AI ACTION: ADD_TODO ---
          if (aiResult.action === 'ADD_TODO') {
            const taskId = crypto.randomUUID()
            const resolvedSubject = resolveLineSubject(ontologyContext, aiResult.subject || 'General')
            const { error: insertError, duplicate } = await insertLineTask(admin, {
              id: taskId,
              user_id: userId,
              title: aiResult.title,
              subject: resolvedSubject.name,
              subject_id: resolvedSubject.id,
              due_date: aiResult.dueDate || today,
              deadline_confidence: 'inferred',
              estimated_minutes: aiResult.estimatedMinutes || 25,
              priority: aiResult.priority || 2,
              completed: false,
              created_at: new Date().toISOString(),
            })

            if (duplicate) {
              await sendLineReply(replyToken, [{ type: 'text', text: `งาน "${duplicate.title}" มีอยู่ในรายการแล้ว จึงเก็บไว้แค่รายการเดียวครับ` }])
              continue
            }
            if (!insertError) {
              const priorityLabel = aiResult.priority === 3 ? '🔴 สูงมาก (ด่วน)' : aiResult.priority === 2 ? '🟡 ปานกลาง' : '🟢 ทั่วไป'
              let replyMessage =
                `✨ บันทึก To-Do สำเร็จแล้ว! 🤖\n\n` +
                `📌 งาน: ${aiResult.title}\n` +
                `📚 วิชา: ${resolvedSubject.name}\n` +
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

          // --- AI ACTION: EDIT_TASK ---
          if (aiResult.action === 'EDIT_TASK') {
            const { data: matches, error: findError } = await admin
              .from('planner_tasks')
              .select('id, title, subject, due_date, estimated_minutes, priority')
              .eq('user_id', userId)
              .is('workspace_id', null)
              .eq('completed', false)
              .ilike('title', `%${aiResult.taskQuery}%`)
              .limit(3)
            if (findError || !matches?.length) {
              await sendLineReply(replyToken, [{ type: 'text', text: `ยังหา task ที่ชื่อใกล้กับ “${aiResult.taskQuery}” ไม่เจอครับ ลองพิมพ์ชื่อให้ชัดขึ้นอีกนิดนะ` }])
              continue
            }
            if (matches.length > 1) {
              await sendLineReply(replyToken, [{ type: 'text', text: `เจองานที่คล้ายกัน ${matches.length} งานครับ: ${matches.map((task) => `“${task.title}”`).join(', ')}\n\nช่วยพิมพ์ชื่อที่ต้องการแก้ให้เฉพาะขึ้นอีกนิดนะ` }])
              continue
            }
            const currentTask = matches[0]
            const resolvedSubject = aiResult.subject ? resolveLineSubject(ontologyContext, aiResult.subject).name : undefined
            const { data: updated, error: updateError } = await updateLineTask(admin, userId, currentTask.id, currentTask, {
              ...(aiResult.title ? { title: aiResult.title } : {}),
              ...(resolvedSubject ? { subject: resolvedSubject } : {}),
              ...(aiResult.dueDate ? { due_date: aiResult.dueDate } : {}),
              ...(aiResult.clearDeadline ? { clear_deadline: true } : {}),
              ...(aiResult.priority ? { priority: aiResult.priority } : {}),
              ...(aiResult.estimatedMinutes ? { estimated_minutes: aiResult.estimatedMinutes } : {}),
            })
            if (updateError || !updated) {
              console.error('Failed to edit LINE task:', updateError)
              await sendLineReply(replyToken, [{ type: 'text', text: 'แก้ task นี้ไม่สำเร็จครับ ลองใหม่อีกครั้ง หรือเปิด Planner เพื่อแก้โดยตรงนะ' }])
              continue
            }
            const changed: string[] = []
            if (aiResult.title) changed.push(`ชื่อ: ${updated.title}`)
            if (resolvedSubject) changed.push(`วิชา: ${updated.subject}`)
            if (aiResult.dueDate || aiResult.clearDeadline) changed.push(`กำหนด: ${updated.due_date || 'ไม่ระบุ'}`)
            if (aiResult.priority) changed.push(`priority: ${updated.priority}`)
            if (aiResult.estimatedMinutes) changed.push(`เวลา: ${updated.estimated_minutes} นาที`)
            await sendLineReply(replyToken, [{ type: 'text', text: `✏️ แก้ไข “${updated.title}” แล้วครับ\n\n${changed.map((item) => `• ${item}`).join('\n')}${aiResult.aiComment ? `\n\n${aiResult.aiComment}` : ''}` }])
            continue
          }

          // --- AI ACTION: EDIT_EVENT ---
          if (aiResult.action === 'EDIT_EVENT') {
            const { data: matches, error: findError } = await admin
              .from('planner_events')
              .select('id, title, event_date, type, notes')
              .eq('user_id', userId)
              .is('workspace_id', null)
              .ilike('title', `%${aiResult.eventQuery}%`)
              .limit(3)
            if (findError || !matches?.length) {
              await sendLineReply(replyToken, [{ type: 'text', text: `ยังหา important date ที่ชื่อใกล้กับ “${aiResult.eventQuery}” ไม่เจอครับ ลองพิมพ์ชื่อให้ชัดขึ้นอีกนิดนะ` }])
              continue
            }
            if (matches.length > 1) {
              await sendLineReply(replyToken, [{ type: 'text', text: `เจอวันสำคัญที่คล้ายกัน ${matches.length} รายการครับ: ${matches.map((item) => `“${item.title}”`).join(', ')}\n\nช่วยพิมพ์ชื่อที่ต้องการแก้ให้เฉพาะขึ้นอีกนิดนะ` }])
              continue
            }
            const currentEvent = matches[0]
            const { data: updated, error: updateError } = await updateLineEvent(admin, userId, currentEvent.id, currentEvent, {
              ...(aiResult.title ? { title: aiResult.title } : {}),
              ...(aiResult.eventDate ? { event_date: aiResult.eventDate } : {}),
              ...(aiResult.type ? { type: aiResult.type } : {}),
              ...(aiResult.notes !== undefined ? { notes: aiResult.notes } : {}),
            })
            if (updateError || !updated) {
              console.error('Failed to edit LINE event:', updateError)
              await sendLineReply(replyToken, [{ type: 'text', text: 'แก้วันสำคัญนี้ไม่สำเร็จครับ ลองใหม่อีกครั้ง หรือเปิด Planner เพื่อแก้โดยตรงนะ' }])
              continue
            }
            const changed: string[] = []
            if (aiResult.title) changed.push(`ชื่อ: ${updated.title}`)
            if (aiResult.eventDate) changed.push(`วันที่: ${updated.event_date}`)
            if (aiResult.type) changed.push(`ประเภท: ${updated.type}`)
            if (aiResult.notes !== undefined) changed.push('อัปเดตโน้ตแล้ว')
            await sendLineReply(replyToken, [{ type: 'text', text: `✏️ แก้ไขวันสำคัญ “${updated.title}” แล้วครับ\n\n${changed.map((item) => `• ${item}`).join('\n')}${aiResult.aiComment ? `\n\n${aiResult.aiComment}` : ''}` }])
            continue
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

              await admin.from('user_planner_behavior_events').insert({ user_id: userId, event_type: 'task_completed', subject: taskToComplete.subject || 'General', task_id: taskToComplete.id })

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
        const fallbackOntologyContext = await getOntologyContext()
        const resolvedSubject = resolveLineSubject(fallbackOntologyContext, parsed.subject)

        const { error: fallbackInsertError, duplicate: fallbackDuplicate } = await insertLineTask(admin, {
          id: taskId,
          user_id: userId,
          title: parsed.title,
          subject: resolvedSubject.name,
          subject_id: resolvedSubject.id,
          due_date: parsed.dueDate || null,
          deadline_confidence: parsed.deadlineConfidence,
          estimated_minutes: parsed.estimatedMinutes,
          priority: parsed.priority,
          completed: false,
          created_at: new Date().toISOString(),
        })

        if (fallbackDuplicate) {
          await sendLineReply(replyToken, [{ type: 'text', text: `งาน "${fallbackDuplicate.title}" มีอยู่ในรายการแล้ว จึงเก็บไว้แค่รายการเดียวครับ` }])
          continue
        }
        if (fallbackInsertError) {
          await sendLineReply(replyToken, [{ type: 'text', text: 'เพิ่มงานไม่สำเร็จครับ ลองใหม่อีกครั้งนะ' }])
          continue
        }

        const priorityLabel = parsed.priority === 3 ? '🔴 สูงมาก (ด่วน)' : parsed.priority === 2 ? '🟡 ปานกลาง' : '🟢 ทั่วไป'
        await sendLineReply(replyToken, [
          {
            type: 'text',
            text: `✨ บันทึก To-Do สำเร็จแล้ว!\n\n📌 งาน: ${parsed.title}\n📚 วิชา: ${resolvedSubject.name}\n📅 กำหนด: ${parsed.dueDate || 'ไม่ระบุ'}\n⚡ ความสำคัญ: ${priorityLabel}`,
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
