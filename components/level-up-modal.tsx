'use client'

import { useEffect } from 'react'
import confetti from 'canvas-confetti'
import { Star, Gem } from 'lucide-react'
import { levelTitle, levelAvatarEmoji } from '../lib/gamification'

type Props = {
  level: number
  gemsEarned: number
  onClose: () => void
}

export function LevelUpModal({ level, gemsEarned, onClose }: Props) {
  useEffect(() => {
    const fire = (opts: confetti.Options) =>
      confetti({ disableForReducedMotion: true, ...opts })

    fire({ particleCount: 120, spread: 80, origin: { y: 0.55 }, colors: ['#f9d44a', '#ee8d92', '#b9e6d3', '#c19bcf'] })
    const t1 = setTimeout(() => fire({ particleCount: 60, spread: 110, origin: { x: 0.15, y: 0.45 }, colors: ['#f9d44a', '#ee8d92'] }), 320)
    const t2 = setTimeout(() => fire({ particleCount: 60, spread: 110, origin: { x: 0.85, y: 0.45 }, colors: ['#b9e6d3', '#c19bcf'] }), 380)
    const t3 = setTimeout(() => fire({ particleCount: 40, spread: 55, origin: { y: 0.7 }, colors: ['#f9d44a', '#fffdf8'] }), 800)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [])

  return (
    <div className="lup-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Level up!">
      <div className="lup-card" onClick={(e) => e.stopPropagation()}>
        <div className="lup-burst" aria-hidden="true" />
        <div className="lup-avatar">{levelAvatarEmoji(level)}</div>
        <p className="lup-eyebrow">— Level Up! —</p>
        <div className="lup-number">{level}</div>
        <p className="lup-title">{levelTitle(level)}</p>
        <p className="lup-subtitle">
          Your dedication is paying off. Keep pushing forward, scholar.
        </p>
        {gemsEarned > 0 && (
          <div className="lup-gems">
            <Gem className="size-4" />
            +{gemsEarned} gems earned
          </div>
        )}
        <button className="lup-cta" onClick={onClose}>
          <Star className="size-4 fill-current" />
          Continue Your Quest
        </button>
      </div>
    </div>
  )
}
