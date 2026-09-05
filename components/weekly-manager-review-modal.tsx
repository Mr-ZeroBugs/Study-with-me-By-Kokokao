'use client'

import Link from 'next/link'
import { BarChart3, CalendarCheck2, CheckCircle2, ChevronRight, CircleDotDashed, Sparkles, X } from 'lucide-react'
import type { WeeklyManagerReview } from '@/lib/weekly-manager-review'

type Props = { isOpen: boolean; review: WeeklyManagerReview; onClose: () => void; onOpenAdaptivePlanner: () => void }

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

export function WeeklyManagerReviewModal({ isOpen, review, onClose, onOpenAdaptivePlanner }: Props) {
  if (!isOpen) return null
  const action = review.nextStep?.action
  return (
    <div className="weekly-review-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="weekly-review-modal" role="dialog" aria-modal="true" aria-labelledby="weekly-review-title">
        <header className="weekly-review-head">
          <span><Sparkles className="size-5" /></span>
          <div><p>koko weekly review</p><h2 id="weekly-review-title">{review.periodLabel}</h2></div>
          <button type="button" onClick={onClose} aria-label="Close weekly review"><X className="size-5" /></button>
        </header>

        <section className="weekly-review-hero">
          <p>{review.headline}</p>
          <strong>{review.summary}</strong>
        </section>

        <div className="weekly-review-metrics">
          <div><BarChart3 className="size-4" /><span>focus logged</span><strong>{formatMinutes(review.focusMinutes)}</strong><small>{review.focusDifference > 0 ? `+${formatMinutes(review.focusDifference)} vs last week` : review.focusDifference < 0 ? `${formatMinutes(Math.abs(review.focusDifference))} less than last week` : 'same as last week'}</small></div>
          <div><CalendarCheck2 className="size-4" /><span>showed up</span><strong>{review.activeDays}<em>/7</em></strong><small>active days</small></div>
          <div><CheckCircle2 className="size-4" /><span>tasks finished</span><strong>{review.completedTasks}</strong><small>recorded this week</small></div>
        </div>

        {review.wins.length > 0 && <section className="weekly-review-wins"><p>what moved</p>{review.wins.map((win) => <span key={win}><CheckCircle2 className="size-3.5" />{win}</span>)}</section>}

        {review.nextStep && <section className="weekly-review-next">
          <div className="weekly-review-next-mark"><CircleDotDashed className="size-4" /></div>
          <div><p>one useful next move</p><h3>{review.nextStep.title}</h3><span>{review.nextStep.detail}</span></div>
          {action?.kind === 'adaptive' ? <button type="button" onClick={() => { onClose(); onOpenAdaptivePlanner() }}>{action.label}<ChevronRight className="size-3.5" /></button> : action ? <Link href={action.href} onClick={onClose}>{action.label}<ChevronRight className="size-3.5" /></Link> : null}
        </section>}

        <p className="weekly-review-note">This review uses your recorded focus, completed-task activity, deadlines, and Rhythm. It does not guess your mood or change your plan by itself.</p>
      </section>
    </div>
  )
}
