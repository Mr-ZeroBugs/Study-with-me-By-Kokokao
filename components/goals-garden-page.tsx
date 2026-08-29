'use client'

import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { getLocalSubjects, loadSubjectLogs } from '../lib/storage'
import { GoalsGarden } from './goals-garden'

export function GoalsGardenPage() {
  const [user, setUser] = useState<User | null>(null)
  const [subjects, setSubjects] = useState<string[]>(['General'])
  const [authReady, setAuthReady] = useState(false)

  useEffect(() => {
    let requestId = 0
    const loadSubjects = async (nextUser: User | null) => {
      const currentRequestId = ++requestId
      const logs = await loadSubjectLogs(nextUser)
      if (currentRequestId !== requestId) return
      setSubjects((previous) => Array.from(new Set([...previous, ...getLocalSubjects(nextUser), ...Object.keys(logs)])))
    }

    supabase.auth.getSession().then(({ data }) => {
      const nextUser = data.session?.user ?? null
      setUser(nextUser)
      setAuthReady(true)
      setSubjects(['General'])
      void loadSubjects(nextUser)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null
      setUser(nextUser)
      setAuthReady(true)
      setSubjects(['General'])
      void loadSubjects(nextUser)
    })
    return () => { requestId += 1; listener.subscription.unsubscribe() }
  }, [])

  if (!authReady) return <main className="min-h-screen px-4 py-7 pb-28 text-ink sm:px-8 lg:px-12"><p className="planner-loading">opening your garden…</p></main>

  return <GoalsGarden user={user} subjects={subjects} />
}
