import { supabase } from './supabase'
import type { MemoryKind, MemoryType, PersonalMemorySnapshot } from './personal-memory'

async function request(init?: RequestInit) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sign in is required.')
  const response = await fetch('/api/memory', {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Personal memory request failed.')
  return payload
}

export async function loadPersonalMemory(): Promise<PersonalMemorySnapshot> {
  return request()
}

export async function proposePersonalMemory(
  kind: MemoryKind,
  content: string,
  options?: { memoryType?: Extract<MemoryType, 'explicit' | 'temporary'>; expiresAt?: string },
) {
  return request({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'propose', kind, content, ...options }),
  })
}

export async function reviewPersonalMemory(id: string, decision: 'approve' | 'reject') {
  return request({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'review', id, decision }) })
}

export async function updatePersonalMemory(id: string, kind: MemoryKind, content: string) {
  return request({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', id, kind, content }) })
}

export async function deletePersonalMemory(id: string) {
  return request({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) })
}

export async function savePersonalMemorySettings(enabled: boolean, writeApprovalRequired: boolean) {
  return request({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'settings', enabled, writeApprovalRequired }) })
}
