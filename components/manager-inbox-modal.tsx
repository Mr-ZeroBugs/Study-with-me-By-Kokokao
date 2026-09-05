'use client'

import { useMemo, useState } from 'react'
import { CalendarDays, Check, ClipboardPenLine, LoaderCircle, Plus, Sparkles, Trash2, Undo2, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'

type TaskDraft = {
  id: string
  kind: 'task'
  title: string
  subject: string
  dueDate: string
  estimatedMinutes: number
  priority: 1 | 2 | 3
  deadlineConfidence: 'explicit' | 'inferred' | 'none'
  duplicateOf?: string
}
type EventDraft = {
  id: string
  kind: 'event'
  title: string
  eventDate: string
  type: 'competition' | 'project' | 'exam' | 'important'
  notes: string
  dateConfidence: 'explicit' | 'inferred' | 'none'
  duplicateOf?: string
}
type Draft = TaskDraft | EventDraft
type WorkspaceOption = { id: string | null; name: string }
type MemoryProposal = { kind: 'preference' | 'learning'; content: string }
type PreviewResponse = {
  message: string; drafts: Draft[]; allowedSubjects: string[]; workspace?: WorkspaceOption; workspaceOptions?: WorkspaceOption[]
  memoryProposal?: MemoryProposal | null; noChangesDetected?: boolean; error?: string
}

type Props = {
  isOpen: boolean
  onClose: () => void
  onApplied: () => void
}

const examples = [
  'วันนี้มีเลขส่งศุกร์ อังกฤษท่องศัพท์พรุ่งนี้ แล้ววันจันทร์สอบชีวะ',
  'พรุ่งนี้ต้องส่งสไลด์โครงงาน แล้วอาทิตย์หน้ามีแข่งนำเสนอ',
]

function labelDate(value: string) {
  if (!value) return 'no date'
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function confidenceLabel(value: 'explicit' | 'inferred' | 'none') {
  return value === 'explicit' ? 'date checked' : value === 'inferred' ? 'AI-read date · check it' : 'date needed'
}

async function inboxRequest(body: Record<string, unknown>) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sign in to let Koko save this to your planner.')
  const response = await fetch('/api/manager/inbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Koko could not finish that request.')
  return result
}

export function ManagerInboxModal({ isOpen, onClose, onApplied }: Props) {
  const [message, setMessage] = useState('')
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [subjects, setSubjects] = useState<string[]>(['General'])
  const [assistantNote, setAssistantNote] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([{ id: null, name: 'Personal planner' }])
  const [memoryProposal, setMemoryProposal] = useState<MemoryProposal | null>(null)
  const [saveMemory, setSaveMemory] = useState(false)
  const [savedWorkspaceName, setSavedWorkspaceName] = useState('Personal planner')
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<Array<{ id: string; title: string; kind: 'task' | 'event' }>>([])

  const canApply = useMemo(() => drafts.some((draft) => !draft.duplicateOf), [drafts])

  const reset = () => {
    setMessage(''); setDrafts([]); setAssistantNote(''); setError(''); setCreated([]); setLoading(false); setApplying(false)
    setWorkspaceId(''); setWorkspaces([{ id: null, name: 'Personal planner' }]); setMemoryProposal(null); setSaveMemory(false); setSavedWorkspaceName('Personal planner')
  }

  const close = () => { reset(); onClose() }

  const preview = async (nextWorkspaceId = workspaceId) => {
    if (!message.trim()) return
    setLoading(true); setError(''); setCreated([])
    try {
      const result = await inboxRequest({ mode: 'preview', message, workspaceId: nextWorkspaceId || null }) as PreviewResponse
      setDrafts(result.drafts ?? [])
      setSubjects(Array.from(new Set(result.allowedSubjects?.length ? result.allowedSubjects : ['General'])))
      setAssistantNote(result.message ?? '')
      setWorkspaces(result.workspaceOptions?.length ? result.workspaceOptions : [{ id: null, name: 'Personal planner' }])
      setMemoryProposal(result.memoryProposal ?? null)
      setSaveMemory(false)
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Koko could not read that yet.')
    } finally {
      setLoading(false)
    }
  }

  const updateDraft = (id: string, update: Partial<Draft>) => {
    setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, ...update } as Draft : draft))
  }

  const apply = async () => {
    const next = drafts.filter((draft) => !draft.duplicateOf)
    if (!next.length) return
    setApplying(true); setError('')
    try {
      const result = await inboxRequest({ mode: 'apply', drafts: next, workspaceId: workspaceId || null, memoryProposal, saveMemory, requestId: crypto.randomUUID(), confirmed: true }) as { created: Array<{ id: string; title: string; kind: 'task' | 'event' }>; workspace?: WorkspaceOption }
      setCreated(result.created ?? [])
      setSavedWorkspaceName(result.workspace?.name ?? 'Personal planner')
      setDrafts([])
      onApplied()
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : 'Koko could not save that yet.')
    } finally {
      setApplying(false)
    }
  }

  const undo = async () => {
    if (!created.length) return
    setApplying(true); setError('')
    try {
      await inboxRequest({ mode: 'undo', ids: created.map((item) => item.id), workspaceId: workspaceId || null, requestId: crypto.randomUUID(), confirmed: true })
      setCreated([])
      onApplied()
    } catch (undoError) {
      setError(undoError instanceof Error ? undoError.message : 'Koko could not undo that yet.')
    } finally {
      setApplying(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="manager-inbox-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
      <section className="manager-inbox-modal" role="dialog" aria-modal="true" aria-labelledby="manager-inbox-title">
        <header className="manager-inbox-head">
          <div className="manager-inbox-icon"><ClipboardPenLine className="size-5" /></div>
          <div><p>koko manager inbox</p><h2 id="manager-inbox-title">Drop it all here.</h2></div>
          <button type="button" className="manager-inbox-close" onClick={close} aria-label="Close inbox"><X className="size-5" /></button>
        </header>

        {created.length ? (
          <div className="manager-inbox-success">
            <div className="manager-inbox-success-mark"><Check className="size-5" /></div>
            <div><strong>Saved to {savedWorkspaceName}.</strong><p>{created.map((item) => item.title).join(' · ')}</p></div>
            <button type="button" onClick={undo} disabled={applying}><Undo2 className="size-3.5" /> undo</button>
          </div>
        ) : (
          <>
            <p className="manager-inbox-intro">Paste a class announcement or write naturally. Koko separates tasks and important dates, checks your existing subjects, then waits for your approval.</p>
            <label className="manager-inbox-composer">
              <span>what happened?</span>
              <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="e.g. วันนี้มีเลขส่งศุกร์ อังกฤษท่องศัพท์พรุ่งนี้ แล้ววันจันทร์สอบชีวะ" rows={4} maxLength={2000} autoFocus />
            </label>
            <div className="manager-inbox-examples">
              {examples.map((example) => <button type="button" key={example} onClick={() => setMessage(example)}>{example}</button>)}
            </div>
            <button type="button" className="manager-inbox-sort" onClick={() => void preview()} disabled={loading || !message.trim()}>
              {loading ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {loading ? 'Koko is sorting this…' : 'sort into my planner'}
            </button>

            {(assistantNote || drafts.length > 0) && (
              <div className="manager-inbox-review">
                <div className="manager-inbox-review-head"><div><span>review before saving</span><strong>{assistantNote || 'Check the details, then save when it feels right.'}</strong></div><small>{drafts.length} item{drafts.length === 1 ? '' : 's'}</small></div>
                <label className="manager-inbox-destination"><span>save to</span><select value={workspaceId} onChange={(event) => { const next = event.target.value; setWorkspaceId(next); if (drafts.length) void preview(next) }}>{workspaces.map((workspace) => <option value={workspace.id ?? ''} key={workspace.id ?? 'personal'}>{workspace.name}</option>)}</select></label>
                {drafts.length === 0 ? <p className="manager-inbox-empty">Nothing recordable found yet. Try including an action and a date.</p> : <div className="manager-inbox-drafts">
                  {drafts.map((draft) => (
                    <article className={`manager-inbox-draft${draft.duplicateOf ? ' is-duplicate' : ''}`} key={draft.id}>
                      <div className="manager-inbox-draft-top">
                        <span className={`manager-inbox-kind ${draft.kind}`}>{draft.kind === 'task' ? 'task' : 'important date'}</span>
                        {draft.duplicateOf && <span className="manager-inbox-duplicate">already in planner</span>}
                        <button type="button" aria-label="Remove this item" onClick={() => setDrafts((current) => current.filter((item) => item.id !== draft.id))}><Trash2 className="size-3.5" /></button>
                      </div>
                      <input aria-label="Item title" value={draft.title} onChange={(event) => updateDraft(draft.id, { title: event.target.value })} />
                      {draft.kind === 'task' ? (
                        <div className="manager-inbox-fields">
                          <select value={draft.subject} onChange={(event) => updateDraft(draft.id, { subject: event.target.value })}>{subjects.map((subject) => <option key={subject}>{subject}</option>)}</select>
                          <label><CalendarDays className="size-3.5" /><input aria-label="Due date" type="date" value={draft.dueDate} onChange={(event) => updateDraft(draft.id, { dueDate: event.target.value, deadlineConfidence: event.target.value ? 'explicit' : 'none' })} /></label>
                          <select value={draft.estimatedMinutes} onChange={(event) => updateDraft(draft.id, { estimatedMinutes: Number(event.target.value) })}>{[15, 25, 30, 45, 60, 90].map((value) => <option value={value} key={value}>{value} min</option>)}</select>
                          <span className={`manager-inbox-confidence ${draft.deadlineConfidence}`}>{confidenceLabel(draft.deadlineConfidence)}</span>
                        </div>
                      ) : (
                        <div className="manager-inbox-fields">
                          <label><CalendarDays className="size-3.5" /><input aria-label="Event date" type="date" value={draft.eventDate} onChange={(event) => updateDraft(draft.id, { eventDate: event.target.value, dateConfidence: event.target.value ? 'explicit' : 'none' })} /></label>
                          <select value={draft.type} onChange={(event) => updateDraft(draft.id, { type: event.target.value as EventDraft['type'] })}>{['important', 'exam', 'project', 'competition'].map((value) => <option value={value} key={value}>{value}</option>)}</select>
                          <span className="manager-inbox-date-label">{labelDate(draft.eventDate)}</span>
                          <span className={`manager-inbox-confidence ${draft.dateConfidence}`}>{confidenceLabel(draft.dateConfidence)}</span>
                        </div>
                      )}
                    </article>
                  ))}
                </div>}
                {memoryProposal && <label className="manager-inbox-memory"><input type="checkbox" checked={saveMemory} onChange={(event) => setSaveMemory(event.target.checked)} /><span><strong>Also send this to Memory review</strong><em>{memoryProposal.content}</em><small>Koko will propose it for your approval; it will not become an active memory automatically.</small></span></label>}
                <button type="button" className="manager-inbox-apply" disabled={!canApply || applying} onClick={apply}>
                  {applying ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />} {applying ? 'saving…' : `save ${drafts.filter((draft) => !draft.duplicateOf).length || ''} to planner`}
                </button>
              </div>
            )}
          </>
        )}
        {error && <p className="manager-inbox-error">{error}</p>}
      </section>
    </div>
  )
}
