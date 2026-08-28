import type { LineFlexMessage } from '@/lib/line'

// ─────────────────────────────────────────────────────────────────────────────
//  LINE Flex Message — Liquid Glass aesthetic
//
//  Design language:
//  • Zero emoji — ALL CAPS micro-labels only
//  • linearGradient hero = "glass" depth without images
//  • Frosted-panel illusion = pale tint bg + 1px white-ish border
//  • White "sheen" strip at top of gradient = liquid glass highlight
//  • Clean typographic hierarchy: xxs label → xl headline → xs body
//  • Muted, sophisticated palette (no saturated primaries)
//  • Maximum negative space
// ─────────────────────────────────────────────────────────────────────────────

// ── Palette ───────────────────────────────────────────────────────────────────
// Each accent has four stops: deep (text) → mid (border) → frost (bg panel) → shine (highlight strip)
const g = {
  // Neutrals
  void:     '#1A1210',     // deepest ink
  ink:      '#2E1F16',
  inkMid:   '#49362C',
  sub:      '#7A6860',
  ghost:    '#B0A098',
  paper:    '#FDFBF8',
  warm:     '#FAF6F0',
  frost:    '#F5EFE8',     // "frosted glass" base
  hairline: '#E8DFD6',
  white:    '#FFFFFF',

  // Rose — status busy / task
  rDeep:    '#8B2030',
  rMid:     '#C84050',
  rFrost:   '#FAF0F2',
  rShine:   '#FFE8EC',
  rBorder:  '#F0C8D0',

  // Sage — done / success
  sDeep:    '#1E5040',
  sMid:     '#3A7A5E',
  sFrost:   '#EFF7F2',
  sShine:   '#D8EFE4',
  sBorder:  '#B8DCCB',

  // Sky — index / info
  kDeep:    '#1A3858',
  kMid:     '#2E6090',
  kFrost:   '#EFF5FB',
  kShine:   '#D4E8F5',
  kBorder:  '#B8D4EA',

  // Iris — calendar / events
  iDeep:    '#3A2060',
  iMid:     '#6848A8',
  iFrost:   '#F2EFF8',
  iShine:   '#E0D8F2',
  iBorder:  '#C8BAE8',

  // Amber — morning / priority-2
  aDeep:    '#5C3A08',
  aMid:     '#A06820',
  aFrost:   '#FBF5E8',
  aShine:   '#F0E0B8',
  aBorder:  '#DEC898',
}

type Fc = Record<string, unknown>

// ── Primitives ────────────────────────────────────────────────────────────────

const t = (value: string, o: Fc = {}): Fc =>
  ({ type: 'text', text: value, color: g.inkMid, ...o })

const hr = (color = g.hairline): Fc =>
  ({ type: 'separator', color, margin: 'none' })

// Micro label — ALL CAPS, tiny, tracks well
const label = (text: string, color: string): Fc =>
  t(text.toUpperCase(), { size: 'xxs', color, weight: 'bold' })

// Slim pill — no emoji, caps text only
const chip = (text: string, textColor: string, bg: string, border: string): Fc => ({
  type: 'box', layout: 'vertical',
  backgroundColor: bg,
  cornerRadius: '4px',
  paddingTop: 'xs', paddingBottom: 'xs',
  paddingStart: 'md', paddingEnd: 'md',
  borderWidth: '1px', borderColor: border,
  contents: [label(text, textColor)],
})

// Square icon cell — no emoji, just a flat colored square with a letter/number
const iconCell = (content: string, size: string, textColor: string, bg: string, border: string): Fc => ({
  type: 'box', layout: 'vertical',
  width: size, height: size,
  cornerRadius: '8px',
  backgroundColor: bg,
  borderWidth: '1px', borderColor: border,
  alignItems: 'center', justifyContent: 'center',
  contents: [t(content, { size: 'sm', weight: 'bold', color: textColor, align: 'center' })],
})

// ── GLASS HERO BANNER ─────────────────────────────────────────────────────────
// Technique breakdown:
//   1. Box with linearGradient (deep → mid color)
//   2. Absolute white "sheen" strip at top → liquid-glass highlight
//   3. Absolute frosted panel in the middle → frosted glass content area
//   4. Text sits inside the frosted panel
const glassHero = (
  gradDeep: string,
  gradMid:  string,
  angle:    string,
  eyebrow:  string,
  headline: string,
  sub:      string,
  height = '140px',
): Fc => ({
  type: 'box', layout: 'vertical', height, paddingAll: 'none',
  background: {
    type: 'linearGradient',
    angle,
    startColor: gradDeep,
    endColor: gradMid,
  },
  contents: [
    // Relative base keeps absolute overlays valid and fills the fixed hero height.
    {
      type: 'box', layout: 'vertical', flex: 1, contents: [],
    },
    // White sheen strip — liquid glass highlight at the top
    {
      type: 'box', layout: 'vertical',
      position: 'absolute',
      offsetTop: '0px', offsetStart: '0px', offsetEnd: '0px',
      height: '2px',
      backgroundColor: '#FFFFFF70',
      contents: [],
    },
    // Frosted glass content panel
    {
      type: 'box', layout: 'vertical',
      position: 'absolute',
      offsetTop: '0px', offsetBottom: '0px',
      offsetStart: '0px', offsetEnd: '0px',
      paddingAll: 'xl', paddingBottom: 'xl',
      justifyContent: 'flex-end',
      contents: [
        // Eyebrow label
        {
          type: 'box', layout: 'horizontal',
          margin: 'sm',
          contents: [
            {
              type: 'box', layout: 'vertical',
              backgroundColor: '#FFFFFF22',
              cornerRadius: '3px',
              paddingTop: 'xs', paddingBottom: 'xs',
              paddingStart: 'sm', paddingEnd: 'sm',
              borderWidth: '1px', borderColor: '#FFFFFF40',
              contents: [t(eyebrow.toUpperCase(), { size: 'xxs', color: '#FFFFFFCC', weight: 'bold' })],
            },
            { type: 'box', layout: 'vertical', flex: 1, contents: [] },
          ],
        },
        // Headline
        t(headline, { size: 'xxl', weight: 'bold', color: '#FDFBF8', wrap: true }),
        // Sub
        t(sub, { size: 'xs', color: '#FFFFFFAA', wrap: true, margin: 'xs' }),
      ],
    },
  ],
})

// ── Glass panel (body section) ────────────────────────────────────────────────
// Frosted card inside white body — pale tinted bg + thin border = glass illusion
const glassPanel = (contents: Fc[], bg: string, border: string): Fc => ({
  type: 'box', layout: 'vertical',
  backgroundColor: bg,
  cornerRadius: '12px',
  paddingAll: 'xl',
  borderWidth: '1px', borderColor: border,
  contents,
})

// ── Ticker ────────────────────────────────────────────────────────────────────
const ticker = (text: string, bg: string, textColor: string): Fc => ({
  type: 'box', layout: 'horizontal',
  backgroundColor: bg,
  paddingTop: 'md', paddingBottom: 'md',
  paddingStart: 'xl', paddingEnd: 'xl',
  alignItems: 'center',
  contents: [
    { type: 'box', layout: 'vertical', width: '2px', height: '14px', backgroundColor: textColor, cornerRadius: '2px', contents: [] },
    t(text, { size: 'xs', color: textColor, weight: 'bold', wrap: true, flex: 1, margin: 'md' }),
  ],
})

// ── Buttons ───────────────────────────────────────────────────────────────────
const solidBtn = (label_: string, msg: string, bg: string): Fc => ({
  type: 'button', style: 'primary', height: 'sm', color: bg,
  action: { type: 'message', label: label_, text: msg },
})
const ghostBtn = (label_: string, msg: string): Fc => ({
  type: 'button', style: 'secondary', height: 'sm', color: g.hairline,
  action: { type: 'message', label: label_, text: msg },
})
const footerBar = (...btns: Fc[]): Fc => ({
  type: 'box', layout: 'horizontal', spacing: 'sm',
  paddingTop: 'lg', paddingBottom: 'xl',
  paddingStart: 'lg', paddingEnd: 'lg',
  backgroundColor: g.frost,
  contents: btns,
})

// ── Bubble shell ──────────────────────────────────────────────────────────────
const shell = (body: Fc[], footer?: Fc): Record<string, unknown> => ({
  type: 'bubble', size: 'mega',
  styles: {
    body:   { backgroundColor: g.paper },
    footer: { backgroundColor: g.frost, separator: true, separatorColor: g.hairline },
  },
  body: {
    type: 'box', layout: 'vertical', spacing: 'none', paddingAll: 'none',
    contents: body,
  },
  ...(footer ? { footer } : {}),
})

// ── Priority map ──────────────────────────────────────────────────────────────
function prioStyle(n: number | null | undefined) {
  if (n === 3) return { label: 'Urgent',  textColor: g.rDeep, bg: g.rFrost, border: g.rBorder, accent: g.rMid  }
  if (n === 2) return { label: 'Normal',  textColor: g.aDeep, bg: g.aFrost, border: g.aBorder, accent: g.aMid  }
  return              { label: 'Low',     textColor: g.sDeep, bg: g.sFrost, border: g.sBorder, accent: g.sMid  }
}

function evStyle(type: string | undefined) {
  if (type === 'exam')        return { label: 'Exam',        textColor: g.rDeep, bg: g.rFrost, border: g.rBorder, accent: g.rMid  }
  if (type === 'competition') return { label: 'Competition', textColor: g.aDeep, bg: g.aFrost, border: g.aBorder, accent: g.aMid  }
  if (type === 'project')     return { label: 'Project',     textColor: g.kDeep, bg: g.kFrost, border: g.kBorder, accent: g.kMid  }
  return                              { label: 'Important',  textColor: g.iDeep, bg: g.iFrost, border: g.iBorder, accent: g.iMid  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  STATUS CARD
// ═════════════════════════════════════════════════════════════════════════════
export function createStatusFlex(count: number | null): LineFlexMessage {
  const n    = Math.max(0, count ?? 0)
  const busy = n > 0

  const heroDeep  = busy ? '#6B1520' : '#1A4030'
  const heroMid   = busy ? '#C84050' : '#2E7A58'
  const panelBg   = busy ? g.rFrost  : g.sFrost
  const panelBdr  = busy ? g.rBorder : g.sBorder
  const numColor  = busy ? g.rMid    : g.sMid

  return {
    type: 'flex',
    altText: `Study Manager · ${busy ? `งานค้าง ${n} รายการ` : 'ไม่มีงานค้าง'}`,
    contents: shell(
      [
        glassHero(
          heroDeep, heroMid, '145deg',
          'Study Manager.koko · Status',
          busy ? `${n} รายการรออยู่` : 'เสร็จทั้งหมดแล้ว',
          busy ? 'ค่อยๆ ทำทีละอย่าง' : 'วันนี้ดีมาก',
        ),

        {
          type: 'box', layout: 'vertical',
          paddingAll: 'xl', paddingTop: 'lg', paddingBottom: 'none',
          contents: [
            glassPanel(
              [
                {
                  type: 'box', layout: 'horizontal', alignItems: 'center',
                  contents: [
                    { type: 'box', layout: 'vertical', flex: 1, spacing: 'xs', contents: [
                      label(busy ? 'Pending tasks' : 'All clear', busy ? g.rDeep : g.sDeep),
                      t(busy ? 'อย่าลืมพักด้วยนะ' : 'วันนี้เก่งมาก', { size: 'xs', color: g.sub, margin: 'xs' }),
                    ]},
                    t(String(n), { size: '5xl', weight: 'bold', color: numColor }),
                  ],
                },
              ],
              panelBg, panelBdr,
            ),
          ],
        },

        { type: 'box', layout: 'vertical', height: '16px', contents: [] },
        hr(),
        ticker(
          busy ? 'พร้อมช่วยจัดการแผนวันนี้เสมอ' : 'ถ้ามีงานใหม่บอกได้เลย',
          panelBg, numColor,
        ),
      ],
      footerBar(
        solidBtn(busy ? 'ดูรายการทั้งหมด' : 'เพิ่มงานใหม่', busy ? '/list' : '/todo ', busy ? g.rMid : g.sMid),
        solidBtn('วันสำคัญ', '/events', g.iMid),
      ),
    ),
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  MORNING REMINDER
// ═════════════════════════════════════════════════════════════════════════════
export function createMorningReminderFlex(
  tasks: Array<Record<string, unknown>>,
  date: string,
): LineFlexMessage {

  const rows: Fc[] = tasks.slice(0, 5).map((task, i) => {
    const pr    = prioStyle(Number(task.priority))
    const title = String(task.title  || 'รายการใหม่')
    const subj  = task.subject && task.subject !== 'General' ? String(task.subject) : 'General'

    return {
      type: 'box', layout: 'horizontal', spacing: 'lg',
      paddingTop: 'md', paddingBottom: 'md',
      paddingStart: 'xl', paddingEnd: 'xl',
      backgroundColor: i % 2 === 0 ? g.warm : g.paper,
      alignItems: 'center',
      contents: [
        // Number cell — no emoji, just the number
        iconCell(`${i + 1}`, '28px', g.kMid, g.kFrost, g.kBorder),
        // Info
        { type: 'box', layout: 'vertical', flex: 1, spacing: 'xs', contents: [
          t(title, { size: 'sm', weight: 'bold', wrap: true, maxLines: 2, color: g.ink }),
          t(subj,  { size: 'xxs', color: g.ghost }),
        ]},
        chip(pr.label, pr.textColor, pr.bg, pr.border),
      ],
    }
  })

  const extra = Math.max(0, tasks.length - 5)

  const body: Fc[] = [
    glassHero(
      g.aDeep, g.aMid, '150deg',
      'Study Manager.koko · Morning',
      'แผนวันนี้',
      `${date} · ${tasks.length} รายการรออยู่`,
    ),

    // Count row
    {
      type: 'box', layout: 'horizontal',
      paddingStart: 'xl', paddingEnd: 'xl',
      paddingTop: 'lg', paddingBottom: 'md',
      alignItems: 'center',
      contents: [
        t('รายการวันนี้', { size: 'xs', weight: 'bold', color: g.sub, flex: 1 }),
        chip(`${tasks.length} Tasks`, g.aDeep, g.aFrost, g.aBorder),
      ],
    },

    hr(),

    { type: 'box', layout: 'vertical', spacing: 'none', contents: rows },
  ]

  if (extra > 0) {
    body.push({
      type: 'box', layout: 'horizontal',
      paddingAll: 'lg', alignItems: 'center',
      contents: [
        { type: 'box', layout: 'vertical', width: '2px', height: '14px', backgroundColor: g.ghost, cornerRadius: '2px', contents: [] },
        t(`+${extra} รายการ`, { size: 'xs', color: g.ghost, margin: 'md' }),
      ],
    })
  }

  body.push(hr())
  body.push(ticker('เริ่มจากงานเล็กที่สุดก่อนก็ได้', g.aFrost, g.aMid))

  return {
    type: 'flex',
    altText: `Good Morning · วันนี้มีงาน ${tasks.length} รายการ`,
    contents: shell(
      body,
      footerBar(
        solidBtn('ดูรายการ', '/list',   g.rMid),
        solidBtn('สถานะ',    '/status', g.sMid),
      ),
    ),
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  TASK LIST CAROUSEL
// ═════════════════════════════════════════════════════════════════════════════
export function createTasksFlex(tasks: Array<Record<string, unknown>>): LineFlexMessage {
  if (tasks.length === 0) {
    return {
      type: 'flex',
      altText: 'ไม่มีงานค้างแล้ว',
      contents: shell(
        [
          glassHero(g.sDeep, g.sMid, '140deg', 'Study Manager.koko · To-Do', 'ไม่มีงานค้างแล้ว', 'พักหายใจได้เลย'),
          {
            type: 'box', layout: 'vertical', paddingAll: 'xl', paddingTop: 'lg',
            contents: [
              glassPanel([
                t('สะอาด', { size: 'xl', weight: 'bold', color: g.sMid }),
                t('พักหายใจได้เลย หรือเพิ่มงานใหม่เมื่อพร้อม', { size: 'xs', color: g.sub, wrap: true, margin: 'sm' }),
              ], g.sFrost, g.sBorder),
            ],
          },
        ],
        footerBar(solidBtn('เพิ่มงานใหม่', '/todo ', g.sMid)),
      ),
    }
  }

  const cards = tasks.slice(0, 10).map((task) => {
    const pr    = prioStyle(Number(task.priority))
    const title = String(task.title  || 'รายการใหม่')
    const subj  = task.subject && task.subject !== 'General' ? String(task.subject) : 'General'
    const due   = task.due_date ? String(task.due_date) : 'No deadline'

    return shell(
      [
        glassHero(g.rDeep, g.rMid, '145deg', 'Study Manager.koko · To-Do', title, subj, '110px'),

        {
          type: 'box', layout: 'vertical',
          paddingAll: 'xl', paddingTop: 'lg', paddingBottom: 'none', spacing: 'md',
          contents: [
            // Priority row
            {
              type: 'box', layout: 'horizontal', alignItems: 'center', spacing: 'sm',
              contents: [
                label('Priority', g.ghost),
                { type: 'box', layout: 'vertical', flex: 1, contents: [] },
                chip(pr.label, pr.textColor, pr.bg, pr.border),
              ],
            },
            // Due date panel — glass look
            glassPanel(
              [
                {
                  type: 'box', layout: 'horizontal', alignItems: 'center',
                  contents: [
                    { type: 'box', layout: 'vertical', spacing: 'xs', flex: 1, contents: [
                      label('Due Date', g.ghost),
                      t(due, { size: 'md', weight: 'bold', color: g.ink, margin: 'xs' }),
                    ]},
                    // Right accent bar — no emoji, just a thin vertical line
                    { type: 'box', layout: 'vertical',
                      width: '3px', height: '36px',
                      backgroundColor: g.rBorder,
                      cornerRadius: '3px',
                      contents: [],
                    },
                  ],
                },
              ],
              g.rFrost, g.rBorder,
            ),
          ],
        },

        { type: 'box', layout: 'vertical', height: '16px', contents: [] },
        hr(),
        ticker('กดปุ่มด้านล่างเมื่อทำเสร็จแล้ว', g.rFrost, g.rMid),
      ],
      footerBar(
        solidBtn('Mark as Done', `/done ${title}`, g.sMid),
        ghostBtn('ดูทั้งหมด', '/list'),
      ),
    )
  })

  return {
    type: 'flex',
    altText: `To-Do · ${tasks.length} รายการ`,
    contents: { type: 'carousel', contents: cards },
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  EVENTS CAROUSEL
// ═════════════════════════════════════════════════════════════════════════════
export function createEventsFlex(events: Array<Record<string, unknown>>): LineFlexMessage {
  if (events.length === 0) {
    return {
      type: 'flex',
      altText: 'ยังไม่มีวันสำคัญ',
      contents: shell(
        [
          glassHero(g.iDeep, g.iMid, '145deg', 'Study Manager.koko · Calendar', 'ยังไม่มีวันสำคัญ', 'เพิ่มสอบ แข่งขัน หรือ Deadline'),
          {
            type: 'box', layout: 'vertical', paddingAll: 'xl', paddingTop: 'lg',
            contents: [
              glassPanel([
                t('ปฏิทินว่างอยู่', { size: 'xl', weight: 'bold', color: g.iMid }),
                t('เพิ่มนัดหมายสำคัญได้เลย', { size: 'xs', color: g.sub, wrap: true, margin: 'sm' }),
              ], g.iFrost, g.iBorder),
            ],
          },
        ],
        footerBar(solidBtn('เพิ่มวันสำคัญ', '/event ', g.iMid)),
      ),
    }
  }

  const cards = events.slice(0, 10).map((event) => {
    const ev    = evStyle(String(event.type || 'important'))
    const title = String(event.title      || 'วันสำคัญ')
    const date  = String(event.event_date || 'TBD')

    return shell(
      [
        glassHero(g.iDeep, g.iMid, '145deg', 'Study Manager.koko · Calendar', title, date, '120px'),

        {
          type: 'box', layout: 'vertical',
          paddingAll: 'xl', paddingTop: 'lg', paddingBottom: 'none', spacing: 'md',
          contents: [
            // Type chip row
            {
              type: 'box', layout: 'horizontal', alignItems: 'center',
              contents: [
                label('Type', g.ghost),
                { type: 'box', layout: 'vertical', flex: 1, contents: [] },
                chip(ev.label, ev.textColor, ev.bg, ev.border),
              ],
            },
            // Date panel — glass
            glassPanel(
              [
                {
                  type: 'box', layout: 'horizontal', alignItems: 'center',
                  contents: [
                    { type: 'box', layout: 'vertical', flex: 1, spacing: 'xs', contents: [
                      label('Date', g.ghost),
                      t(date, { size: 'lg', weight: 'bold', color: g.ink, margin: 'xs' }),
                    ]},
                    { type: 'box', layout: 'vertical',
                      width: '3px', height: '36px',
                      backgroundColor: g.iBorder,
                      cornerRadius: '3px',
                      contents: [],
                    },
                  ],
                },
                ...(event.notes ? [
                  hr(g.iBorder),
                  { type: 'box', layout: 'vertical', paddingTop: 'md', contents: [
                    label('Notes', g.ghost),
                    t(String(event.notes), { size: 'xs', color: g.sub, wrap: true, margin: 'xs' }),
                  ]},
                ] : []),
              ],
              g.iFrost, g.iBorder,
            ),
          ],
        },

        { type: 'box', layout: 'vertical', height: '16px', contents: [] },
        hr(),
        ticker('เตรียมตัวให้พร้อม เวลาผ่านเร็วกว่าที่คิด', g.iFrost, g.iMid),
      ],
      footerBar(
        solidBtn('ดูทั้งหมด',      '/events', g.iMid),
        ghostBtn('เพิ่มวันสำคัญ', '/event '),
      ),
    )
  })

  return {
    type: 'flex',
    altText: `Calendar · ${events.length} รายการ`,
    contents: { type: 'carousel', contents: cards },
  }
}
