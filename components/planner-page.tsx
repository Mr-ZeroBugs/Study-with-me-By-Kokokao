'use client'

import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { getLocalSubjects, loadSubjectLogs } from '../lib/storage'
import {
  createSharedWorkspace,
  deleteSharedWorkspace,
  joinSharedWorkspace,
  leaveSharedWorkspace,
  loadSharedWorkspaceMembers,
  loadSharedWorkspaces,
  type SharedWorkspace,
  type SharedWorkspaceMember,
} from '../lib/planner-storage'
import { PlannerHub, type PlannerSection } from './planner-hub'

export function PlannerPage({ section }: { section: PlannerSection }) {
  const [user, setUser] = useState<User | null>(null)
  const [subjects, setSubjects] = useState<string[]>(['General'])
  const [authReady, setAuthReady] = useState(false)
  const [workspaces, setWorkspaces] = useState<SharedWorkspace[]>([])
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [workspaceMembers, setWorkspaceMembers] = useState<SharedWorkspaceMember[]>([])
  const [workspaceMembersLoading, setWorkspaceMembersLoading] = useState(false)

  useEffect(() => {
    let requestId = 0
    const loadContext = async (nextUser: User | null) => {
      const currentRequestId = ++requestId
      const [logs, nextWorkspaces] = await Promise.all([
        loadSubjectLogs(nextUser),
        loadSharedWorkspaces(nextUser),
      ])
      if (currentRequestId !== requestId) return
      setSubjects((previous) => Array.from(new Set([...previous, ...getLocalSubjects(nextUser), ...Object.keys(logs)])))
      setWorkspaces(nextWorkspaces)
      setWorkspaceId((previous) => nextWorkspaces.some((workspace) => workspace.id === previous) ? previous : null)
    }

    supabase.auth.getSession().then(({ data }) => {
      const nextUser = data.session?.user ?? null
      setUser(nextUser)
      setAuthReady(true)
      setSubjects(['General'])
      setWorkspaces([])
      setWorkspaceId(null)
      setWorkspaceError(null)
      void loadContext(nextUser)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null
      setUser(nextUser)
      setAuthReady(true)
      setSubjects(['General'])
      setWorkspaces([])
      setWorkspaceId(null)
      setWorkspaceError(null)
      void loadContext(nextUser)
    })
    return () => { requestId += 1; listener.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    let active = true
    if (!user || !workspaceId) {
      setWorkspaceMembers([])
      setWorkspaceMembersLoading(false)
      return () => { active = false }
    }
    setWorkspaceMembersLoading(true)
    void loadSharedWorkspaceMembers(user, workspaceId).then((members) => {
      if (active) setWorkspaceMembers(members)
    }).finally(() => {
      if (active) setWorkspaceMembersLoading(false)
    })
    return () => { active = false }
  }, [user, workspaceId])

  const handleWorkspaceChange = (nextWorkspaceId: string | null) => {
    setWorkspaceError(null)
    setWorkspaceId(nextWorkspaceId)
  }

  const handleCreateWorkspace = async (name: string) => {
    if (!user) throw new Error('Sign in before creating a shared space.')
    setWorkspaceLoading(true)
    setWorkspaceError(null)
    try {
      const created = await createSharedWorkspace(user, name)
      setWorkspaces((previous) => [...previous.filter((workspace) => workspace.id !== created.id), created])
      setWorkspaceId(created.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not create the shared space.'
      setWorkspaceError(message)
      throw error
    } finally {
      setWorkspaceLoading(false)
    }
  }

  const handleJoinWorkspace = async (inviteCode: string) => {
    if (!user) throw new Error('Sign in before joining a shared space.')
    setWorkspaceLoading(true)
    setWorkspaceError(null)
    try {
      const joined = await joinSharedWorkspace(user, inviteCode)
      setWorkspaces((previous) => [...previous.filter((workspace) => workspace.id !== joined.id), joined])
      setWorkspaceId(joined.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not join the shared space.'
      setWorkspaceError(message)
      throw error
    } finally {
      setWorkspaceLoading(false)
    }
  }

  const removeWorkspaceFromContext = (removedWorkspaceId: string) => {
    setWorkspaces((previous) => previous.filter((workspace) => workspace.id !== removedWorkspaceId))
    setWorkspaceMembers([])
    setWorkspaceId((previous) => previous === removedWorkspaceId ? null : previous)
  }

  const handleLeaveWorkspace = async (removedWorkspaceId: string) => {
    if (!user) throw new Error('Sign in before leaving a shared space.')
    setWorkspaceLoading(true)
    setWorkspaceError(null)
    try {
      await leaveSharedWorkspace(user, removedWorkspaceId)
      removeWorkspaceFromContext(removedWorkspaceId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not leave the shared space.'
      setWorkspaceError(message)
      throw error
    } finally {
      setWorkspaceLoading(false)
    }
  }

  const handleDeleteWorkspace = async (removedWorkspaceId: string) => {
    if (!user) throw new Error('Sign in before deleting a shared space.')
    setWorkspaceLoading(true)
    setWorkspaceError(null)
    try {
      await deleteSharedWorkspace(user, removedWorkspaceId)
      removeWorkspaceFromContext(removedWorkspaceId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not delete the shared space.'
      setWorkspaceError(message)
      throw error
    } finally {
      setWorkspaceLoading(false)
    }
  }

  if (!authReady) return <main className="min-h-screen px-4 py-7 pb-28 text-ink sm:px-8 lg:px-12"><div className="mx-auto max-w-7xl"><p className="planner-loading">opening your planner…</p></div></main>

  return <main className="min-h-screen overflow-hidden px-4 py-7 pb-28 text-ink sm:px-8 lg:px-12"><div className="mx-auto max-w-7xl"><PlannerHub user={user} subjects={subjects} section={section} workspaces={workspaces} workspaceId={workspaceId} onWorkspaceChange={handleWorkspaceChange} onCreateWorkspace={handleCreateWorkspace} onJoinWorkspace={handleJoinWorkspace} onLeaveWorkspace={handleLeaveWorkspace} onDeleteWorkspace={handleDeleteWorkspace} workspaceMembers={workspaceMembers} workspaceMembersLoading={workspaceMembersLoading} workspaceLoading={workspaceLoading} workspaceError={workspaceError} onUserChange={setUser} /></div></main>
}
