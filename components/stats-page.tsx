'use client'

import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { getLocalStudyAnomalies, loadStudyStatsSnapshot, getLocalSubjects, repairStudyIncident, type DayLog, type SubjectDayLogs, type StudyInterval, type SuspiciousStudyDay, type CanonicalSubjectDayLog } from '../lib/storage'
import { loadPlannerData, type PlannerData } from '../lib/planner-storage'
import { loadOntologySnapshot } from '../lib/ontology-client'
import { StatsInsights, type StatsRange } from './stats-insights'
import { SubjectAnalytics, type CanonicalSubjectAnalytics } from './subject-analytics'
import { createDefaultKokoRhythmPlan, loadKokoRhythmPlan, RHYTHM_UPDATED_EVENT, saveKokoRhythmPlan, type KokoRhythmPlan } from '../lib/rhythm-storage'
import { loadRhythmPlanFromOntology } from '../lib/rhythm-ontology'

export function StatsPage() {
  const [logs, setLogs] = useState<DayLog>({})
  const [intervals, setIntervals] = useState<StudyInterval[]>([])
  const [subjectLogs, setSubjectLogs] = useState<SubjectDayLogs>({})
  const [subjects, setSubjects] = useState<string[]>(['General'])
  const [canonicalSubjects, setCanonicalSubjects] = useState<CanonicalSubjectAnalytics[]>([])
  const [planner, setPlanner] = useState<PlannerData>({ tasks: [], events: [] })
  const [range, setRange] = useState<StatsRange>('days')
  const [user, setUser] = useState<User | null>(null)
  const [suspiciousDays, setSuspiciousDays] = useState<SuspiciousStudyDay[]>([])
  const [rhythmPlan, setRhythmPlan] = useState<KokoRhythmPlan | null>(null)

  const buildCanonicalSubjects = (entries: CanonicalSubjectDayLog[], ontology: Awaited<ReturnType<typeof loadOntologySnapshot>> | null, incidents: SuspiciousStudyDay[]) => {
    if (!entries.length || incidents.length) return []
    const subjectNameById = new Map((ontology?.subjects ?? []).map((subject) => [String(subject.id), typeof subject.name === 'string' ? subject.name : 'General']))
    const subjectIdByIdentity = new Map((ontology?.subjects ?? []).flatMap((subject) => {
      const id = String(subject.id ?? '')
      const name = typeof subject.name === 'string' ? subject.name : ''
      return id && name ? [[name.trim().normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase(), id] as const] : []
    }))
    const groupNameById = new Map((ontology?.groups ?? []).map((group) => [String(group.id), typeof group.name === 'string' ? group.name : '']))
    const groupsBySubjectId = new Map<string, string[]>()
    for (const membership of ontology?.memberships ?? []) {
      const groupName = groupNameById.get(membership.group_id)
      if (!groupName) continue
      groupsBySubjectId.set(membership.subject_id, [...(groupsBySubjectId.get(membership.subject_id) ?? []), groupName])
    }
    // Old sessions may have no subject_id while new sessions do. Merge those
    // two representations by normalized display name so one subject never
    // appears twice in the learner's breakdown.
    const merged = new Map<string, CanonicalSubjectAnalytics>()
    for (const entry of entries) {
      const displayName = subjectNameById.get(entry.subjectId) ?? entry.subjectName
      const identity = displayName.trim().normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase()
      const id = subjectIdByIdentity.get(identity) ?? entry.subjectId
      const current = merged.get(id) ?? { id, name: subjectNameById.get(id) ?? displayName, days: {}, groups: groupsBySubjectId.get(id) ?? [] }
      for (const [dateKey, minutes] of Object.entries(entry.days)) current.days[dateKey] = (current.days[dateKey] ?? 0) + minutes
      merged.set(id, current)
    }
    return [...merged.values()]
  }

  useEffect(() => {
    let requestId = 0
    let loadedScope: string | null = null
    const loadData = async (nextUser: User | null) => {
      const currentRequestId = ++requestId
      const [studySnapshot, nextPlanner, ontology] = await Promise.all([
        loadStudyStatsSnapshot(nextUser), loadPlannerData(nextUser),
        nextUser ? loadOntologySnapshot().catch(() => null) : Promise.resolve(null),
      ])
      if (currentRequestId !== requestId) return
      const incidents = getLocalStudyAnomalies(nextUser)
      setLogs(studySnapshot.logs)
      setSuspiciousDays(incidents)
      setSubjectLogs(studySnapshot.subjectLogs)
      setIntervals(studySnapshot.intervals)
      setPlanner(nextPlanner)
      setSubjects((previous) => Array.from(new Set([...previous, ...getLocalSubjects(nextUser), ...Object.keys(studySnapshot.subjectLogs), ...(ontology?.subjects ?? []).flatMap((subject) => typeof subject.name === 'string' ? [subject.name] : [])])))
      setCanonicalSubjects(buildCanonicalSubjects(studySnapshot.canonicalSubjectLogs, ontology, incidents))
    }
    const applyUser = (nextUser: User | null) => {
      const nextScope = nextUser?.id ?? 'guest'
      // Supabase emits INITIAL_SESSION as well as getSession() resolving.
      // Loading both used to double every Stats request on first paint.
      if (loadedScope === nextScope) return
      loadedScope = nextScope
      setUser(nextUser)
      setLogs({})
      setSubjectLogs({})
      setIntervals([])
      setPlanner({ tasks: [], events: [] })
      setSubjects(['General'])
      setCanonicalSubjects([])
      void loadData(nextUser)
    }
    supabase.auth.getSession().then(({ data }) => applyUser(data.session?.user ?? null))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      applyUser(session?.user ?? null)
    })
    return () => { requestId += 1; listener.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    let active = true
    const refreshRhythm = () => setRhythmPlan(loadKokoRhythmPlan(user))
    refreshRhythm()
    if (user) void loadRhythmPlanFromOntology(createDefaultKokoRhythmPlan(subjects)).then((cloudPlan) => {
      if (!active || !cloudPlan) return
      saveKokoRhythmPlan(user, cloudPlan)
      setRhythmPlan(cloudPlan)
    }).catch(() => {})
    window.addEventListener(RHYTHM_UPDATED_EVENT, refreshRhythm)
    return () => { active = false; window.removeEventListener(RHYTHM_UPDATED_EVENT, refreshRhythm) }
  }, [subjects, user])

  const handleRepair = async (incident: SuspiciousStudyDay, minutes: number) => {
    await repairStudyIncident(user, incident, minutes)
    const [studySnapshot, ontology] = await Promise.all([
      loadStudyStatsSnapshot(user),
      user ? loadOntologySnapshot().catch(() => null) : Promise.resolve(null),
    ])
    const incidents = getLocalStudyAnomalies(user)
    setLogs(studySnapshot.logs)
    setSubjectLogs(studySnapshot.subjectLogs)
    setIntervals(studySnapshot.intervals)
    setSuspiciousDays(incidents)
    setCanonicalSubjects(buildCanonicalSubjects(studySnapshot.canonicalSubjectLogs, ontology, incidents))
  }

  return <main className="min-h-screen overflow-hidden px-4 py-7 pb-28 text-ink sm:px-8 lg:px-12"><div className="mx-auto max-w-7xl"><StatsInsights logs={logs} intervals={intervals} subjectLogs={subjectLogs} tasks={planner.tasks} rhythmPlan={rhythmPlan} range={range} onRangeChange={setRange} suspiciousDays={suspiciousDays} onRepairDay={handleRepair} /><SubjectAnalytics subjectLogs={subjectLogs} subjects={subjects} canonicalSubjects={canonicalSubjects} range={range} /></div></main>
}
