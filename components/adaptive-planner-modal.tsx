'use client'

import Link from 'next/link'
import { useState } from 'react'
import { CalendarClock, ChevronRight, GitBranch, LoaderCircle, Scissors, Undo2, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { AdaptiveProposal } from '@/lib/adaptive-planner'

type Props = { isOpen: boolean; proposals: AdaptiveProposal[]; onClose: () => void; onApplied: () => void }
type ActionProposal = Exclude<AdaptiveProposal, { kind: 'capacity' }>

async function applyAdjustment(action: 'reschedule_overdue' | 'split_task' | 'update_estimate', taskId: string, estimatedMinutes?: number) {
  const { data } = await supabase.auth.getSession()
  if (!data.session?.access_token) throw new Error('Sign in to apply this adjustment.')
  const response = await fetch('/api/manager/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
    body: JSON.stringify({ action, taskId, estimatedMinutes, requestId: crypto.randomUUID(), confirmed: true }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Koko could not update your plan.')
  return result
}

async function undoAdjustment(undoRequestId: string) {
  const { data } = await supabase.auth.getSession()
  if (!data.session?.access_token) throw new Error('Sign in to undo this adjustment.')
  const response = await fetch('/api/manager/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
    body: JSON.stringify({ action: 'undo', undoRequestId, requestId: crypto.randomUUID(), confirmed: true }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Koko could not undo that adjustment.')
  return result
}

export function AdaptivePlannerModal({ isOpen, proposals, onClose, onApplied }: Props) {
  const [applying, setApplying] = useState('')
  const [dismissed, setDismissed] = useState<string[]>([])
  const [undo, setUndo] = useState<{ requestId: string; proposalId: string; label: string } | null>(null)
  const [error, setError] = useState('')
  const visible = proposals.filter((proposal) => !dismissed.includes(proposal.id))

  const apply = async (proposal: ActionProposal) => {
    setApplying(proposal.id); setError('')
    try {
      const action = proposal.kind === 'reschedule' ? 'reschedule_overdue' : proposal.kind === 'estimate' ? 'update_estimate' : 'split_task'
      const result = await applyAdjustment(action, proposal.task.id, proposal.kind === 'estimate' ? proposal.suggestedMinutes : undefined) as { requestId?: string; undoAvailable?: boolean }
      setDismissed((current) => [...current, proposal.id])
      if (result.undoAvailable && result.requestId) setUndo({ requestId: result.requestId, proposalId: proposal.id, label: proposal.kind === 'split' ? 'split into two steps' : proposal.kind === 'estimate' ? 'updated the time estimate' : 'moved to tomorrow' })
      onApplied()
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : 'Koko could not update this plan.')
    } finally {
      setApplying('')
    }
  }

  const undoLastAdjustment = async () => {
    if (!undo) return
    setApplying(undo.requestId); setError('')
    try {
      await undoAdjustment(undo.requestId)
      setDismissed((current) => current.filter((id) => id !== undo.proposalId))
      setUndo(null)
      onApplied()
    } catch (undoError) {
      setError(undoError instanceof Error ? undoError.message : 'Koko could not undo this adjustment.')
    } finally {
      setApplying('')
    }
  }

  if (!isOpen) return null
  return (
    <div className="adaptive-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <section className="adaptive-modal" role="dialog" aria-modal="true" aria-labelledby="adaptive-title">
        <header className="adaptive-head">
          <span><GitBranch className="size-5" /></span>
          <div><p>koko adaptive planner</p><h2 id="adaptive-title">A lighter way forward.</h2></div>
          <button type="button" onClick={onClose} aria-label="Close plan adjustments"><X className="size-5" /></button>
        </header>
        <p className="adaptive-intro">These are suggestions based on your actual tasks and focus record. Nothing changes until you choose an action.</p>
        {undo && <div className="adaptive-undo">
          <div><Undo2 className="size-4" /><span>last change: {undo.label}</span></div>
          <button type="button" onClick={undoLastAdjustment} disabled={Boolean(applying)}>{applying === undo.requestId ? <LoaderCircle className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />}undo</button>
        </div>}
        {!visible.length ? <div className="adaptive-clear"><span><Undo2 className="size-5" /></span><div><strong>Your plan is clear for now.</strong><p>Any adjustment you applied is already reflected in your planner.</p></div></div> : <div className="adaptive-list">
          {visible.map((proposal) => proposal.kind === 'capacity' ? <article className="adaptive-proposal adaptive-capacity" key={proposal.id}>
            <div className="adaptive-proposal-icon"><CalendarClock className="size-4" /></div>
            <div className="adaptive-proposal-copy"><span>today&apos;s planned load</span><h3>{proposal.title}</h3><p>{proposal.detail}</p><small>{proposal.plannedMinutes} min planned · {proposal.typicalMinutes} min typical focus</small></div>
            <div className="adaptive-proposal-actions"><Link className="adaptive-apply" href="/tasks" onClick={onClose}>review tasks</Link><button type="button" className="adaptive-skip" disabled={Boolean(applying)} onClick={() => setDismissed((current) => [...current, proposal.id])}>not now</button></div>
          </article> : <article className="adaptive-proposal" key={proposal.id}>
            <div className="adaptive-proposal-icon">{proposal.kind === 'split' ? <Scissors className="size-4" /> : <CalendarClock className="size-4" />}</div>
            <div className="adaptive-proposal-copy"><span>{proposal.kind === 'split' ? 'make it smaller' : proposal.kind === 'estimate' ? 'calibrate the plan' : 'refresh the date'}</span><h3>{proposal.title}</h3><p>{proposal.detail}</p><small>{proposal.task.subject} · {proposal.kind === 'estimate' ? `${proposal.task.estimatedMinutes} → ${proposal.suggestedMinutes}` : proposal.task.estimatedMinutes} min</small></div>
            <div className="adaptive-proposal-actions">
              <button type="button" className="adaptive-apply" disabled={Boolean(applying)} onClick={() => apply(proposal)}>{applying === proposal.id ? <LoaderCircle className="size-3.5 animate-spin" /> : proposal.kind === 'split' ? <Scissors className="size-3.5" /> : <CalendarClock className="size-3.5" />}{proposal.kind === 'split' ? 'split into 2' : proposal.kind === 'estimate' ? `use ${proposal.suggestedMinutes} min` : 'move to tomorrow'}</button>
              <button type="button" className="adaptive-skip" disabled={Boolean(applying)} onClick={() => setDismissed((current) => [...current, proposal.id])}>not now</button>
            </div>
          </article>)}
        </div>}
        {visible.some((proposal) => proposal.kind === 'split') && <p className="adaptive-footnote">Splitting replaces the original personal task with two smaller steps. Team Space tasks are never included here.</p>}
        <Link className="adaptive-open-planner" href="/tasks" onClick={onClose}>open full planner <ChevronRight className="size-3.5" /></Link>
        {error && <p className="adaptive-error">{error}</p>}
      </section>
    </div>
  )
}
