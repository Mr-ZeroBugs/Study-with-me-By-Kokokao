import type { LineFlexMessage } from '@/lib/line'

// ─────────────────────────────────────────────────────────────────────────────
// Study Manager.koko · LINE Flex design system
//
// The cards intentionally use a small set of reusable primitives:
//  • one clear hero with Koko as the visual anchor
//  • one compact summary row
//  • short, scannable content rows
//  • one primary action and one secondary action
//
// Keeping the layout predictable matters on LINE because the same Flex JSON
// can wrap differently across devices and font settings.
// ─────────────────────────────────────────────────────────────────────────────

const g = {
  ink: '#2E1F16',
  inkMid: '#49362C',
  sub: '#7A6860',
  ghost: '#A99B94',
  paper: '#FDFBF8',
  warm: '#FAF6F0',
  frost: '#F5EFE8',
  hairline: '#E8DFD6',
  white: '#FFFFFF',

  roseDeep: '#8B2030',
  rose: '#C84050',
  roseFrost: '#FAF0F2',
  roseBorder: '#F0C8D0',

  sageDeep: '#1E5040',
  sage: '#3A7A5E',
  sageFrost: '#EFF7F2',
  sageBorder: '#B8DCCB',

  skyDeep: '#1A3858',
  sky: '#2E6090',
  skyFrost: '#EFF5FB',
  skyBorder: '#B8D4EA',

  irisDeep: '#3A2060',
  iris: '#6848A8',
  irisFrost: '#F2EFF8',
  irisBorder: '#C8BAE8',

  amberDeep: '#5C3A08',
  amber: '#A06820',
  amberFrost: '#FBF5E8',
  amberBorder: '#DEC898',

  // Bright sticker-card accents. Keep the ink constant so every card feels
  // like one illustrated product instead of a collection of soft dashboards.
  sun: '#F6C744',
  coral: '#F08A86',
  mint: '#9FD8AF',
  skyBright: '#A8C9EC',
  violetBright: '#C8B6E5',
}

type Fc = Record<string, unknown>
type KokoMood = 'alert' | 'sleep' | 'study' | 'love' | 'happy' | 'angry' | 'sad' | 'peek' | 'cozy' | 'low-battery' | 'laptop'

// Keep LINE image URLs public and HTTPS even when the app is running locally.
const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL || ''
const kokoBaseUrl = /^https:\/\//i.test(configuredAppUrl)
  ? configuredAppUrl.replace(/\/$/, '')
  : 'https://study-with-me-by-kokokao.vercel.app'

const kokoImage = (mood: KokoMood, size = 'xxl'): Fc => ({
  type: 'image',
  url: kokoBaseUrl + '/mascots/koko/koko-' + mood + '.png',
  size,
  aspectRatio: '1:1',
  aspectMode: 'fit',
})

const compact = (value: unknown, fallback = ''): string =>
  String(value ?? fallback).replace(/\s+/g, ' ').trim()

const compactMinutes = (minutes: number): string => {
  if (minutes <= 0) return '—'
  if (minutes < 60) return minutes + ' min'
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder > 0 ? hours + 'h ' + remainder + 'm' : hours + ' hrs'
}

const t = (value: string, options: Fc = {}): Fc => ({
  type: 'text',
  text: value,
  color: g.inkMid,
  ...options,
})

const label = (value: string, color: string): Fc =>
  t(value.toUpperCase(), {
    size: 'xxs',
    color,
    weight: 'bold',
    wrap: true,
    maxLines: 1,
    adjustMode: 'shrink-to-fit',
  })

const hr = (color = g.hairline): Fc => ({
  type: 'separator',
  color,
  margin: 'none',
})

const chip = (value: string, color: string, backgroundColor: string, borderColor: string): Fc => ({
  type: 'box',
  layout: 'vertical',
  backgroundColor,
  cornerRadius: '8px',
  paddingTop: 'xs',
  paddingBottom: 'xs',
  paddingStart: 'sm',
  paddingEnd: 'sm',
  borderWidth: '2px',
  borderColor,
  contents: [label(value, color)],
})

const iconCell = (value: string, size: string, color: string, backgroundColor: string, borderColor: string): Fc => ({
  type: 'box',
  layout: 'vertical',
  width: size,
  height: size,
  cornerRadius: '9px',
  backgroundColor,
  borderWidth: '2px',
  borderColor,
  alignItems: 'center',
  justifyContent: 'center',
  contents: [t(value, { size: 'sm', weight: 'bold', color, align: 'center' })],
})

const metricTile = (value: string, caption: string, color: string, backgroundColor: string, borderColor: string): Fc => ({
  type: 'box',
  layout: 'vertical',
  flex: 1,
  height: '84px',
  backgroundColor: g.white,
  cornerRadius: '10px',
  borderWidth: '2px',
  borderColor: g.ink,
  paddingTop: 'md',
  paddingBottom: 'md',
  paddingStart: 'sm',
  paddingEnd: 'sm',
  alignItems: 'center',
  justifyContent: 'center',
  contents: [
    t(value, { size: 'lg', weight: 'bold', color, align: 'center', maxLines: 1, adjustMode: 'shrink-to-fit' }),
    t(caption, { size: 'xxs', color: g.inkMid, align: 'center', margin: 'xs', wrap: true, maxLines: 2, adjustMode: 'shrink-to-fit' }),
  ],
})

const metricStrip = (tiles: Fc[]): Fc => ({
  type: 'box',
  layout: 'horizontal',
  spacing: 'sm',
  paddingTop: 'lg',
  paddingBottom: 'lg',
  paddingStart: 'xl',
  paddingEnd: 'xl',
  contents: tiles,
})

const panel = (contents: Fc[], backgroundColor: string, borderColor: string): Fc => ({
  type: 'box',
  layout: 'vertical',
  backgroundColor: g.white,
  cornerRadius: '14px',
  borderWidth: '2px',
  borderColor: g.ink,
  paddingAll: 'lg',
  contents,
})

const ticker = (message: string, backgroundColor: string, color: string): Fc => ({
  type: 'box',
  layout: 'horizontal',
  backgroundColor,
  paddingTop: 'md',
  paddingBottom: 'md',
  paddingStart: 'xl',
  paddingEnd: 'xl',
  alignItems: 'center',
  contents: [
    { type: 'box', layout: 'vertical', width: '3px', height: '16px', backgroundColor: color, cornerRadius: '3px', contents: [] },
    t(message, { size: 'xs', color, weight: 'bold', wrap: true, flex: 1, margin: 'md' }),
  ],
})

const messageButton = (buttonLabel: string, text: string, backgroundColor: string, style: 'primary' | 'secondary' = 'primary'): Fc => ({
  type: 'button',
  style,
  height: 'md',
  flex: 1,
  color: backgroundColor,
  action: { type: 'message', label: buttonLabel, text },
})

const doneButton = (task: Record<string, unknown>): Fc => {
  const title = compact(task.title, 'รายการใหม่')
  const action = task.id
    ? {
        type: 'postback',
        label: 'เสร็จ',
        data: 'action=complete_task&taskId=' + encodeURIComponent(String(task.id)),
        displayText: 'ทำเสร็จแล้ว: ' + title,
      }
    : { type: 'message', label: 'เสร็จ', text: '/done ' + title }

  return {
    type: 'button',
    style: 'secondary',
    height: 'sm',
    color: g.mint,
    action,
  }
}

const sharedTaskNotice = (): Fc =>
  t('งานทีม', { size: 'xxs', color: g.iris, wrap: true, maxLines: 1, align: 'center', adjustMode: 'shrink-to-fit' })

const footerBar = (...buttons: Fc[]): Fc => ({
  type: 'box',
  layout: 'horizontal',
  spacing: 'sm',
  paddingTop: 'lg',
  paddingBottom: 'xl',
  paddingStart: 'lg',
  paddingEnd: 'lg',
  backgroundColor: g.white,
  borderWidth: '2px',
  borderColor: g.ink,
  alignItems: 'center',
  contents: buttons,
})

const shell = (body: Fc[], footer?: Fc): Record<string, unknown> => ({
  type: 'bubble',
  size: 'mega',
  styles: {
    body: { backgroundColor: g.paper },
    footer: { backgroundColor: g.white, separator: true, separatorColor: g.ink },
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

const brandHero = (
  backgroundColor: string,
  borderColor: string,
  mood: KokoMood,
  eyebrow: string,
  headline: string,
  subheadline: string,
  height = '170px',
): Fc => ({
  type: 'box',
  layout: 'vertical',
  height,
  paddingTop: 'lg',
  paddingStart: 'lg',
  paddingEnd: 'lg',
  paddingBottom: 'none',
  backgroundColor,
  borderWidth: '2px',
  borderColor: g.ink,
  cornerRadius: '16px',
  contents: [
    {
      type: 'box',
      layout: 'horizontal',
      flex: 1,
      alignItems: 'center',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          flex: 1,
          spacing: 'xs',
          contents: [
            { type: 'box', layout: 'horizontal', contents: [chip(eyebrow, g.ink, g.white, g.ink)] },
            t(headline, { size: 'xxl', weight: 'bold', color: g.ink, wrap: true, maxLines: 2, margin: 'sm' }),
            t(subheadline, { size: 'xs', color: g.inkMid, wrap: true, maxLines: 2 }),
          ],
        },
        {
          type: 'box',
          layout: 'vertical',
          width: '116px',
          height: '116px',
          alignItems: 'center',
          justifyContent: 'center',
          contents: [kokoImage(mood, 'xxl')],
        },
      ],
    },
    {
      type: 'box',
      layout: 'horizontal',
      height: '7px',
      backgroundColor: borderColor,
      cornerRadius: '4px',
      contents: [],
    },
  ],
})

function prioStyle(priority: number | null | undefined) {
  if (priority === 3) return { label: 'Urgent', color: g.roseDeep, backgroundColor: g.roseFrost, borderColor: g.roseBorder, accent: g.rose }
  if (priority === 2) return { label: 'Normal', color: g.amberDeep, backgroundColor: g.amberFrost, borderColor: g.amberBorder, accent: g.amber }
  return { label: 'Low', color: g.sageDeep, backgroundColor: g.sageFrost, borderColor: g.sageBorder, accent: g.sage }
}

function eventStyle(type: string | undefined) {
  if (type === 'exam') return { label: 'Exam', color: g.roseDeep, backgroundColor: g.roseFrost, borderColor: g.roseBorder, accent: g.rose, mood: 'alert' as KokoMood }
  if (type === 'competition') return { label: 'Competition', color: g.amberDeep, backgroundColor: g.amberFrost, borderColor: g.amberBorder, accent: g.amber, mood: 'happy' as KokoMood }
  if (type === 'project') return { label: 'Project', color: g.skyDeep, backgroundColor: g.skyFrost, borderColor: g.skyBorder, accent: g.sky, mood: 'study' as KokoMood }
  return { label: 'Important', color: g.irisDeep, backgroundColor: g.irisFrost, borderColor: g.irisBorder, accent: g.iris, mood: 'love' as KokoMood }
}

function dateParts(value: string) {
  const parts = value.split('-')
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const monthIndex = Number(parts[1]) - 1
  return {
    day: parts[2] || '--',
    month: monthNames[monthIndex] || 'DATE',
  }
}

function taskRow(task: Record<string, unknown>, index: number): Fc {
  const priority = prioStyle(Number(task.priority))
  const title = compact(task.title, 'รายการใหม่')
  const subject = compact(task.subject, 'General')
  const dueDate = compact(task.due_date, 'No deadline')
  const meta = [subject !== 'General' ? subject : '', dueDate].filter(Boolean).join(' · ')
  const isShared = Boolean(task.workspace_id)
  const workspaceName = isShared ? compact(task.workspace_name, 'Team Space') : ''

  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    paddingAll: 'md',
    backgroundColor: index % 2 === 0 ? g.warm : g.paper,
    cornerRadius: '10px',
    alignItems: 'center',
    contents: [
      iconCell(String(index + 1), '28px', g.skyDeep, g.skyFrost, g.skyBorder),
      {
        type: 'box',
        layout: 'vertical',
        flex: 1,
        spacing: 'xs',
        contents: [
          t(title, { size: 'sm', weight: 'bold', color: g.ink, wrap: true, maxLines: 2 }),
          t(meta || 'No deadline', { size: 'xxs', color: g.ghost, wrap: true, maxLines: 1 }),
          ...(workspaceName ? [t('from: ' + workspaceName, { size: 'xxs', color: g.iris, weight: 'bold', wrap: true, maxLines: 1, adjustMode: 'shrink-to-fit' })] : []),
        ],
      },
      {
        type: 'box',
        layout: 'vertical',
        width: '76px',
        spacing: 'xs',
        alignItems: 'center',
        contents: [
          chip(priority.label, priority.color, priority.backgroundColor, priority.borderColor),
          isShared ? sharedTaskNotice() : doneButton(task),
        ],
      },
    ],
  }
}

function eventRow(event: Record<string, unknown>, index: number): Fc {
  const style = eventStyle(compact(event.type, 'important'))
  const title = compact(event.title, 'วันสำคัญ')
  const date = compact(event.event_date, 'TBD')
  const parts = dateParts(date)
  const notes = compact(event.notes)
  const workspaceName = event.workspace_id ? compact(event.workspace_name, 'Team Space') : ''

  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'md',
    paddingTop: 'md',
    paddingBottom: 'md',
    backgroundColor: index % 2 === 0 ? g.warm : g.paper,
    cornerRadius: '10px',
    alignItems: 'center',
    contents: [
      {
        type: 'box',
        layout: 'vertical',
        width: '48px',
        height: '48px',
        cornerRadius: '12px',
        backgroundColor: style.backgroundColor,
        borderWidth: '1px',
        borderColor: style.borderColor,
        alignItems: 'center',
        justifyContent: 'center',
        contents: [
          t(parts.day, { size: 'lg', weight: 'bold', color: style.color, align: 'center' }),
          t(parts.month, { size: 'xxs', weight: 'bold', color: style.color, align: 'center', margin: 'none' }),
        ],
      },
      {
        type: 'box',
        layout: 'vertical',
        flex: 1,
        spacing: 'xs',
        contents: [
          t(title, { size: 'sm', weight: 'bold', color: g.ink, wrap: true, maxLines: 2 }),
          t(notes || date, { size: 'xxs', color: g.ghost, wrap: true, maxLines: 1 }),
          ...(workspaceName ? [t('from: ' + workspaceName, { size: 'xxs', color: g.iris, weight: 'bold', wrap: true, maxLines: 1, adjustMode: 'shrink-to-fit' })] : []),
        ],
      },
      chip(style.label, style.color, style.backgroundColor, style.borderColor),
    ],
  }
}

function extraRow(count: number, color: string): Fc {
  return {
    type: 'box',
    layout: 'horizontal',
    paddingTop: 'md',
    paddingBottom: 'xs',
    alignItems: 'center',
    contents: [
      { type: 'box', layout: 'vertical', width: '3px', height: '14px', backgroundColor: color, cornerRadius: '3px', contents: [] },
      t('+' + count + ' รายการเพิ่มเติม', { size: 'xxs', color: g.ghost, margin: 'md' }),
    ],
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// STATUS
// ═════════════════════════════════════════════════════════════════════════════
export function createStatusFlex(count: number | null): LineFlexMessage {
  const pending = Math.max(0, count ?? 0)
  const clear = pending === 0

  return {
    type: 'flex',
    altText: 'Study Manager.koko · ' + (clear ? 'ไม่มีงานค้าง' : 'มีงานค้าง ' + pending + ' รายการ'),
    contents: shell(
      [
        brandHero(
          clear ? g.mint : g.coral,
          g.ink,
          clear ? 'happy' : 'alert',
          'Koko Status',
          clear ? 'วันนี้เคลียร์หมดแล้ว' : pending + ' งานรออยู่',
          clear ? 'พักได้อย่างสบายใจเลย' : 'เริ่มจากงานที่ใกล้ที่สุดก่อน',
        ),
        metricStrip([
          metricTile(String(pending), 'งานที่ยังไม่เสร็จ', clear ? g.sageDeep : g.roseDeep, clear ? g.mint : g.coral, g.ink),
          metricTile(clear ? 'พักได้' : 'เริ่ม 1 งาน', 'คำแนะนำตอนนี้', g.skyDeep, g.skyFrost, g.skyBorder),
        ]),
        {
          type: 'box',
          layout: 'vertical',
          paddingStart: 'xl',
          paddingEnd: 'xl',
          paddingBottom: 'lg',
          contents: [
            panel(
              [
                label(clear ? 'All clear' : 'Small next step', clear ? g.sageDeep : g.roseDeep),
                t(clear ? 'ถ้ามีแผนใหม่ บอก Koko ได้เลย' : 'ทำทีละงาน แล้วอย่าลืมพักด้วยนะ', { size: 'sm', color: g.sub, wrap: true, margin: 'sm' }),
              ],
              clear ? g.mint : g.coral,
              g.ink,
            ),
          ],
        },
        hr(),
        ticker(clear ? 'เก็บ momentum แบบสบายๆ ต่อได้เลย' : 'Koko ช่วยจัดลำดับให้แล้ว', clear ? g.sageFrost : g.roseFrost, clear ? g.sage : g.rose),
      ],
      footerBar(
        messageButton(clear ? 'เพิ่มงานใหม่' : 'ดูรายการงาน', clear ? '/todo ' : '/list', clear ? g.sage : g.rose),
        messageButton('วันสำคัญ', '/events', g.iris),
      ),
    ),
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// TASK COMPLETED
// ═════════════════════════════════════════════════════════════════════════════
export function createTaskDoneFlex(title: string): LineFlexMessage {
  const taskTitle = compact(title, 'รายการใหม่')

  return {
    type: 'flex',
    altText: 'ทำงานเสร็จแล้ว: ' + taskTitle,
    contents: shell(
      [
        brandHero(g.mint, g.ink, 'happy', 'Koko Win', 'ทำเสร็จแล้ว', taskTitle),
        metricStrip([
          metricTile('สำเร็จ', 'สถานะงาน', g.sageDeep, g.mint, g.ink),
          metricTile('+1', 'งานที่เคลียร์', g.amberDeep, g.sun, g.ink),
        ]),
        {
          type: 'box',
          layout: 'vertical',
          paddingStart: 'xl',
          paddingEnd: 'xl',
          paddingBottom: 'lg',
          contents: [
            panel(
              [t('ก้าวเล็กๆ แบบนี้รวมกันเป็น progress ใหญ่ได้จริง', { size: 'sm', color: g.sub, wrap: true })],
              g.mint,
              g.ink,
            ),
          ],
        },
      ],
      footerBar(
        messageButton('ดูงานที่เหลือ', '/list', g.sage),
        messageButton('เช็กสถานะ', '/status', g.sky),
      ),
    ),
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// MORNING REMINDER
// ═════════════════════════════════════════════════════════════════════════════
export function createMorningReminderFlex(tasks: Array<Record<string, unknown>>, date: string): LineFlexMessage {
  const visible = tasks.slice(0, 5)
  const urgentCount = tasks.filter((task) => Number(task.priority) === 3).length
  const estimatedMinutes = tasks.reduce((total, task) => total + Math.max(0, Number(task.estimated_minutes) || 0), 0)
  const rows = visible.map((task, index) => taskRow(task, index))
  const body: Fc[] = [
    brandHero(g.sun, g.ink, 'study', 'Good Morning', 'แผนวันนี้', date + ' · ' + tasks.length + ' งานรออยู่'),
    metricStrip([
      metricTile(String(tasks.length), 'งานวันนี้', g.amberDeep, g.sun, g.ink),
      metricTile(String(urgentCount), 'งานด่วน', g.roseDeep, g.coral, g.ink),
      metricTile(compactMinutes(estimatedMinutes), 'เวลาที่ตั้งไว้รวม', g.skyDeep, g.skyBright, g.ink),
    ]),
    {
      type: 'box',
      layout: 'vertical',
      paddingStart: 'xl',
      paddingEnd: 'xl',
      contents: [
        label('งานของวันนี้', g.sub),
        { type: 'box', layout: 'vertical', spacing: 'xs', margin: 'md', contents: rows },
      ],
    },
  ]

  if (tasks.length > visible.length) body.push(extraRow(tasks.length - visible.length, g.amber))
  body.push(hr())
  body.push(ticker('เริ่มจากงานเล็กที่สุดก่อนก็ได้', g.sun, g.ink))

  return {
    type: 'flex',
    altText: 'Good Morning · วันนี้มีงาน ' + tasks.length + ' รายการ',
    contents: shell(
      body,
      footerBar(
        messageButton('ดูรายการ', '/list', g.rose),
        messageButton('เช็กสถานะ', '/status', g.sage),
      ),
    ),
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// TASK SUMMARY
// ═════════════════════════════════════════════════════════════════════════════
export function createTasksFlex(tasks: Array<Record<string, unknown>>): LineFlexMessage {
  if (tasks.length === 0) {
    return {
      type: 'flex',
      altText: 'ไม่มีงานค้างแล้ว',
      contents: shell(
        [
          brandHero(g.mint, g.ink, 'cozy', 'Koko To-Do', 'ไม่มีงานค้างแล้ว', 'พักหายใจได้เลย หรือเริ่มแผนใหม่เมื่อพร้อม'),
          metricStrip([
            metricTile('0', 'งานที่ยังไม่เสร็จ', g.sageDeep, g.mint, g.ink),
            metricTile('ครบ', 'สถานะรายการ', g.skyDeep, g.skyBright, g.ink),
          ]),
          {
            type: 'box',
            layout: 'vertical',
            paddingStart: 'xl',
            paddingEnd: 'xl',
            paddingBottom: 'lg',
            contents: [
              panel(
                [t('หน้า inbox สะอาดแล้ว เก่งมากครับ', { size: 'sm', color: g.sub, wrap: true })],
                g.mint,
                g.ink,
              ),
            ],
          },
        ],
        footerBar(messageButton('เพิ่มงานใหม่', '/todo ', g.sage)),
      ),
    }
  }

  const visible = tasks.slice(0, 6)
  const urgentCount = tasks.filter((task) => Number(task.priority) === 3).length
  const estimatedMinutes = tasks.reduce((total, task) => total + Math.max(0, Number(task.estimated_minutes) || 0), 0)

  const body: Fc[] = [
    brandHero(
      urgentCount > 0 ? g.coral : g.skyBright,
      g.ink,
      urgentCount > 0 ? 'alert' : 'laptop',
      'Koko To-Do',
      tasks.length + ' งานที่ต้องดู',
      urgentCount > 0 ? urgentCount + ' งานควรจัดการก่อน' : 'เลือกทีละงาน แล้วเดินหน้าต่อ',
    ),
    metricStrip([
      metricTile(String(tasks.length), 'งานที่ยังไม่เสร็จ', g.roseDeep, g.coral, g.ink),
      metricTile(String(urgentCount), 'งานด่วน', g.amberDeep, g.sun, g.ink),
      metricTile(compactMinutes(estimatedMinutes), 'เวลาที่ตั้งไว้รวม', g.skyDeep, g.skyBright, g.ink),
    ]),
    {
      type: 'box',
      layout: 'vertical',
      paddingStart: 'xl',
      paddingEnd: 'xl',
      contents: [
        label('เรียงตามกำหนดส่ง', g.sub),
        { type: 'box', layout: 'vertical', spacing: 'xs', margin: 'md', contents: visible.map(taskRow) },
      ],
    },
  ]

  if (tasks.length > visible.length) body.push(extraRow(tasks.length - visible.length, g.rose))

  return {
    type: 'flex',
    altText: 'To-Do · มีงานค้าง ' + tasks.length + ' รายการ',
    contents: shell(
      body,
      footerBar(
        messageButton('เพิ่มงาน', '/todo ', g.rose),
        messageButton('วันสำคัญ', '/events', g.iris, 'secondary'),
      ),
    ),
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// EVENT SUMMARY
// ═════════════════════════════════════════════════════════════════════════════
export function createEventsFlex(events: Array<Record<string, unknown>>): LineFlexMessage {
  if (events.length === 0) {
    return {
      type: 'flex',
      altText: 'ยังไม่มีวันสำคัญ',
      contents: shell(
        [
          brandHero(g.violetBright, g.ink, 'peek', 'Koko Calendar', 'ปฏิทินยังว่างอยู่', 'เพิ่มสอบ แข่งขัน หรือวันสำคัญได้เลย'),
          metricStrip([
            metricTile('0', 'วันสำคัญที่บันทึก', g.irisDeep, g.violetBright, g.ink),
            metricTile('—', 'วันใกล้ที่สุด', g.skyDeep, g.skyBright, g.ink),
          ]),
          {
            type: 'box',
            layout: 'vertical',
            paddingStart: 'xl',
            paddingEnd: 'xl',
            paddingBottom: 'lg',
            contents: [
              panel(
                [t('เพิ่มหมุดหมายไว้ แล้ว Koko จะช่วยเตือนให้', { size: 'sm', color: g.sub, wrap: true })],
                g.violetBright,
                g.ink,
              ),
            ],
          },
        ],
        footerBar(messageButton('เพิ่มวันสำคัญ', '/event ', g.iris)),
      ),
    }
  }

  const visible = events.slice(0, 6)
  const examCount = events.filter((event) => compact(event.type) === 'exam').length
  const firstStyle = eventStyle(compact(visible[0]?.type, 'important'))
  const nearestParts = dateParts(compact(visible[0]?.event_date))
  const nearestDate = nearestParts.day + ' ' + nearestParts.month
  const body: Fc[] = [
    brandHero(g.violetBright, g.ink, firstStyle.mood, 'Koko Calendar', events.length + ' วันสำคัญ', examCount > 0 ? examCount + ' การสอบที่ต้องเตรียมตัว' : 'มองภาพรวม แล้ววางแผนล่วงหน้า'),
    metricStrip([
      metricTile(String(events.length), 'วันสำคัญทั้งหมด', g.irisDeep, g.violetBright, g.ink),
      metricTile(String(examCount), 'วันสอบ', g.roseDeep, g.coral, g.ink),
      metricTile(nearestDate, 'วันใกล้ที่สุด', g.skyDeep, g.skyBright, g.ink),
    ]),
    {
      type: 'box',
      layout: 'vertical',
      paddingStart: 'xl',
      paddingEnd: 'xl',
      contents: [
        label('กำหนดการถัดไป', g.sub),
        { type: 'box', layout: 'vertical', spacing: 'xs', margin: 'md', contents: visible.map(eventRow) },
      ],
    },
  ]

  if (events.length > visible.length) body.push(extraRow(events.length - visible.length, g.iris))
  body.push(hr())
  body.push(ticker('เตรียมตัวล่วงหน้า แล้ววันจริงจะเบาลง', g.irisFrost, g.iris))

  return {
    type: 'flex',
    altText: 'Calendar · มีวันสำคัญ ' + events.length + ' รายการ',
    contents: shell(
      body,
      footerBar(
        messageButton('ดูทั้งหมด', '/events', g.iris),
        messageButton('เพิ่มวันสำคัญ', '/event ', g.amber, 'secondary'),
      ),
    ),
  }
}
