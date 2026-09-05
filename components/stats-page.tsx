'use client'

import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { getLocalStudyAnomalies, loadCanonicalSubjectLogs, loadStudyIntervals, loadStudyLogs, loadSubjectLogs, getLocalSubjects, repairStudyIncident, type DayLog, type SubjectDayLogs, type StudyInterval, type SuspiciousStudyDay } from '../lib/storage'
import { loadPlannerData, type PlannerData } from '../lib/planner-storage'
import { loadOntologySnapshot } from '../lib/ontology-client'
import { StatsInsights, type StatsRange } from './stats-insights'
import { SubjectAnalytics, type CanonicalSubjectAnalytics } from './subject-analytics'
import { loadKokoRhythmPlan, RHYTHM_UPDATED_EVENT, type KokoRhythmPlan } from '../lib/rhythm-storage'

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

  useEffect(() => {
    let requestId = 0
    const loadData = async (nextUser: User | null) => {
      const currentRequestId = ++requestId
      const [nextLogs, nextIntervals, nextPlanner, canonicalLogs, ontology] = await Promise.all([
        loadStudyLogs(nextUser), loadStudyIntervals(nextUser), loadPlannerData(nextUser), loadCanonicalSubjectLogs(nextUser),
        nextUser ? loadOntologySnapshot().catch(() => null) : Promise.resolve(null),
      ])
      const nextSubjectLogs = await loadSubjectLogs(nextUser, nextLogs)
      if (currentRequestId !== requestId) return
      const incidents = getLocalStudyAnomalies(nextUser)
      setLogs(nextLogs)
      setSuspiciousDays(incidents)
      setSubjectLogs(nextSubjectLogs)
      setIntervals(nextIntervals)
      setPlanner(nextPlanner)
      setSubjects((previous) => Array.from(new Set([...previous, ...getLocalSubjects(nextUser), ...Object.keys(nextSubjectLogs)])))
      if (!ontology || !canonicalLogs.length) {
        setCanonicalSubjects([])
        return
      }
      const subjectNameById = new Map(ontology.subjects.map((subject) => [String(subject.id), typeof subject.name === 'string' ? subject.name : 'General']))
      const groupNameById = new Map(ontology.groups.map((group) => [String(group.id), typeof group.name === 'string' ? group.name : '']))
      const groupsBySubjectId = new Map<string, string[]>()
      for (const membership of ontology.memberships) {
        const groupName = groupNameById.get(membership.group_id)
        if (!groupName) continue
        groupsBySubjectId.set(membership.subject_id, [...(groupsBySubjectId.get(membership.subject_id) ?? []), groupName])
      }
      setCanonicalSubjects(incidents.length ? [] : canonicalLogs.map((entry) => ({
        id: entry.subjectId,
        name: subjectNameById.get(entry.subjectId) ?? entry.subjectName,
        days: entry.days,
        groups: groupsBySubjectId.get(entry.subjectId) ?? [],
      })))
    }
    supabase.auth.getSession().then(({ data }) => {
      const nextUser = data.session?.user ?? null
      setUser(nextUser)
      setLogs({})
      setSubjectLogs({})
      setIntervals([])
      setPlanner({ tasks: [], events: [] })
      setSubjects(['General'])
      setCanonicalSubjects([])
      void loadData(nextUser)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null
      setUser(nextUser)
      setLogs({})
      setSubjectLogs({})
      setIntervals([])
      setPlanner({ tasks: [], events: [] })
      setSubjects(['General'])
      void loadData(nextUser)
    })
    return () => { requestId += 1; listener.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    const refreshRhythm = () => setRhythmPlan(loadKokoRhythmPlan(user))
    refreshRhythm()
    window.addEventListener(RHYTHM_UPDATED_EVENT, refreshRhythm)
    return () => window.removeEventListener(RHYTHM_UPDATED_EVENT, refreshRhythm)
  }, [user])

  const handleRepair = async (incident: SuspiciousStudyDay, minutes: number) => {
    await repairStudyIncident(user, incident, minutes)
    const [nextLogs, nextIntervals] = await Promise.all([loadStudyLogs(user), loadStudyIntervals(user)])
    const nextSubjectLogs = await loadSubjectLogs(user, nextLogs)
    setLogs(nextLogs)
    setSubjectLogs(nextSubjectLogs)
    setIntervals(nextIntervals)
    setSuspiciousDays(getLocalStudyAnomalies(user))
  }

  return <main className="min-h-screen overflow-hidden px-4 py-7 pb-28 text-ink sm:px-8 lg:px-12"><div className="mx-auto max-w-7xl"><StatsInsights logs={logs} intervals={intervals} subjectLogs={subjectLogs} tasks={planner.tasks} rhythmPlan={rhythmPlan} range={range} onRangeChange={setRange} suspiciousDays={suspiciousDays} onRepairDay={handleRepair} /><SubjectAnalytics subjectLogs={subjectLogs} subjects={subjects} canonicalSubjects={canonicalSubjects} range={range} /></div></main>
}
