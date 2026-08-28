'use client'

import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { getLocalSubjects, loadSubjectLogs } from '../lib/storage'
import { GoalsGarden } from './goals-garden'

export function GoalsGardenPage() {
  const [user, setUser] = useState<User | null>(null)
  const [subjects, setSubjects] = useState<string[]>(['General'])

  useEffect(() => {
    setSubjects(getLocalSubjects())
    const loadSubjects = async (nextUser: User | null) => {
      const logs = await loadSubjectLogs(nextUser)
      setSubjects((previous) => Array.from(new Set([...previous, ...getLocalSubjects(), ...Object.keys(logs)])))
    }

    supabase.auth.getSession().then(({ data }) => {
      const nextUser = data.session?.user ?? null
      setUser(nextUser)
      void loadSubjects(nextUser)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null
      setUser(nextUser)
      void loadSubjects(nextUser)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  return <GoalsGarden user={user} subjects={subjects} />
}
