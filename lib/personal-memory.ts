export type MemoryKind = 'preference' | 'learning'
export type MemoryStatus = 'proposed' | 'active' | 'rejected' | 'archived'
export type MemoryType = 'explicit' | 'observed' | 'temporary' | 'sensitive'

export type PersonalMemoryItem = {
  id: string
  kind: MemoryKind
  status: MemoryStatus
  content: string
  source: 'web' | 'line' | 'agent' | 'system'
  confidence: number
  memoryType: MemoryType
  evidence?: string
  expiresAt?: string
  createdAt: string
  updatedAt: string
}

export type PersonalMemorySettings = {
  enabled: boolean
  writeApprovalRequired: boolean
}

export type PersonalMemorySnapshot = {
  settings: PersonalMemorySettings
  active: PersonalMemoryItem[]
  proposed: PersonalMemoryItem[]
}

// Memory is injected into an LLM prompt, so reject content that looks like an
// instruction, credential, or prompt-escape rather than a compact user fact.
export function isSafeMemoryContent(content: string) {
  const lower = content.toLocaleLowerCase()
  return !/(ignore (all|previous)|system prompt|developer message|api[_ -]?key|password|secret|<script|```)/i.test(lower)
}

export function memoryContentKey(content: string) {
  let hash = 2166136261
  for (const char of content.trim().toLocaleLowerCase()) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return `m_${(hash >>> 0).toString(16)}`
}
