import type { AdaptiveSignals } from '@/lib/adaptive-planner'

export type KokoPresentation = {
  focusCta: string
  gentleNudge: string
  reminderLine: string
  insightEnding: string
}

type MemoryLike = { content: string }

function has(memory: MemoryLike[], pattern: RegExp) {
  return memory.some((item) => pattern.test(item.content))
}

// Memory is used only to adjust delivery. It never alters a task's deadline,
// priority, ownership, or completion state.
export function deriveKokoPresentation(memory: MemoryLike[], signals: AdaptiveSignals): KokoPresentation {
  const totalFollowThrough = Object.values(signals).reduce((sum, item) => sum + item.accepted + item.completed, 0)
  if (has(memory, /tiny|small step|break.*down|ทีละ|เล็ก.?ๆ|แบ่ง.*ขั้น|เริ่ม.*ง่าย/i)) {
    return { focusCta: 'START TINY', gentleNudge: 'one small step is enough', reminderLine: 'เริ่มจากก้าวที่เล็กที่สุดก่อนก็ได้', insightEnding: 'Keep the next step small enough to begin.' }
  }
  if (has(memory, /direct|concise|straightforward|ตรงไปตรงมา|สั้น.?ๆ|กระชับ/i) || totalFollowThrough >= 12) {
    return { focusCta: 'START NOW', gentleNudge: 'pick one clear next move', reminderLine: 'เลือกหนึ่งงาน แล้วเริ่มได้เลย', insightEnding: 'Choose one concrete next move.' }
  }
  return { focusCta: 'FOCUS THIS', gentleNudge: 'take one calm step', reminderLine: 'เริ่มจากงานเล็กที่สุดก่อนก็ได้', insightEnding: 'A small start is enough to make the next step clearer.' }
}
