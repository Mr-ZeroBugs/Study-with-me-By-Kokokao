import type { LineFlexMessage } from '@/lib/line'

// ── Palette ─────────────────────────────────────────────────────────────────
// Warm cozy tones that mirror globals.css design tokens
const p = {
  ink:         '#49362C',
  inkDark:     '#2E1F16',
  muted:       '#8A756A',
  paper:       '#FFFDF7',
  paperWarm:   '#FFFAF2',
  cream:       '#F9F1E8',
  line:        '#E9DED2',
  lineLight:   '#F0E6DC',

  blue:        '#5E86B0',
  blueMid:     '#7D9FC9',
  blueSoft:    '#E7EFF8',
  blueDeep:    '#A9CCE8',

  peach:       '#E87A82',
  peachMid:    '#F1B49F',
  peachSoft:   '#FCE8E1',
  peachDeep:   '#F0C9C9',

  green:       '#5C9774',
  greenMid:    '#78A98E',
  greenSoft:   '#E7F2EA',
  greenDeep:   '#C5EAD7',

  purple:      '#8B6DAC',
  purpleMid:   '#9B8AB8',
  purpleSoft:  '#EEEAF5',
  purpleDeep:  '#DAC4EC',

  yellow:      '#C8922A',
  yellowSoft:  '#FFF7D9',
  yellowDeep:  '#F4DD8C',
}

type FlexComponent = Record<string, unknown>

// ── Primitives ───────────────────────────────────────────────────────────────

const txt = (value: string, opts: FlexComponent = {}): FlexComponent => ({
  type: 'text',
  text: value,
  color: p.ink,
  ...opts,
})

const sep = (color = p.line): FlexComponent => ({
  type: 'separator',
  color,
  margin: 'none',
})

// Rounded pill / badge component
const badge = (label: string, color: string, bg: string): FlexComponent => ({
  type: 'box',
  layout: 'vertical',
  backgroundColor: bg,
  cornerRadius: '20px',
  paddingTop: 'xs',
  paddingBottom: 'xs',
  paddingStart: 'sm',
  paddingEnd: 'sm',
  contents: [txt(label, { size: 'xxs', color, weight: 'bold', align: 'center' })],
})

// Small filled dot accent
const dot = (color: string): FlexComponent => ({
  type: 'box',
  layout: 'vertical',
  width: '8px',
  height: '8px',
  cornerRadius: '10px',
  backgroundColor: color,
  contents: [],
})

// ── Header Band ──────────────────────────────────────────────────────────────
// Two-tone header: tinted eyebrow strip + left-accent title bar
const headerBand = (eyebrow: string, title: string, accentColor: string, accentBg: string): FlexComponent[] => [
  // Top strip: brand name + eyebrow badge
  {
    type: 'box',
    layout: 'horizontal',
    backgroundColor: accentBg,
    paddingTop: 'md',
    paddingBottom: 'md',
    paddingStart: 'xl',
    paddingEnd: 'xl',
    alignItems: 'center',
    contents: [
      {
        type: 'box',
        layout: 'vertical',
        flex: 1,
        contents: [
          txt('Study Manager', { size: 'xs', weight: 'bold', color: accentColor }),
          txt('.koko', { size: 'xxs', color: p.muted }),
        ],
      },
      badge(eyebrow, accentColor, p.paper),
    ],
  },
  // Title row with left accent bar
  {
    type: 'box',
    layout: 'horizontal',
    paddingTop: 'lg',
    paddingBottom: 'md',
    paddingStart: 'xl',
    paddingEnd: 'xl',
    alignItems: 'center',
    spacing: 'md',
    contents: [
      {
        type: 'box',
        layout: 'vertical',
        width: '4px',
        height: '24px',
        cornerRadius: '4px',
        backgroundColor: accentColor,
        contents: [],
      },
      txt(title, { size: 'xl', weight: 'bold', color: p.inkDark, wrap: true, flex: 1 }),
    ],
  },
]

// ── CTA Buttons ──────────────────────────────────────────────────────────────
const ctaBtn = (label: string, message: string, bg: string, opts: FlexComponent = {}): FlexComponent => ({
  type: 'button',
  style: 'primary',
  height: 'sm',
  color: bg,
  action: { type: 'message', label, text: message },
  ...opts,
})

const ghostBtn = (label: string, message: string, opts: FlexComponent = {}): FlexComponent => ({
  type: 'button',
  style: 'secondary',
  height: 'sm',
  color: p.paper,
  action: { type: 'message', label, text: message },
  ...opts,
})

// ── Footer strip (warm cream background) ─────────────────────────────────────
const footerStrip = (...buttons: FlexComponent[]): FlexComponent => ({
  type: 'box',
  layout: 'horizontal',
  spacing: 'sm',
  paddingTop: 'md',
  paddingBottom: 'lg',
  paddingStart: 'lg',
  paddingEnd: 'lg',
  backgroundColor: p.cream,
  contents: buttons,
})

// ── Bubble shell ─────────────────────────────────────────────────────────────
const bubble = (body: FlexComponent[], footer?: FlexComponent): Record<string, unknown> => ({
  type: 'bubble',
  size: 'mega',
  styles: {
    body:   { backgroundColor: p.paper },
    footer: { backgroundColor: p.cream, separator: true, separatorColor: p.lineLight },
  },
  body: {
    type: 'box',
    layout: 'vertical',
    spacing: 'none',
    paddingAll: 'none',
    contents: body,
  },
  ...(footer ? { footer } : {}),
})

// ── Priority / event style maps ───────────────────────────────────────────────
function priorityStyle(priority: number | null | undefined): { label: string; color: string; soft: string } {
  if (priority === 3) return { label: '🔴 ด่วน',   color: '#C0504D', soft: '#FBE5E1' }
  if (priority === 2) return { label: '🟡 ปกติ',   color: '#A07840', soft: '#F8EEDC' }
  return                     { label: '🟢 ทั่วไป', color: p.green,  soft: p.greenSoft }
}

function eventStyle(type: string | undefined): { label: string; color: string; soft: string } {
  if (type === 'exam')        return { label: '📝 สอบ',      color: '#C0504D', soft: '#FBE5E1' }
  if (type === 'competition') return { label: '🏆 แข่งขัน',  color: '#A07840', soft: '#F8EEDC' }
  if (type === 'project')     return { label: '💻 โปรเจกต์', color: p.blue,   soft: p.blueSoft }
  return                              { label: '⭐ สำคัญ',    color: p.purple, soft: p.purpleSoft }
}

// ════════════════════════════════════════════════════════════════════════════
//  STATUS CARD
// ════════════════════════════════════════════════════════════════════════════
export function createStatusFlex(count: number | null): LineFlexMessage {
  const taskCount = Math.max(0, count ?? 0)
  const hasTasks  = taskCount > 0

  const accentColor = hasTasks ? p.peach  : p.green
  const accentBg    = hasTasks ? p.peachSoft : p.greenSoft
  const heroGradBg  = hasTasks ? '#FEF0ED' : '#EBF5EE'
  const heroBorder  = hasTasks ? p.peachDeep : p.greenDeep

  return {
    type: 'flex',
    altText: `Study Manager.koko · งานค้าง ${taskCount} รายการ`,
    contents: bubble(
      [
        // ── Branded header ──
        ...headerBand(
          hasTasks ? 'TO-DO' : 'ALL CLEAR',
          hasTasks ? 'สรุปสถานะของคุณ' : 'คุณเคลียร์หมดแล้ว!',
          accentColor,
          accentBg,
        ),

        // ── Hero stat box ──
        {
          type: 'box',
          layout: 'vertical',
          paddingStart: 'xl',
          paddingEnd: 'xl',
          paddingBottom: 'lg',
          contents: [
            {
              type: 'box',
              layout: 'horizontal',
              backgroundColor: heroGradBg,
              cornerRadius: '16px',
              paddingAll: 'lg',
              borderWidth: '1px',
              borderColor: heroBorder,
              alignItems: 'center',
              contents: [
                {
                  type: 'box',
                  layout: 'vertical',
                  flex: 1,
                  spacing: 'xs',
                  contents: [
                    txt(hasTasks ? 'งานที่ยังค้างอยู่' : 'วันนี้เสร็จหมดแล้ว', {
                      size: 'sm', color: p.muted, weight: 'bold',
                    }),
                    txt(
                      hasTasks ? 'ค่อยๆ ทำทีละอย่างนะ ✨' : 'พื้นที่ในหัวโล่งมาก 🌿',
                      { size: 'xs', color: p.muted, wrap: true },
                    ),
                  ],
                },
                // Big number
                {
                  type: 'box',
                  layout: 'vertical',
                  alignItems: 'flex-end',
                  contents: [
                    txt(String(taskCount), { size: '5xl', weight: 'bold', color: accentColor }),
                    txt(hasTasks ? 'รายการ' : '🎉', { size: 'xs', color: p.muted, align: 'end' }),
                  ],
                },
              ],
            },
          ],
        },

        sep(p.lineLight),

        // ── Motivational row ──
        {
          type: 'box',
          layout: 'horizontal',
          paddingAll: 'xl',
          paddingTop: 'lg',
          paddingBottom: 'lg',
          alignItems: 'center',
          spacing: 'sm',
          contents: [
            dot(accentColor),
            txt('พร้อมช่วยจัดการแผนวันนี้เสมอ', { size: 'sm', weight: 'bold', color: p.inkDark }),
          ],
        },
      ],
      footerStrip(
        ctaBtn('ดูงานทั้งหมด', '/list',   p.peach),
        ctaBtn('วันสำคัญ',     '/events', p.purple),
      ),
    ),
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  MORNING REMINDER CARD
// ════════════════════════════════════════════════════════════════════════════
export function createMorningReminderFlex(tasks: Array<Record<string, unknown>>, date: string): LineFlexMessage {
  const taskRows: FlexComponent[] = tasks.slice(0, 5).map((task, index) => {
    const prio  = priorityStyle(Number(task.priority))
    const title = String(task.title   || 'รายการใหม่')
    const subj  = task.subject && task.subject !== 'General' ? String(task.subject) : 'ทั่วไป'

    return {
      type: 'box',
      layout: 'horizontal',
      spacing: 'md',
      paddingTop: 'md',
      paddingBottom: 'md',
      paddingStart: 'xl',
      paddingEnd: 'xl',
      backgroundColor: index % 2 === 0 ? p.paperWarm : p.paper,
      alignItems: 'center',
      contents: [
        // Numbered circle
        {
          type: 'box',
          layout: 'vertical',
          width: '24px',
          height: '24px',
          cornerRadius: '12px',
          backgroundColor: p.blueSoft,
          alignItems: 'center',
          justifyContent: 'center',
          contents: [txt(`${index + 1}`, { size: 'xs', weight: 'bold', color: p.blue, align: 'center' })],
        },
        // Task info
        {
          type: 'box',
          layout: 'vertical',
          flex: 1,
          spacing: 'xs',
          contents: [
            txt(title, { size: 'sm', weight: 'bold', wrap: true, maxLines: 2, color: p.inkDark }),
            txt(`📚 ${subj}`, { size: 'xxs', color: p.muted }),
          ],
        },
        // Priority pill
        badge(prio.label, prio.color, prio.soft),
      ],
    }
  })

  const extraCount = Math.max(0, tasks.length - 5)

  const body: FlexComponent[] = [
    // ── Header band ──
    ...headerBand('GOOD MORNING ☀️', 'แผนเล็กๆ ของวันนี้', p.yellow, p.yellowSoft),

    // Date + count pill row
    {
      type: 'box',
      layout: 'horizontal',
      paddingStart: 'xl',
      paddingEnd: 'xl',
      paddingBottom: 'md',
      alignItems: 'center',
      spacing: 'sm',
      contents: [
        txt(`📅 ${date}`, { size: 'xs', color: p.muted, flex: 1 }),
        badge(`${tasks.length} งาน`, p.yellow, p.yellowSoft),
      ],
    },

    sep(p.lineLight),

    // Column header
    {
      type: 'box',
      layout: 'horizontal',
      paddingStart: 'xl',
      paddingEnd: 'xl',
      paddingTop: 'md',
      paddingBottom: 'xs',
      contents: [
        txt('รายการวันนี้', { size: 'xs', weight: 'bold', color: p.muted }),
      ],
    },

    // Task rows
    { type: 'box', layout: 'vertical', spacing: 'none', contents: taskRows },
  ]

  if (extraCount > 0) {
    body.push({
      type: 'box',
      layout: 'horizontal',
      paddingAll: 'lg',
      paddingTop: 'sm',
      alignItems: 'center',
      spacing: 'sm',
      contents: [
        dot(p.muted),
        txt(`และอีก ${extraCount} งาน — ดูทั้งหมดได้ในรายการ`, { size: 'xs', color: p.muted }),
      ],
    })
  }

  // Motivational footer bar
  body.push(sep(p.lineLight))
  body.push({
    type: 'box',
    layout: 'horizontal',
    paddingAll: 'xl',
    paddingTop: 'md',
    paddingBottom: 'md',
    backgroundColor: p.yellowSoft,
    alignItems: 'center',
    spacing: 'sm',
    contents: [
      txt('✨', { size: 'sm' }),
      txt('เริ่มจากงานเล็กที่สุดก่อนก็ได้ คุณทำได้แน่นอน!', {
        size: 'xs', color: p.yellow, weight: 'bold', wrap: true, flex: 1,
      }),
    ],
  })

  return {
    type: 'flex',
    altText: `อรุณสวัสดิ์ วันนี้มีงาน ${tasks.length} รายการ`,
    contents: bubble(
      body,
      footerStrip(
        ctaBtn('ดูงานทั้งหมด', '/list',   p.peach),
        ctaBtn('เช็กสถานะ',   '/status', p.green),
      ),
    ),
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  TASK LIST CAROUSEL
// ════════════════════════════════════════════════════════════════════════════
export function createTasksFlex(tasks: Array<Record<string, unknown>>): LineFlexMessage {
  if (tasks.length === 0) {
    return {
      type: 'flex',
      altText: 'คุณไม่มีงานที่ค้างอยู่ในตอนนี้',
      contents: bubble(
        [
          ...headerBand('TO-DO', 'ไม่มีงานค้างแล้ว 🎉', p.green, p.greenSoft),
          {
            type: 'box',
            layout: 'vertical',
            paddingAll: 'xl',
            paddingTop: 'lg',
            contents: [
              {
                type: 'box',
                layout: 'horizontal',
                backgroundColor: p.greenSoft,
                cornerRadius: '14px',
                paddingAll: 'lg',
                borderWidth: '1px',
                borderColor: p.greenDeep,
                alignItems: 'center',
                spacing: 'md',
                contents: [
                  txt('🌿', { size: 'xxl' }),
                  {
                    type: 'box',
                    layout: 'vertical',
                    spacing: 'xs',
                    contents: [
                      txt('สะอาด!', { size: 'lg', weight: 'bold', color: p.green }),
                      txt('พักหายใจได้เลย หรือเพิ่มงานใหม่เมื่อพร้อมนะ', {
                        size: 'xs', color: p.muted, wrap: true,
                      }),
                    ],
                  },
                ],
              },
            ],
          },
        ],
        footerStrip(ctaBtn('เพิ่ม To-Do', '/todo ', p.green)),
      ),
    }
  }

  const cards = tasks.slice(0, 10).map((task) => {
    const prio    = priorityStyle(Number(task.priority))
    const title   = String(task.title   || 'รายการใหม่')
    const subj    = task.subject && task.subject !== 'General' ? String(task.subject) : 'ทั่วไป'
    const dueDate = task.due_date ? String(task.due_date) : 'ยังไม่กำหนด'

    return bubble(
      [
        ...headerBand('TO-DO', title, p.peach, p.peachSoft),

        // Subject + priority row
        {
          type: 'box',
          layout: 'horizontal',
          paddingStart: 'xl',
          paddingEnd: 'xl',
          paddingBottom: 'lg',
          alignItems: 'center',
          spacing: 'sm',
          contents: [
            txt(`📚 ${subj}`, { size: 'xs', color: p.muted, flex: 1 }),
            badge(prio.label, prio.color, prio.soft),
          ],
        },

        sep(p.lineLight),

        // Due date card
        {
          type: 'box',
          layout: 'vertical',
          paddingAll: 'xl',
          paddingTop: 'lg',
          paddingBottom: 'lg',
          contents: [
            {
              type: 'box',
              layout: 'horizontal',
              backgroundColor: p.cream,
              cornerRadius: '12px',
              paddingAll: 'md',
              borderWidth: '1px',
              borderColor: p.lineLight,
              alignItems: 'center',
              spacing: 'md',
              contents: [
                {
                  type: 'box',
                  layout: 'vertical',
                  width: '38px',
                  height: '38px',
                  cornerRadius: '10px',
                  backgroundColor: p.yellowSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                  contents: [txt('📅', { size: 'md', align: 'center' })],
                },
                {
                  type: 'box',
                  layout: 'vertical',
                  spacing: 'xs',
                  contents: [
                    txt('กำหนดส่ง', { size: 'xxs', color: p.muted }),
                    txt(dueDate, { size: 'sm', weight: 'bold', color: p.inkDark }),
                  ],
                },
              ],
            },
          ],
        },
      ],
      footerStrip(
        ctaBtn('✅ เสร็จแล้ว', `/done ${title}`, p.green),
        ghostBtn('ดูทั้งหมด', '/list'),
      ),
    )
  })

  return {
    type: 'flex',
    altText: `รายการ To-Do ของคุณ ${tasks.length} รายการ`,
    contents: { type: 'carousel', contents: cards },
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  EVENTS CAROUSEL
// ════════════════════════════════════════════════════════════════════════════
export function createEventsFlex(events: Array<Record<string, unknown>>): LineFlexMessage {
  if (events.length === 0) {
    return {
      type: 'flex',
      altText: 'ยังไม่มีวันสำคัญที่กำลังจะมาถึง',
      contents: bubble(
        [
          ...headerBand('CALENDAR', 'ยังไม่มีวันสำคัญ', p.purple, p.purpleSoft),
          {
            type: 'box',
            layout: 'vertical',
            paddingAll: 'xl',
            paddingTop: 'lg',
            contents: [
              {
                type: 'box',
                layout: 'horizontal',
                backgroundColor: p.purpleSoft,
                cornerRadius: '14px',
                paddingAll: 'lg',
                borderWidth: '1px',
                borderColor: p.purpleDeep,
                alignItems: 'center',
                spacing: 'md',
                contents: [
                  txt('🗓️', { size: 'xxl' }),
                  {
                    type: 'box',
                    layout: 'vertical',
                    spacing: 'xs',
                    contents: [
                      txt('ปฏิทินว่างอยู่', { size: 'lg', weight: 'bold', color: p.purple }),
                      txt('เพิ่มสอบ แข่งขัน หรือเดดไลน์สำคัญไว้ได้เลย', {
                        size: 'xs', color: p.muted, wrap: true,
                      }),
                    ],
                  },
                ],
              },
            ],
          },
        ],
        footerStrip(ctaBtn('เพิ่มวันสำคัญ', '/event ', p.purple)),
      ),
    }
  }

  const cards = events.slice(0, 10).map((event) => {
    const style = eventStyle(String(event.type || 'important'))
    const title = String(event.title      || 'วันสำคัญ')
    const date  = String(event.event_date || 'ยังไม่กำหนด')

    return bubble(
      [
        ...headerBand('CALENDAR', title, p.purple, p.purpleSoft),

        // Event type badge
        {
          type: 'box',
          layout: 'horizontal',
          paddingStart: 'xl',
          paddingEnd: 'xl',
          paddingBottom: 'lg',
          contents: [badge(style.label, style.color, style.soft)],
        },

        sep(p.lineLight),

        // Date hero card
        {
          type: 'box',
          layout: 'vertical',
          paddingAll: 'xl',
          paddingTop: 'lg',
          paddingBottom: 'lg',
          spacing: 'md',
          contents: [
            {
              type: 'box',
              layout: 'horizontal',
              backgroundColor: style.soft,
              cornerRadius: '16px',
              paddingAll: 'lg',
              borderWidth: '1px',
              borderColor: `${style.color}44`,
              alignItems: 'center',
              spacing: 'lg',
              contents: [
                // Icon block
                {
                  type: 'box',
                  layout: 'vertical',
                  width: '52px',
                  height: '52px',
                  cornerRadius: '14px',
                  backgroundColor: p.paper,
                  alignItems: 'center',
                  justifyContent: 'center',
                  contents: [txt('📅', { size: 'xl', align: 'center' })],
                },
                // Date + label
                {
                  type: 'box',
                  layout: 'vertical',
                  spacing: 'xs',
                  contents: [
                    txt(date,       { size: 'lg',  weight: 'bold', color: style.color }),
                    txt(style.label, { size: 'xxs', color: p.muted }),
                  ],
                },
              ],
            },
            // Optional notes
            ...(event.notes
              ? [{
                  type: 'box',
                  layout: 'horizontal',
                  backgroundColor: p.cream,
                  cornerRadius: '10px',
                  paddingAll: 'md',
                  spacing: 'sm',
                  contents: [
                    txt('📝', { size: 'xs' }),
                    txt(String(event.notes), { size: 'xs', color: p.muted, wrap: true, flex: 1 }),
                  ],
                }]
              : []),
          ],
        },
      ],
      footerStrip(
        ctaBtn('ดูวันอื่นๆ',     '/events', p.purple),
        ghostBtn('เพิ่มวันสำคัญ', '/event '),
      ),
    )
  })

  return {
    type: 'flex',
    altText: `วันสำคัญและนัดหมาย ${events.length} รายการ`,
    contents: { type: 'carousel', contents: cards },
  }
}
