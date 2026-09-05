'use client'

import Link from 'next/link'
import {
  ArrowRight, ArrowUpRight, BookOpen, Droplets,
  Leaf, Plus, SlidersHorizontal, Sparkles, Trash2, X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  createDefaultKokoRhythmPlan, createLocalRhythmSubject, createRhythmId,
  loadKokoRhythmPlan, rhythmIdentity, saveKokoRhythmPlan,
  type KokoRhythmPlan, type RhythmMaintenance,
} from '../lib/rhythm-storage'
import { loadRhythmPlanFromOntology, syncRhythmPlanToOntology } from '../lib/rhythm-ontology'
import { runOntologyAction } from '../lib/ontology-client'
import { getLocalSubjects, saveLocalSubjects } from '../lib/storage'

type RhythmHubProps = { user: User | null; subjects: string[] }
type RhythmPanel   = 'groups' | 'anchors' | 'maintenance'

const isCanonicalOntologyId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

export function RhythmHub({ user, subjects }: RhythmHubProps) {
  const [plan,                  setPlan]                  = useState<KokoRhythmPlan>(() => createDefaultKokoRhythmPlan(subjects))
  const [ready,                 setReady]                 = useState(false)
  const [newGroupName,          setNewGroupName]          = useState('')
  const [newSubjectName,        setNewSubjectName]        = useState('')
  const [newSubjectGroupId,     setNewSubjectGroupId]     = useState('')
  const [maintenanceSubject,    setMaintenanceSubject]    = useState('')
  const [maintenanceMinutes,    setMaintenanceMinutes]    = useState<5|10|15|20>(10)
  const [activePanel,           setActivePanel]           = useState<RhythmPanel|null>(null)
  const [isSaving,              setIsSaving]              = useState(false)
  const [saveError,             setSaveError]             = useState('')
  const loadedUserRef   = useRef<string|null|undefined>(undefined)
  const planRef         = useRef(plan)
  const pendingSaveRef  = useRef<{plan:KokoRhythmPlan;user:User|null}|null>(null)
  const cloudSaveInFlightRef = useRef(false)
  const syncRevisionRef = useRef(0)
  const hydrationRevisionRef = useRef(0)
  const hydratedUserIdRef = useRef<string | null>(null)
  const saveWaitersRef = useRef<Array<() => void>>([])
  const saveFailedRef = useRef(false)

  const resolveSaveWaiters = useCallback(() => {
    const waiters = saveWaitersRef.current.splice(0)
    waiters.forEach((resolve) => resolve())
  }, [])

  useEffect(() => { planRef.current = plan }, [plan])

  const flushPlanSave = useCallback(() => {
    const pending = pendingSaveRef.current
    if (cloudSaveInFlightRef.current) return
    if (!pending?.user || hydratedUserIdRef.current !== pending.user.id) {
      if (!pendingSaveRef.current) resolveSaveWaiters()
      return
    }
    const revision = syncRevisionRef.current
    const savingUser = pending.user
    const planToSave = pending.plan
    pendingSaveRef.current = null
    cloudSaveInFlightRef.current = true
    setIsSaving(true)
    setSaveError('')
    saveFailedRef.current = false
    // Start the write immediately. A debounced write made a newly created
    // group disappear when a learner refreshed or switched pages too fast.
    void syncRhythmPlanToOntology(savingUser, planToSave).then((canonicalPlan) => {
      if (revision !== syncRevisionRef.current || hydratedUserIdRef.current !== savingUser.id) return
      planRef.current = canonicalPlan
      setPlan(canonicalPlan)
      saveKokoRhythmPlan(savingUser, canonicalPlan)
    }).catch((error) => {
      console.error('Koko Rhythm cloud save failed:', error)
      saveFailedRef.current = true
      setSaveError('Could not save the latest Rhythm change. Please try again.')
    }).finally(() => {
      cloudSaveInFlightRef.current = false
      if (pendingSaveRef.current) flushPlanSave()
      else {
        setIsSaving(false)
        resolveSaveWaiters()
      }
    })
  }, [resolveSaveWaiters])

  const queuePlanSave = useCallback((next: KokoRhythmPlan) => {
    saveKokoRhythmPlan(user, next)
    syncRevisionRef.current += 1
    if (!user) return
    pendingSaveRef.current = { plan: next, user }
    flushPlanSave()
  }, [flushPlanSave, user])

  const waitForPlanSave = useCallback(async () => {
    flushPlanSave()
    if (!cloudSaveInFlightRef.current && !pendingSaveRef.current) return
    await new Promise<void>((resolve) => saveWaitersRef.current.push(resolve))
  }, [flushPlanSave])

  const closeDrawer = useCallback(async () => {
    await waitForPlanSave()
    if (saveFailedRef.current) return
    setActivePanel(null)
  }, [waitForPlanSave])

  const retryPlanSave = useCallback(() => {
    saveFailedRef.current = false
    setSaveError('')
    queuePlanSave(planRef.current)
  }, [queuePlanSave])

  useEffect(() => {
    const key = user?.id ?? null
    if (loadedUserRef.current === key) return
    loadedUserRef.current = key
    syncRevisionRef.current = 0
    hydratedUserIdRef.current = null
    const hydrationRevision = ++hydrationRevisionRef.current
    pendingSaveRef.current = null
    const saved = loadKokoRhythmPlan(user)
    const localPlan = saved ?? createDefaultKokoRhythmPlan(subjects)
    planRef.current = localPlan
    setPlan(localPlan)
    setReady(false)
    if (!saved) saveKokoRhythmPlan(user, localPlan)
    if (!user) {
      hydratedUserIdRef.current = null
      setReady(true)
      return
    }

    void (async () => {
      try {
        const cloudPlan = await loadRhythmPlanFromOntology(localPlan)
        if (hydrationRevision !== hydrationRevisionRef.current) return
        const next = cloudPlan ?? localPlan
        planRef.current = next
        setPlan(next)
        saveKokoRhythmPlan(user, next)
        if (!cloudPlan) {
          const canonicalPlan = await syncRhythmPlanToOntology(user, next)
          if (hydrationRevision !== hydrationRevisionRef.current) return
          planRef.current = canonicalPlan
          setPlan(canonicalPlan)
          saveKokoRhythmPlan(user, canonicalPlan)
        }
        if (hydrationRevision !== hydrationRevisionRef.current) return
        hydratedUserIdRef.current = user.id
        setReady(true)
      } catch (error) {
        // The migration may not have been applied yet. Keep every existing
        // rhythm usable locally rather than blocking the learner's planner.
        console.info('Koko Rhythm cloud read is waiting for Ontology:', error)
        if (hydrationRevision === hydrationRevisionRef.current) {
          hydratedUserIdRef.current = user.id
          setReady(true)
        }
      }
    })()
  }, [subjects, user])

  const updatePlan = useCallback((updater: (current: KokoRhythmPlan) => KokoRhythmPlan) => {
    const next = { ...updater(planRef.current), updatedAt: new Date().toISOString() }
    planRef.current = next
    setPlan(next)
    queuePlanSave(next)
  }, [queuePlanSave])

  const studySubjects               = useMemo(() => Array.from(new Map([...subjects, ...plan.groups.flatMap(group => group.subjects.map(subject => subject.name))].map(subject => [rhythmIdentity(subject), subject])).values()), [plan.groups, subjects])
  const assignedSubjects            = useMemo(() => new Set(plan.groups.flatMap(g => g.subjects.map(subject => rhythmIdentity(subject.name)))), [plan.groups])
  const unassignedSubjects          = studySubjects.filter(s => !assignedSubjects.has(rhythmIdentity(s)))
  const majorGroup                  = plan.groups.find(g => g.id === plan.majorGroupId)
  const minorGroup                  = plan.groups.find(g => g.id === plan.minorGroupId)
  const maintenanceSubjects          = new Set(plan.maintenance.map(m => m.subjectName))
  const anchoredSubjects             = new Set(plan.groups.filter(g => g.id === plan.majorGroupId || g.id === plan.minorGroupId).flatMap(g => g.subjects.map(subject => subject.name)))
  const availableMaintenanceSubjects = studySubjects.filter(subject => !maintenanceSubjects.has(subject) && !anchoredSubjects.has(subject))

  useEffect(() => {
    if (!maintenanceSubject || !availableMaintenanceSubjects.includes(maintenanceSubject))
      setMaintenanceSubject(availableMaintenanceSubjects[0] ?? '')
  }, [availableMaintenanceSubjects, maintenanceSubject])

  useEffect(() => {
    if (!newSubjectGroupId || !plan.groups.some(group => group.id === newSubjectGroupId))
      setNewSubjectGroupId(plan.groups[0]?.id ?? '')
  }, [newSubjectGroupId, plan.groups])

  const addGroup = () => {
    const name = newGroupName.trim(); if (!name) return
    if (plan.groups.some((group) => rhythmIdentity(group.name) === rhythmIdentity(name))) return
    const groupId = createRhythmId('group')
    updatePlan(cur => ({ ...cur, groups: [...cur.groups, { id: groupId, name, subjects: [] }] }))
    setNewGroupName('')
  }
  const addSubject = () => {
    const name = newSubjectName.trim().slice(0, 40)
    const groupId = newSubjectGroupId || plan.groups[0]?.id
    if (!name || !groupId || studySubjects.some(subject => rhythmIdentity(subject) === rhythmIdentity(name))) return
    saveLocalSubjects([...getLocalSubjects(user), name], user)
    updatePlan(cur => ({
      ...cur,
      groups: cur.groups.map(group => group.id === groupId
        ? { ...group, subjects: [...group.subjects, createLocalRhythmSubject(name)] }
        : group),
    }))
    setNewSubjectName('')
  }
  const removeGroup = (groupId: string) => {
    if (plan.groups.length <= 1) return
    const subjectsToRemove = new Set(plan.groups.find((group) => group.id === groupId)?.subjects.map(subject => subject.id) ?? [])
    updatePlan(cur => ({ ...cur, groups: cur.groups.filter(g => g.id !== groupId), majorGroupId: cur.majorGroupId === groupId ? '' : cur.majorGroupId, minorGroupId: cur.minorGroupId === groupId ? '' : cur.minorGroupId, maintenance: cur.maintenance.filter(m => !subjectsToRemove.has(m.subjectId)) }))
    if (user && isCanonicalOntologyId(groupId)) {
      void runOntologyAction('archive_subject_group', { groupId }).catch((error) => console.info('Koko Rhythm could not archive this group yet:', error))
    }
  }
  const toggleSubject = (groupId: string, subject: string) => {
    updatePlan(cur => ({ ...cur, groups: cur.groups.map(g => {
      const key = rhythmIdentity(subject)
      const hasSubject = g.subjects.some(item => rhythmIdentity(item.name) === key)
      if (g.id === groupId) return { ...g, subjects: hasSubject ? g.subjects.filter(item => rhythmIdentity(item.name) !== key) : [...g.subjects.filter(item => rhythmIdentity(item.name) !== key), cur.groups.flatMap(item => item.subjects).find(item => rhythmIdentity(item.name) === key) ?? createLocalRhythmSubject(subject)] }
      return { ...g, subjects: g.subjects.filter(item => rhythmIdentity(item.name) !== key) }
    }) }))
  }
  const setAnchor = (anchor: 'major'|'minor', value: string) => {
    updatePlan(cur => anchor === 'major'
      ? { ...cur, majorGroupId: value, minorGroupId: value && cur.minorGroupId === value ? '' : cur.minorGroupId }
      : { ...cur, minorGroupId: value, majorGroupId: value && cur.majorGroupId === value ? '' : cur.majorGroupId })
  }
  const addMaintenance = () => {
    if (!maintenanceSubject) return
    const subject = plan.groups.flatMap(group => group.subjects).find(item => rhythmIdentity(item.name) === rhythmIdentity(maintenanceSubject)) ?? createLocalRhythmSubject(maintenanceSubject)
    const item: RhythmMaintenance = { id: createRhythmId('maintenance'), subjectId: subject.id, subjectName: subject.name, minutes: maintenanceMinutes }
    updatePlan(cur => ({ ...cur, maintenance: [...cur.maintenance, item] }))
  }
  const removeMaintenance = (id: string) => {
    updatePlan(cur => ({ ...cur, maintenance: cur.maintenance.filter(m => m.id !== id) }))
    if (user && isCanonicalOntologyId(id)) {
      void runOntologyAction('deactivate_maintenance_practice', { practiceId: id }).catch((error) => console.info('Koko Rhythm could not remove this maintenance path yet:', error))
    }
  }

  if (!ready) return <main className="rh-page"><p className="planner-loading">opening your rhythm…</p></main>

  const panelTitle = activePanel === 'groups' ? 'Organize your subjects' : activePanel === 'anchors' ? 'Choose where your energy goes' : 'Keep a subject warm'

  return (
    <main className="rh-page">
      <div className="rh-shell">

        {/* Header */}
        <header className="rh-header">
          <div>
            <p className="eyebrow">energy-led planning system</p>
            <h1 className="rh-heading">Koko Rhythm<span>°</span></h1>
            <p className="rh-subhead">Choose one main focus, one secondary focus, and keep the rest warm.</p>
          </div>
          <div className="rh-header-actions">
            <span><Sparkles className="size-3.5" />your rhythm</span>
            <Link href="/planner">open planner <ArrowUpRight className="size-3.5" /></Link>
          </div>
        </header>

        {/* ── Row 1: Major + Minor, the two durable rhythm goals ─── */}
        <div className="rh-row rh-row-2">

          {/* Major Anchor */}
          <button type="button" className="rh-card rh-card--major" onClick={() => setActivePanel('anchors')}>
            <div className="rh-card-top">
              <p className="rh-eyebrow">main focus</p>
              <span className="rh-icon rh-icon--major"><Sparkles className="size-4" /></span>
            </div>
            <p className="rh-card-title">{majorGroup?.name || 'choose main focus'}</p>
            <p className="rh-card-meta">most of your energy · {majorGroup?.subjects.length ?? 0} subjects</p>
            {majorGroup?.subjects && majorGroup.subjects.length > 0 && (
              <div className="rh-subject-chips">
                {majorGroup.subjects.slice(0, 3).map(subject => <span key={subject.id}>{subject.name}</span>)}
                {majorGroup.subjects.length > 3 && <span>+{majorGroup.subjects.length - 3}</span>}
              </div>
            )}
            <span className="rh-card-cta">choose focus <ArrowUpRight className="size-3" /></span>
          </button>

          {/* Minor Anchor */}
          <button type="button" className="rh-card rh-card--minor" onClick={() => setActivePanel('anchors')}>
            <div className="rh-card-top">
              <p className="rh-eyebrow">secondary focus</p>
              <span className="rh-icon rh-icon--minor"><Leaf className="size-4" /></span>
            </div>
            <p className="rh-card-title">{minorGroup?.name || 'choose secondary focus'}</p>
            <p className="rh-card-meta">steady progress · {minorGroup?.subjects.length ?? 0} subjects</p>
            {minorGroup?.subjects && minorGroup.subjects.length > 0 && (
              <div className="rh-subject-chips">
                {minorGroup.subjects.slice(0, 3).map(subject => <span key={subject.id}>{subject.name}</span>)}
                {minorGroup.subjects.length > 3 && <span>+{minorGroup.subjects.length - 3}</span>}
              </div>
            )}
            <span className="rh-card-cta">choose focus <ArrowUpRight className="size-3" /></span>
          </button>
        </div>

        {/* ── Row 2: Focus Groups ─────────────────────────────────── */}
        <div className="rh-section-head">
          <div>
            <p className="rh-eyebrow">subject groups</p>
            <h2 className="rh-section-title">your {plan.groups.length} groups</h2>
          </div>
          <button type="button" className="rh-add-btn" onClick={() => setActivePanel('groups')}>
            <Plus className="size-3.5" />manage groups
          </button>
        </div>

        <div className="rh-groups-grid">
          {plan.groups.map(group => {
            const isMajor = group.id === plan.majorGroupId
            const isMinor = group.id === plan.minorGroupId
            return (
              <div key={group.id} className={`rh-group-card${isMajor ? ' is-major' : isMinor ? ' is-minor' : ''}`}>
                <div className="rh-group-head">
                  <span className="rh-group-name">{group.name}</span>
                  {isMajor && <span className="rh-anchor-badge rh-badge--major">major</span>}
                  {isMinor && <span className="rh-anchor-badge rh-badge--minor">minor</span>}
                </div>
                <div className="rh-group-subjects">
                  {group.subjects.length > 0
                    ? group.subjects.map(subject => <span key={subject.id}>{subject.name}</span>)
                    : <span className="rh-group-empty">no subjects linked</span>}
                </div>
              </div>
            )
          })}
          <button type="button" className="rh-group-card rh-group-add" onClick={() => setActivePanel('groups')}>
            <Plus className="size-5" />
            <span>add group</span>
          </button>
        </div>

        {/* ── Row 3: Maintenance ──────────────────────────────────── */}
        <div className="rh-section-head">
          <div>
            <p className="rh-eyebrow">keep warm</p>
            <h2 className="rh-section-title">small practice, no extra pressure</h2>
          </div>
          <button type="button" className="rh-add-btn" onClick={() => setActivePanel('maintenance')}>
            <Plus className="size-3.5" />add path
          </button>
        </div>

        <div className="rh-maintenance-row">
          {plan.maintenance.length === 0 ? (
            <button type="button" className="rh-maintenance-empty" onClick={() => setActivePanel('maintenance')}>
              <Droplets className="size-4" />
              <span>No maintenance paths yet — a little keeps things alive.</span>
            </button>
          ) : plan.maintenance.map(item => {
            return (
              <div key={item.id} className="rh-maintenance-pill">
                <Droplets className="size-3" />
                <span>{item.subjectName}</span>
                <span className="rh-maintenance-min">{item.minutes}m/day</span>
                <button type="button" className="rh-maintenance-del" aria-label="Remove" onClick={() => removeMaintenance(item.id)}>
                  <X className="size-3" />
                </button>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <footer className="rh-footer">
          <span><Sparkles className="size-3.5" />Your Rhythm guides attention. It never grades you.</span>
          <div>
            <i className="major" />major
            <i className="minor" />minor
            <i className="maintenance" />maintenance
          </div>
        </footer>
      </div>

      {/* ── Drawer (unchanged logic) ──────────────────────────────── */}
      {activePanel && (
        <div className="rhythm-drawer-layer" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !isSaving) void closeDrawer() }}>
          <aside className="rhythm-drawer" role="dialog" aria-modal="true" aria-labelledby="rhythm-drawer-title">
            <div className="rhythm-drawer-grip" aria-hidden />
            <header className="rhythm-drawer-header">
              <div><p className="eyebrow">koko rhythm studio</p><h2 id="rhythm-drawer-title">{panelTitle}</h2></div>
              <button type="button" aria-label="Close" onClick={() => { void closeDrawer() }} disabled={isSaving}><X className="size-4" /></button>
            </header>
            <nav className="rhythm-drawer-tabs" aria-label="Rhythm editor sections">
              {([['groups', BookOpen, 'Groups'], ['anchors', Sparkles, 'Anchors'], ['maintenance', Droplets, 'Maintain']] as const).map(([panel, Icon, label]) => (
                <button type="button" className={activePanel === panel ? 'active' : ''} key={panel} onClick={() => setActivePanel(panel)}>
                  <Icon className="size-3.5" />{label}
                </button>
              ))}
            </nav>

            <div className="rhythm-drawer-body">
              {activePanel === 'groups' && (
                <section className="rhythm-editor-groups">
                  <div className="rhythm-editor-note"><BookOpen className="size-4" /><span>Related subjects become one mental direction. A subject can live in one group at a time.</span></div>
                  <div className="rhythm-editor-group-list">
                    {plan.groups.map(group => (
                      <article className={`${group.id === plan.majorGroupId ? 'is-major' : ''} ${group.id === plan.minorGroupId ? 'is-minor' : ''}`} key={group.id}>
                        <div className="rhythm-editor-group-head">
                          <input aria-label={`Rename ${group.name}`} value={group.name} onChange={e => updatePlan(c => ({ ...c, groups: c.groups.map(g => g.id === group.id ? { ...g, name: e.target.value } : g) }))} />
                          <span>{group.id === plan.majorGroupId ? 'major' : group.id === plan.minorGroupId ? 'minor' : `${group.subjects.length} linked`}</span>
                          <button type="button" aria-label={`Remove ${group.name}`} onClick={() => removeGroup(group.id)} disabled={plan.groups.length <= 1}><Trash2 className="size-3.5" /></button>
                        </div>
                        <div className="rhythm-editor-subjects">
                          {studySubjects.map(subject => (
                            <button type="button" key={subject} className={group.subjects.some(item => rhythmIdentity(item.name) === rhythmIdentity(subject)) ? 'selected' : ''} onClick={() => toggleSubject(group.id, subject)}>
                              {group.subjects.some(item => rhythmIdentity(item.name) === rhythmIdentity(subject)) ? '✓' : '+'} {subject}
                            </button>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                  <form className="rhythm-editor-add-group" onSubmit={e => { e.preventDefault(); addGroup() }}>
                    <Plus className="size-4" />
                    <input aria-label="New focus group name" value={newGroupName} placeholder="Name a new constellation" onChange={e => setNewGroupName(e.target.value)} />
                    <button type="submit">create</button>
                  </form>
                  <form className="rhythm-editor-add-subject" onSubmit={e => { e.preventDefault(); addSubject() }}>
                    <div><Plus className="size-4" /><span>Add a study subject</span></div>
                    <input aria-label="New study subject" value={newSubjectName} maxLength={40} placeholder="e.g. SAT Math" onChange={e => setNewSubjectName(e.target.value)} />
                    <select aria-label="Group for new study subject" value={newSubjectGroupId} onChange={e => setNewSubjectGroupId(e.target.value)}>
                      {plan.groups.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}
                    </select>
                    <button type="submit" disabled={!newSubjectName.trim()}>add subject</button>
                  </form>
                  <p className="rhythm-editor-subject-hint">It will also appear in Focus and when you create a task.</p>
                  {unassignedSubjects.length > 0 && <p className="rhythm-editor-unassigned">Unassigned: {unassignedSubjects.join(' · ')}</p>}
                </section>
              )}

              {activePanel === 'anchors' && (
                <section className="rhythm-editor-anchors">
                  <p>Keep these two goals for weeks or months. Change them only when your real direction changes.</p>
                  <label className="major"><span><Sparkles className="size-5" /><b>Main focus</b><small>where most of your study energy goes</small></span><select autoFocus value={plan.majorGroupId} onChange={e => setAnchor('major', e.target.value)}><option value="">choose main focus</option>{plan.groups.map(g => <option value={g.id} key={g.id}>{g.name}</option>)}</select></label>
                  <div className="rhythm-editor-flow"><span />energy flows through today<span /></div>
                  <label className="minor"><span><Leaf className="size-5" /><b>Secondary focus</b><small>the other direction you want to move forward</small></span><select value={plan.minorGroupId} onChange={e => setAnchor('minor', e.target.value)}><option value="">choose secondary focus</option>{plan.groups.filter(g => g.id !== plan.majorGroupId).map(g => <option value={g.id} key={g.id}>{g.name}</option>)}</select></label>
                </section>
              )}

              {activePanel === 'maintenance' && (
                <section className="rhythm-editor-maintenance">
                  <div className="rhythm-editor-note"><Droplets className="size-4" /><span>Keep a path warm without turning it into another commitment. Maximum 20 minutes.</span></div>
                  <div className="rhythm-editor-maintenance-add">
                    <select autoFocus aria-label="Maintenance subject" value={maintenanceSubject} onChange={e => setMaintenanceSubject(e.target.value)}><option value="">choose a subject</option>{availableMaintenanceSubjects.map(subject => <option value={subject} key={subject}>{subject}</option>)}</select>
                    <select aria-label="Maintenance minutes" value={maintenanceMinutes} onChange={e => setMaintenanceMinutes(Number(e.target.value) as 5|10|15|20)}><option value={5}>5 min</option><option value={10}>10 min</option><option value={15}>15 min</option><option value={20}>20 min</option></select>
                    <button type="button" onClick={addMaintenance} disabled={!maintenanceSubject}><Plus className="size-4" />add</button>
                  </div>
                  <div className="rhythm-editor-maintenance-list">
                    {plan.maintenance.map(item => (
                      <div key={item.id}>
                        <span><Droplets className="size-4" /><b>{item.subjectName}</b></span>
                        <small>{item.minutes} min / day</small>
                        <button type="button" aria-label="Remove maintenance path" onClick={() => removeMaintenance(item.id)}><Trash2 className="size-3.5" /></button>
                      </div>
                    ))}
                    {!plan.maintenance.length && <p>No maintenance paths yet. The empty space is intentional.</p>}
                  </div>
                </section>
              )}
            </div>

            <footer className="rhythm-drawer-footer">
              <span><SlidersHorizontal className="size-3.5" />{isSaving ? 'saving your rhythm…' : 'changes save automatically'}</span>
              <button type="button" onClick={() => { void closeDrawer() }} disabled={isSaving}>{isSaving ? 'saving…' : 'done'} <ArrowRight className="size-3.5" /></button>
            </footer>
            {saveError && <p className="rhythm-save-error" role="alert">{saveError} <button type="button" onClick={retryPlanSave}>retry</button></p>}
          </aside>
        </div>
      )}
    </main>
  )
}
