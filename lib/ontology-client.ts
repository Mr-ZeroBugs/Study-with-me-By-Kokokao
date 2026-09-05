import { supabase } from './supabase'
import type { KokoActionName } from './ontology'

export type OntologySnapshot = {
  userId: string
  subjects: Array<Record<string, unknown>>
  groups: Array<Record<string, unknown>>
  memberships: Array<{ group_id: string; subject_id: string; created_at: string }>
  rhythmGoals: Array<Record<string, unknown>>
  maintenance: Array<Record<string, unknown>>
}

async function authorizedOntologyRequest(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sign in is required.')

  const response = await fetch(`/api/ontology${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Koko Ontology request failed.')
  return payload
}

export async function loadOntologySnapshot(): Promise<OntologySnapshot> {
  return authorizedOntologyRequest('')
}

export async function runOntologyAction<TData = Record<string, unknown>>(
  action: KokoActionName,
  input: Record<string, unknown>,
  requestId = crypto.randomUUID(),
): Promise<TData> {
  const payload = await authorizedOntologyRequest('', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, input, requestId }),
  })
  return payload.data as TData
}

/** Resolve a display name to one canonical subject, creating it when needed. */
export async function ensureOntologySubject(name: string): Promise<string> {
  const cleanName = name.trim()
  if (!cleanName) throw new Error('A subject name is required.')
  const snapshot = await loadOntologySnapshot()
  const existing = snapshot.subjects.find((subject) => subject.name === cleanName && typeof subject.id === 'string')
  if (existing?.id && typeof existing.id === 'string') return existing.id
  const created = await runOntologyAction<Record<string, unknown>>('create_subject', { name: cleanName })
  if (typeof created.id !== 'string') throw new Error('Koko could not resolve this subject.')
  return created.id
}
