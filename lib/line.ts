import 'server-only'
import crypto from 'crypto'

export interface LineTextMessage {
  type: 'text'
  text: string
  quickReply?: {
    items: Array<{
      type: 'action'
      action: {
        type: 'message' | 'uri'
        label: string
        text?: string
        uri?: string
      }
    }>
  }
}

export interface LineFlexMessage {
  type: 'flex'
  altText: string
  contents: Record<string, unknown>
}

export type LineMessage = LineTextMessage | LineFlexMessage

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || ''
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || ''

/**
 * Verifies that the incoming webhook request genuinely originated from LINE.
 */
export function verifyLineSignature(rawBody: string, signature: string | null): boolean {
  if (!signature || !LINE_CHANNEL_SECRET) return false
  const hash = crypto
    .createHmac('sha256', LINE_CHANNEL_SECRET)
    .update(rawBody)
    .digest('base64')
  return hash === signature
}

/**
 * Sends a reply message to LINE using a replyToken.
 */
export async function sendLineReply(replyToken: string, messages: LineMessage[]): Promise<boolean> {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    console.error('Missing LINE_CHANNEL_ACCESS_TOKEN')
    return false
  }

  try {
    const res = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        replyToken,
        messages,
      }),
    })

    if (!res.ok) {
      const errorText = await res.text()
      console.error('LINE Reply API error:', res.status, errorText)
      return false
    }
    return true
  } catch (err) {
    console.error('Failed to send LINE reply:', err)
    return false
  }
}

/**
 * Sends a push message directly to a specific LINE user.
 */
export async function sendLinePush(toUserId: string, messages: LineMessage[]): Promise<boolean> {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    console.error('Missing LINE_CHANNEL_ACCESS_TOKEN')
    return false
  }

  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        to: toUserId,
        messages,
      }),
    })

    if (!res.ok) {
      const errorText = await res.text()
      console.error('LINE Push API error:', res.status, errorText)
      return false
    }
    return true
  } catch (err) {
    console.error('Failed to send LINE push:', err)
    return false
  }
}

/**
 * Parse natural language / command for To-Do creation
 * Examples:
 * - "/todo อ่านหนังสือชีวะ"
 * - "/todo การบ้านคณิต [Math] พรุ่งนี้"
 * - "จดงาน ทำสรุปประวัติศาสตร์ วันนี้"
 */
export function parseTaskInput(input: string): {
  title: string
  subject: string
  dueDate: string
  deadlineConfidence: 'explicit' | 'inferred'
  priority: 1 | 2 | 3
  estimatedMinutes: number
} {
  let cleaned = input
    .replace(/^(\/todo|\/add|จดงาน|บันทึก|เพิ่มงาน)\s*/i, '')
    .trim()

  let subject = 'General'
  let priority: 1 | 2 | 3 = 2
  const estimatedMinutes = 25
  let dueDate = ''
  let deadlineConfidence: 'explicit' | 'inferred' = 'inferred'

  // 1. Check for [Subject] tag e.g. [Math] or [ฟิสิกส์]
  const subjectMatch = cleaned.match(/\[(.*?)\]/)
  if (subjectMatch) {
    subject = subjectMatch[1].trim()
    cleaned = cleaned.replace(subjectMatch[0], '').trim()
  }

  // 2. Check priority !1, !2, !3 or !urgent
  if (cleaned.includes('!1') || cleaned.toLowerCase().includes('!low')) {
    priority = 1
    cleaned = cleaned.replace(/!1|!low/gi, '').trim()
  } else if (cleaned.includes('!3') || cleaned.toLowerCase().includes('!high') || cleaned.includes('ด่วน')) {
    priority = 3
    cleaned = cleaned.replace(/!3|!high|ด่วน/gi, '').trim()
  }

  // 3. Date detection: "วันนี้", "พรุ่งนี้", "มะรืน", or YYYY-MM-DD
  const today = new Date()
  const formatDate = (d: Date) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  if (cleaned.includes('วันนี้') || cleaned.toLowerCase().includes('today')) {
    dueDate = formatDate(today)
    deadlineConfidence = 'explicit'
    cleaned = cleaned.replace(/วันนี้|today/gi, '').trim()
  } else if (cleaned.includes('พรุ่งนี้') || cleaned.toLowerCase().includes('tomorrow')) {
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    dueDate = formatDate(tomorrow)
    deadlineConfidence = 'explicit'
    cleaned = cleaned.replace(/พรุ่งนี้|tomorrow/gi, '').trim()
  } else if (cleaned.includes('มะรืน')) {
    const dayAfter = new Date(today)
    dayAfter.setDate(dayAfter.getDate() + 2)
    dueDate = formatDate(dayAfter)
    deadlineConfidence = 'explicit'
    cleaned = cleaned.replace(/มะรืน/gi, '').trim()
  } else {
    // Check for explicit YYYY-MM-DD or DD/MM
    const dateMatch = cleaned.match(/\b(\d{4}-\d{2}-\d{2})\b/)
    if (dateMatch) {
      dueDate = dateMatch[1]
      deadlineConfidence = 'explicit'
      cleaned = cleaned.replace(dateMatch[0], '').trim()
    } else {
      // Default to today if not specified
      dueDate = formatDate(today)
    }
  }

  // Clean remaining text as task title
  const title = cleaned.replace(/\s+/g, ' ').trim() || 'รายการใหม่'

  return {
    title,
    subject,
    dueDate,
    deadlineConfidence,
    priority,
    estimatedMinutes,
  }
}
