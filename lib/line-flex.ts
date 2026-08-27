import type { LineFlexMessage } from '@/lib/line'

const palette = {
  ink: '#49362C',
  muted: '#8A756A',
  paper: '#FFFDF7',
  line: '#E9DED2',
  blue: '#7D9FC9',
  blueSoft: '#E7EFF8',
  peach: '#F1B49F',
  peachSoft: '#FCE8E1',
  green: '#78A98E',
  greenSoft: '#E7F2EA',
  purple: '#9B8AB8',
  purpleSoft: '#EEEAF5',
}

type FlexComponent = Record<string, unknown>

const text = (value: string, options: Record<string, unknown> = {}): FlexComponent => ({
  type: 'text',
  text: value,
  color: palette.ink,
  ...options,
})

const button = (label: string, message: string, options: Record<string, unknown> = {}): FlexComponent => ({
  type: 'button',
  style: 'secondary',
  height: 'sm',
  color: palette.blueSoft,
  action: { type: 'message', label, text: message },
  ...options,
})

const footer = (...buttons: FlexComponent[]): FlexComponent => ({
  type: 'box',
  layout: 'horizontal',
  spacing: 'sm',
  contents: buttons,
})

const bubble = (body: FlexComponent[], footerContent?: FlexComponent): Record<string, unknown> => ({
  type: 'bubble',
  size: 'mega',
  styles: {
    body: { backgroundColor: palette.paper },
    footer: { backgroundColor: palette.paper, separator: true },
  },
  body: {
    type: 'box',
    layout: 'vertical',
    spacing: 'md',
    contents: body,
  },
  ...(footerContent ? { footer: footerContent } : {}),
})

const header = (eyebrow: string, title: string): FlexComponent[] => [
  {
    type: 'box',
    layout: 'horizontal',
    contents: [
      text('Study Manager.koko', { size: 'sm', weight: 'bold', color: palette.blue }),
      text(eyebrow, { size: 'xs', color: palette.muted, align: 'end' }),
    ],
  },
  text(title, { size: 'xl', weight: 'bold', margin: 'md' }),
]

const divider = (): FlexComponent => ({
  type: 'separator',
  color: palette.line,
  margin: 'sm',
})

export function createStatusFlex(count: number | null): LineFlexMessage {
  const taskCount = Math.max(0, count ?? 0)
  const hasTasks = taskCount > 0

  return {
    type: 'flex',
    altText: `Study Manager.koko ออนไลน์ · งานค้าง ${taskCount} รายการ`,
    contents: bubble(
      [
        ...header('STATUS', 'สรุปสถานะของคุณ'),
        {
          type: 'box',
          layout: 'horizontal',
          backgroundColor: hasTasks ? palette.peachSoft : palette.greenSoft,
          cornerRadius: 'lg',
          paddingAll: 'lg',
          contents: [
            text(hasTasks ? 'งานที่ยังค้างอยู่' : 'วันนี้เคลียร์หมดแล้ว', { size: 'sm', color: palette.muted, flex: 1 }),
            text(String(taskCount), { size: 'xxl', weight: 'bold', color: hasTasks ? palette.peach : palette.green, align: 'end' }),
          ],
        },
        text(hasTasks ? 'ค่อย ๆ ทำทีละอย่างนะ คุณกำลังไปได้ดี ✨' : 'เก่งมาก พื้นที่ในหัวโล่งขึ้นแล้ว 🌿', { size: 'sm', color: palette.muted, wrap: true }),
        divider(),
        text('พร้อมช่วยจัดการแผนวันนี้เสมอ', { size: 'sm', weight: 'bold' }),
      ],
      footer(
        button('ดูงานทั้งหมด', '/list', { flex: 1, color: palette.blueSoft }),
        button('วันสำคัญ', '/events', { flex: 1, color: palette.purpleSoft }),
      ),
    ),
  }
}

function priorityStyle(priority: number | null | undefined): { label: string; color: string; soft: string } {
  if (priority === 3) return { label: 'ด่วน', color: '#D87569', soft: '#FBE5E1' }
  if (priority === 2) return { label: 'ปกติ', color: '#C18D55', soft: '#F8EEDC' }
  return { label: 'ทั่วไป', color: palette.green, soft: palette.greenSoft }
}

export function createTasksFlex(tasks: Array<Record<string, unknown>>): LineFlexMessage {
  if (tasks.length === 0) {
    return {
      type: 'flex',
      altText: 'คุณไม่มีงานที่ค้างอยู่ในตอนนี้',
      contents: bubble(
        [
          ...header('TO-DO', 'ไม่มีงานค้างแล้ว 🎉'),
          text('พักหายใจได้เลย หรือเพิ่มงานใหม่เมื่อพร้อมนะ', { size: 'sm', color: palette.muted, wrap: true }),
        ],
        footer(button('เพิ่ม To-Do', '/todo ', { flex: 1, color: palette.greenSoft })),
      ),
    }
  }

  const bubbles = tasks.slice(0, 10).map((task) => {
    const priority = priorityStyle(Number(task.priority))
    const title = String(task.title || 'รายการใหม่')
    const subject = task.subject && task.subject !== 'General' ? String(task.subject) : 'ทั่วไป'
    const dueDate = task.due_date ? String(task.due_date) : 'ยังไม่กำหนด'

    return bubble([
      ...header('TO-DO', title),
      {
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        contents: [
          text(`📚 ${subject}`, { size: 'sm', color: palette.muted, flex: 1 }),
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: priority.soft,
            cornerRadius: 'sm',
            paddingAll: 'xs',
            contents: [text(priority.label, { size: 'xs', color: priority.color, align: 'center', weight: 'bold' })],
          },
        ],
      },
      divider(),
      text(`📅 กำหนดส่ง  ${dueDate}`, { size: 'sm' }),
    ], footer(
      button('ทำเสร็จแล้ว', `/done ${title}`, { flex: 1, color: palette.greenSoft }),
      button('ดูทั้งหมด', '/list', { flex: 1, color: palette.blueSoft }),
    ))
  })

  return {
    type: 'flex',
    altText: `รายการ To-Do ของคุณ ${tasks.length} รายการ`,
    contents: { type: 'carousel', contents: bubbles },
  }
}

function eventStyle(type: string | undefined): { label: string; color: string; soft: string } {
  if (type === 'exam') return { label: 'สอบ', color: '#C56D66', soft: '#FBE5E1' }
  if (type === 'competition') return { label: 'แข่งขัน', color: '#B57A45', soft: '#F8EEDC' }
  if (type === 'project') return { label: 'โปรเจกต์', color: palette.blue, soft: palette.blueSoft }
  return { label: 'สำคัญ', color: palette.purple, soft: palette.purpleSoft }
}

export function createEventsFlex(events: Array<Record<string, unknown>>): LineFlexMessage {
  if (events.length === 0) {
    return {
      type: 'flex',
      altText: 'ยังไม่มีวันสำคัญที่กำลังจะมาถึง',
      contents: bubble(
        [
          ...header('CALENDAR', 'ยังไม่มีวันสำคัญ'),
          text('เพิ่มสอบ แข่งขัน หรือเดดไลน์สำคัญไว้ได้เลย', { size: 'sm', color: palette.muted, wrap: true }),
        ],
        footer(button('เพิ่มวันสำคัญ', '/event ', { flex: 1, color: palette.purpleSoft })),
      ),
    }
  }

  const bubbles = events.slice(0, 10).map((event) => {
    const style = eventStyle(String(event.type || 'important'))
    const title = String(event.title || 'วันสำคัญ')
    const date = String(event.event_date || 'ยังไม่กำหนด')

    return bubble([
      ...header('CALENDAR', title),
      {
        type: 'box',
        layout: 'horizontal',
        backgroundColor: style.soft,
        cornerRadius: 'lg',
        paddingAll: 'lg',
        contents: [
          text('📅', { size: 'xl', flex: 0 }),
          {
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            contents: [
              text(date, { size: 'lg', weight: 'bold', color: style.color }),
              text(style.label, { size: 'xs', color: palette.muted, margin: 'xs' }),
            ],
          },
        ],
      },
      ...(event.notes ? [text(String(event.notes), { size: 'sm', color: palette.muted, wrap: true })] : []),
    ], footer(
      button('ดูวันอื่น ๆ', '/events', { flex: 1, color: palette.blueSoft }),
      button('เพิ่มวันสำคัญ', '/event ', { flex: 1, color: palette.purpleSoft }),
    ))
  })

  return {
    type: 'flex',
    altText: `วันสำคัญและนัดหมาย ${events.length} รายการ`,
    contents: { type: 'carousel', contents: bubbles },
  }
}
