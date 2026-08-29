'use client'

import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { loadStudyIntervals, loadStudyLogs, loadSubjectLogs, getLocalSubjects, type DayLog, type SubjectDayLogs, type StudyInterval } from '../lib/storage'
import { StatsInsights, type StatsRange } from './stats-insights'
import { SubjectAnalytics } from './subject-analytics'

export function StatsPage() {
  const [logs, setLogs] = useState<DayLog>({})
  const [intervals, setIntervals] = useState<StudyInterval[]>([])
  const [subjectLogs, setSubjectLogs] = useState<SubjectDayLogs>({})
  const [subjects, setSubjects] = useState<string[]>(['General'])
  const [range, setRange] = useState<StatsRange>('days')

  useEffect(() => {
    let requestId = 0
    const loadData = async (nextUser: User | null) => {
      const currentRequestId = ++requestId
      const [nextLogs, nextSubjectLogs, nextIntervals] = await Promise.all([loadStudyLogs(nextUser), loadSubjectLogs(nextUser), loadStudyIntervals(nextUser)])
      if (currentRequestId !== requestId) return
      setLogs(nextLogs)
      setSubjectLogs(nextSubjectLogs)
      setIntervals(nextIntervals)
      setSubjects((previous) => Array.from(new Set([...previous, ...getLocalSubjects(nextUser), ...Object.keys(nextSubjectLogs)])))
    }
    supabase.auth.getSession().then(({ data }) => {
      const nextUser = data.session?.user ?? null
      setLogs({})
      setSubjectLogs({})
      setIntervals([])
      setSubjects(['General'])
      void loadData(nextUser)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null
      setLogs({})
      setSubjectLogs({})
      setIntervals([])
      setSubjects(['General'])
      void loadData(nextUser)
    })
    return () => { requestId += 1; listener.subscription.unsubscribe() }
  }, [])

  return <main className="min-h-screen overflow-hidden px-4 py-7 pb-28 text-ink sm:px-8 lg:px-12"><div className="mx-auto max-w-7xl"><StatsInsights logs={logs} intervals={intervals} range={range} onRangeChange={setRange} /><SubjectAnalytics subjectLogs={subjectLogs} subjects={subjects} range={range} /></div></main>
}
