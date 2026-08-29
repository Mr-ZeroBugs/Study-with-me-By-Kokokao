'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarDays, Check, Droplets, Plus, Sprout, Trash2, X } from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import { getLocalDateKey, loadSubjectLogs, type SubjectDayLogs } from '../lib/storage'
import {
  createPlannerId,
  loadPlannerData,
  removePlannerRecord,
  saveLocalPlannerData,
  syncPlannerData,
  type GoalStep,
  type LifeGoal,
  type PlannerData,
} from '../lib/planner-storage'

const emptyData: PlannerData = { tasks: [], goals: [], steps: [], events: [] }
const plantStages = ['🌱', '🪴', '🌿', '🌳']
const plantStageLabels = ['seedling', 'sprout', 'leafy', 'growing strong']

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

function formatDate(dateKey: string) {
  if (!dateKey) return 'no target date'
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function dateKeysBackFrom(todayKey: string, count: number) {
  const today = new Date(`${todayKey}T12:00:00`)
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today)
    date.setDate(today.getDate() - index)
    return getLocalDateKey(date)
  })
}

function subjectMinutes(logs: SubjectDayLogs, selectedSubjects: string[], keys?: string[]) {
  if (!selectedSubjects.length) return 0
  const selected = new Set(selectedSubjects)
  return Object.entries(logs).reduce((total, [subject, days]) => {
    if (!selected.has(subject)) return total
    if (!keys) return total + Object.values(days).reduce((sum, minutes) => sum + minutes, 0)
    return total + keys.reduce((sum, key) => sum + (days[key] ?? 0), 0)
  }, 0)
}

function getGrowthStage(totalMinutes: number, progress: number) {
  if (totalMinutes >= 600 || progress >= 100) return 3
  if (totalMinutes >= 180 || progress >= 66) return 2
  if (totalMinutes > 0 || progress > 0) return 1
  return 0
}

function normalizeGoalPosition(goal: LifeGoal, index: number) {
  return Number.isInteger(goal.shelfPosition) && (goal.shelfPosition as number) >= 0 ? goal.shelfPosition as number : index
}

function goalProgress(goal: LifeGoal, steps: GoalStep[]) {
  const goalSteps = steps.filter((step) => step.goalId === goal.id)
  const complete = goalSteps.filter((step) => step.completed).length
  return { steps: goalSteps, complete, percent: goalSteps.length ? Math.round((complete / goalSteps.length) * 100) : 0 }
}

export function GoalsGarden({ user, subjects }: { user: User | null; subjects: string[] }) {
  const [data, setData] = useState<PlannerData>(emptyData)
  const [subjectLogs, setSubjectLogs] = useState<SubjectDayLogs>({})
  const [loaded, setLoaded] = useState(false)
  const [todayKey, setTodayKey] = useState('2000-01-01')
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerSlot, setComposerSlot] = useState<number | null>(null)
  const [goalTitle, setGoalTitle] = useState('')
  const [goalDescription, setGoalDescription] = useState('')
  const [goalTargetDate, setGoalTargetDate] = useState('')
  const [goalSubjects, setGoalSubjects] = useState<string[]>([])
  const [expandedGoal, setExpandedGoal] = useState<string | null>(null)
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null)
  const [stepDrafts, setStepDrafts] = useState<Record<string, string>>({})

  useEffect(() => {
    setTodayKey(getLocalDateKey())
    let active = true
    let loading = false

    const refresh = async () => {
      if (loading) return
      loading = true
      try {
        const [nextData, nextLogs] = await Promise.all([loadPlannerData(user), loadSubjectLogs(user)])
        if (!active) return
        setData(nextData)
        setSubjectLogs(nextLogs)
        setLoaded(true)
      } finally {
        loading = false
      }
    }

    void refresh()
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener('focus', refreshIfVisible)
    document.addEventListener('visibilitychange', refreshIfVisible)
    const interval = window.setInterval(refreshIfVisible, 30_000)
    return () => {
      active = false
      window.removeEventListener('focus', refreshIfVisible)
      document.removeEventListener('visibilitychange', refreshIfVisible)
      window.clearInterval(interval)
    }
  }, [user])

  const availableSubjects = useMemo(() => Array.from(new Set(['General', ...subjects, ...Object.keys(subjectLogs)])), [subjects, subjectLogs])
  const recentKeys = useMemo(() => dateKeysBackFrom(todayKey, 7), [todayKey])
  const goalBySlot = useMemo(() => {
    const occupied = new Map<number, LifeGoal>()
    data.goals.forEach((goal, index) => {
      let position = normalizeGoalPosition(goal, index)
      while (occupied.has(position)) position += 1
      occupied.set(position, goal)
    })
    return occupied
  }, [data.goals])
  const shelfCount = useMemo(() => {
    const highest = Math.max(-1, ...Array.from(goalBySlot.keys()))
    return Math.max(2, Math.ceil((highest + 1) / 3))
  }, [goalBySlot])
  const shelfSlots = shelfCount * 3
  const firstOpenSlot = useMemo(() => {
    for (let index = 0; index < shelfSlots; index += 1) if (!goalBySlot.has(index)) return index
    return shelfSlots
  }, [goalBySlot, shelfSlots])
  const selectedGoal = useMemo(() => data.goals.find((goal) => goal.id === selectedGoalId) ?? null, [data.goals, selectedGoalId])
  const selectedGoalStats = useMemo(() => selectedGoal ? goalProgress(selectedGoal, data.steps) : null, [selectedGoal, data.steps])
  const selectedGoalTotalMinutes = useMemo(() => selectedGoal ? subjectMinutes(subjectLogs, selectedGoal.subjects ?? []) : 0, [selectedGoal, subjectLogs])
  const selectedGoalWeekMinutes = useMemo(() => selectedGoal ? subjectMinutes(subjectLogs, selectedGoal.subjects ?? [], recentKeys) : 0, [selectedGoal, subjectLogs, recentKeys])
  const selectedGoalTodayMinutes = useMemo(() => selectedGoal ? subjectMinutes(subjectLogs, selectedGoal.subjects ?? [], [todayKey]) : 0, [selectedGoal, subjectLogs, todayKey])
  const selectedGoalGrowth = getGrowthStage(selectedGoalTotalMinutes, selectedGoalStats?.percent ?? 0)
  const selectedGoalSlot = selectedGoal ? Array.from(goalBySlot.entries()).find(([, goal]) => goal.id === selectedGoal.id)?.[0] ?? 0 : 0

  const persist = (next: PlannerData) => {
    setData(next)
    saveLocalPlannerData(next)
    void syncPlannerData(user, next)
  }

  const openComposer = (slot: number | null = firstOpenSlot) => {
    setComposerSlot(slot)
    setGoalTitle('')
    setGoalDescription('')
    setGoalTargetDate('')
    setGoalSubjects([])
    setComposerOpen(true)
  }

  const closeComposer = () => setComposerOpen(false)

  const openGoalDetails = (goalId: string) => {
    setSelectedGoalId(goalId)
    setExpandedGoal(null)
  }

  const closeGoalDetails = () => {
    setSelectedGoalId(null)
    setExpandedGoal(null)
  }

  const toggleComposerSubject = (subject: string) => {
    setGoalSubjects((current) => current.includes(subject) ? current.filter((item) => item !== subject) : [...current, subject])
  }

  const addGoal = () => {
    const title = goalTitle.trim()
    if (!title) return
    const goal: LifeGoal = {
      id: createPlannerId(),
      title,
      description: goalDescription.trim(),
      targetDate: goalTargetDate,
      subjects: goalSubjects,
      shelfPosition: composerSlot ?? firstOpenSlot,
      createdAt: new Date().toISOString(),
    }
    persist({ ...data, goals: [...data.goals, goal] })
    closeComposer()
  }

  const deleteGoal = (goalId: string) => {
    const removedStepIds = data.steps.filter((step) => step.goalId === goalId).map((step) => step.id)
    persist({ ...data, goals: data.goals.filter((goal) => goal.id !== goalId), steps: data.steps.filter((step) => step.goalId !== goalId) })
    void removePlannerRecord(user, 'life_goals', goalId)
    removedStepIds.forEach((id) => void removePlannerRecord(user, 'goal_steps', id))
    if (expandedGoal === goalId) setExpandedGoal(null)
    if (selectedGoalId === goalId) setSelectedGoalId(null)
  }

  const toggleStep = (id: string) => {
    persist({ ...data, steps: data.steps.map((step) => step.id === id ? { ...step, completed: !step.completed } : step) })
  }

  const deleteStep = (id: string) => {
    persist({ ...data, steps: data.steps.filter((step) => step.id !== id) })
    void removePlannerRecord(user, 'goal_steps', id)
  }

  const addStep = (goalId: string) => {
    const title = stepDrafts[goalId]?.trim()
    if (!title) return
    const goalSteps = data.steps.filter((step) => step.goalId === goalId)
    const step: GoalStep = { id: createPlannerId(), goalId, title, dueDate: '', completed: false, orderIndex: goalSteps.length }
    persist({ ...data, steps: [...data.steps, step] })
    setStepDrafts((current) => ({ ...current, [goalId]: '' }))
  }

  const toggleGoalSubject = (goalId: string, subject: string) => {
    persist({
      ...data,
      goals: data.goals.map((goal) => goal.id !== goalId ? goal : {
        ...goal,
        subjects: (goal.subjects ?? []).includes(subject) ? (goal.subjects ?? []).filter((item) => item !== subject) : [...(goal.subjects ?? []), subject],
      }),
    })
  }

  return (
    <>
    <main className="goals-garden-page min-h-screen overflow-hidden px-4 py-7 pb-28 text-ink sm:px-8 lg:px-12">
      <div className="goals-garden-shell">
        <section className="goal-shelf-scene" aria-labelledby="goal-shelf-heading">
          <div className="goal-shelf-label"><div><p className="eyebrow">the goal garden</p><h2 id="goal-shelf-heading">your shelf of becoming</h2></div><button type="button" className="garden-add-button" onClick={() => openComposer()}><Plus className="size-4" /> plant a goal</button></div>
          <div className="goal-shelf-rows">
            {Array.from({ length: shelfCount }, (_, rowIndex) => (
              <div className="goal-shelf-row" key={`shelf-${rowIndex}`}>
                <div className="goal-shelf-items">
                  {Array.from({ length: 3 }, (_, columnIndex) => {
                    const slot = rowIndex * 3 + columnIndex
                    const goal = goalBySlot.get(slot)
                    if (!goal) return <button type="button" className="goal-empty-slot" onClick={() => openComposer(slot)} aria-label={`Plant a goal in shelf position ${slot + 1}`} key={`empty-${slot}`}><span className="goal-empty-plus"><Plus className="size-5" /></span><small>plant a goal</small></button>
                    const stats = goalProgress(goal, data.steps)
                    const totalMinutes = subjectMinutes(subjectLogs, goal.subjects ?? [])
                    const weekMinutes = subjectMinutes(subjectLogs, goal.subjects ?? [], recentKeys)
                    const todayMinutes = subjectMinutes(subjectLogs, goal.subjects ?? [], [todayKey])
                    const growth = getGrowthStage(totalMinutes, stats.percent)
                    const isWatered = todayMinutes > 0
                    return (
                      <button type="button" className={`goal-pot-slot growth-${growth} ${isWatered ? 'is-watered' : ''}`} key={goal.id} onClick={() => openGoalDetails(goal.id)} aria-label={`Open goal ${goal.title}`}>
                        <span className="goal-pot-display" aria-hidden="true"><span className="goal-pot-stage">{plantStages[growth]}</span><span className="goal-pot-vessel" /></span>
                        <span className="goal-pot-tooltip"><strong>{goal.title}</strong><small>{formatMinutes(totalMinutes)} focused · {isWatered ? 'watered today' : plantStageLabels[growth]}</small></span>
                      </button>
                    )
                  })}
                </div>
                <div className="goal-shelf-plank" aria-hidden="true"><span /></div>
              </div>
            ))}
          </div>
          {!loaded && <p className="goal-garden-loading">opening your garden…</p>}
        </section>

        <footer className="goals-garden-footer"><span><Sprout className="size-4" /> tiny sessions make strong roots.</span><Link href="/stats">see your study rhythm →</Link></footer>
      </div>
    </main>

      {composerOpen && <div className="goal-composer-backdrop" role="dialog" aria-modal="true" aria-labelledby="goal-composer-title" onClick={(event) => { if (event.target === event.currentTarget) closeComposer() }}>
        <div className="goal-composer-card">
          <button type="button" className="goal-composer-close" aria-label="Close goal form" onClick={closeComposer}><X className="size-4" /></button>
          <p className="eyebrow">new pot · new possibility</p>
          <h2 id="goal-composer-title">plant a goal</h2>
          <p className="goal-composer-intro">Give this goal a name, then choose the subjects that will help it grow.</p>
          <label>goal name<input aria-label="Goal name" autoFocus value={goalTitle} placeholder="e.g. get into BBA" onChange={(event) => setGoalTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addGoal() }} /></label>
          <label>why it matters<textarea aria-label="Goal description" value={goalDescription} placeholder="the feeling or future behind this goal…" onChange={(event) => setGoalDescription(event.target.value)} /></label>
          <label>target date <input aria-label="Goal target date" type="date" value={goalTargetDate} onChange={(event) => setGoalTargetDate(event.target.value)} /></label>
          <div className="goal-composer-subjects"><div className="goal-composer-subject-heading"><span>focus playlist</span><small>{goalSubjects.length ? `${goalSubjects.length} subjects selected` : 'choose at least one'}</small></div><div className="goal-composer-subject-grid">{availableSubjects.map((subject) => <button type="button" key={subject} className={goalSubjects.includes(subject) ? 'selected' : ''} aria-pressed={goalSubjects.includes(subject)} onClick={() => toggleComposerSubject(subject)}>{goalSubjects.includes(subject) && <Check className="size-3" />}{subject}</button>)}</div></div>
          <button type="button" className="goal-composer-submit" onClick={addGoal}><Sprout className="size-4" /> plant {composerSlot !== null ? `on shelf ${composerSlot + 1}` : 'goal'}</button>
        </div>
      </div>}

      {selectedGoal && selectedGoalStats && <div className="goal-detail-backdrop" role="dialog" aria-modal="true" aria-labelledby="goal-detail-title" onClick={(event) => { if (event.target === event.currentTarget) closeGoalDetails() }}>
        <div className="goal-detail-card">
          <div className="goal-detail-header">
            <div className={`goal-detail-plant growth-${selectedGoalGrowth} ${selectedGoalTodayMinutes > 0 ? 'is-watered' : ''}`} aria-hidden="true"><span className="goal-pot-stage">{plantStages[selectedGoalGrowth]}</span><span className="goal-pot-vessel" /></div>
            <div className="goal-detail-title"><p className="goal-slot-label">goal {String(selectedGoalSlot + 1).padStart(2, '0')} · {plantStageLabels[selectedGoalGrowth]}</p><h2 id="goal-detail-title">{selectedGoal.title}</h2>{selectedGoal.targetDate && <p className="goal-target"><CalendarDays className="size-3.5" /> target {formatDate(selectedGoal.targetDate)}</p>}</div>
            <button type="button" className="goal-composer-close" aria-label="Close goal details" onClick={closeGoalDetails}><X className="size-4" /></button>
          </div>
          <p className="goal-detail-description">{selectedGoal.description || 'A meaningful direction, grown one focused session at a time.'}</p>

          <div className="goal-detail-stat-grid" aria-label="Goal progress summary">
            <div><span>all-time focus</span><strong>{formatMinutes(selectedGoalTotalMinutes)}</strong></div>
            <div><span>this week</span><strong>{formatMinutes(selectedGoalWeekMinutes)}</strong></div>
            <div><span>today</span><strong>{selectedGoalTodayMinutes ? `${formatMinutes(selectedGoalTodayMinutes)} watered` : 'not yet watered'}</strong></div>
          </div>

          <div className="goal-detail-columns">
            <section className="goal-detail-section"><div className="goal-detail-section-heading"><span>focus playlist</span><button type="button" className="goal-playlist-edit" onClick={() => setExpandedGoal(expandedGoal === selectedGoal.id ? null : selectedGoal.id)} aria-expanded={expandedGoal === selectedGoal.id}>{expandedGoal === selectedGoal.id ? <><Check className="size-3" /> done</> : <><Plus className="size-3" /> edit subjects</>}</button></div><div className="goal-subject-chips">{selectedGoal.subjects?.length ? selectedGoal.subjects.map((subject) => <span key={subject}>{subject}</span>) : <span className="goal-no-subject">choose subjects to water</span>}</div>{expandedGoal === selectedGoal.id && <div className="goal-subject-picker">{availableSubjects.map((subject) => <button type="button" key={subject} className={selectedGoal.subjects?.includes(subject) ? 'selected' : ''} aria-pressed={selectedGoal.subjects?.includes(subject) ?? false} onClick={() => toggleGoalSubject(selectedGoal.id, subject)}>{selectedGoal.subjects?.includes(subject) && <Check className="size-3" />}{subject}</button>)}</div>}</section>
            <section className="goal-detail-section"><div className="goal-detail-section-heading"><span>growth progress</span><strong>{selectedGoalStats.percent}%</strong></div><div className="goal-progress-track"><span style={{ width: `${selectedGoalStats.percent}%` }} /></div><p className="goal-detail-muted"><Droplets className="size-3.5" /> {selectedGoalStats.complete}/{selectedGoalStats.steps.length} milestones complete</p></section>
          </div>

          <div className="goal-detail-actions"><Link href="/focus" className="goal-water-link"><Droplets className="size-3.5" /> water in focus</Link><button type="button" className="goal-detail-delete" onClick={() => deleteGoal(selectedGoal.id)}><Trash2 className="size-3.5" /> delete goal</button></div>
          <section className="goal-detail-milestones"><div className="goal-detail-section-heading"><span>milestones</span><small>tap to complete</small></div><div className="goal-step-list">{selectedGoalStats.steps.length ? selectedGoalStats.steps.map((step) => <div className="goal-step-row" key={step.id}><button type="button" className={`goal-garden-step ${step.completed ? 'done' : ''}`} onClick={() => toggleStep(step.id)}>{step.completed ? <Check className="size-3.5" /> : <span className="goal-step-dot" />}{step.title}</button><button type="button" className="goal-step-delete" aria-label={`Delete milestone ${step.title}`} onClick={() => deleteStep(step.id)}><Trash2 className="size-3" /></button></div>) : <p className="goal-detail-muted">Add a small next step to give this goal roots.</p>}</div><div className="goal-step-adder"><input aria-label={`New milestone for ${selectedGoal.title}`} value={stepDrafts[selectedGoal.id] ?? ''} placeholder="add a milestone" onChange={(event) => setStepDrafts((current) => ({ ...current, [selectedGoal.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter') addStep(selectedGoal.id) }} /><button type="button" onClick={() => addStep(selectedGoal.id)}>add</button></div></section>
        </div>
      </div>}
    </>
  )
}
