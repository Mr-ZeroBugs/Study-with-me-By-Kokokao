'use client'

import { useEffect, useState } from 'react'
import { ACHIEVEMENTS } from '../lib/gamification'

type SingleToastProps = { achievementId: string; onDone: () => void }

function AchievementToast({ achievementId, onDone }: SingleToastProps) {
  const ach = ACHIEVEMENTS.find((a) => a.id === achievementId)
  const [out, setOut] = useState(false)

  useEffect(() => {
    const dismiss = () => { setOut(true); setTimeout(onDone, 420) }
    const t = setTimeout(dismiss, 4_200)
    return () => clearTimeout(t)
  }, [onDone])

  if (!ach) return null
  return (
    <div
      className={`ach-toast${out ? ' ach-toast--out' : ''}`}
      onClick={() => { setOut(true); setTimeout(onDone, 420) }}
      role="status"
    >
      <div className="ach-toast-shine" aria-hidden />
      <span className="ach-toast-emoji">{ach.emoji}</span>
      <div className="ach-toast-body">
        <p className="ach-toast-kicker">Achievement Unlocked!</p>
        <strong className="ach-toast-name">{ach.name}</strong>
        <p className="ach-toast-desc">{ach.desc}</p>
      </div>
    </div>
  )
}

type StackProps = { achievementIds: string[]; onDismissAll: () => void }

export function AchievementToastStack({ achievementIds, onDismissAll }: StackProps) {
  const [queue, setQueue] = useState<string[]>([])

  useEffect(() => {
    if (achievementIds.length > 0) setQueue(achievementIds)
  }, [achievementIds])

  const shiftQueue = () =>
    setQueue((prev) => {
      const next = prev.slice(1)
      if (next.length === 0) onDismissAll()
      return next
    })

  if (queue.length === 0) return null
  return (
    <div className="ach-toast-stack" aria-live="polite">
      <AchievementToast key={queue[0]} achievementId={queue[0]} onDone={shiftQueue} />
    </div>
  )
}
