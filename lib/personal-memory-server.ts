import type { SupabaseClient } from '@supabase/supabase-js'
import { isSafeMemoryContent, memoryContentKey, type MemoryKind } from '@/lib/personal-memory'

export type PromptMemory = { kind: 'preference' | 'learning'; content: string }

// This is intentionally a narrow read model for the assistant. It has no
// workspace input and never returns proposals, rejected items, or transcripts.
export async function loadApprovedPersonalMemory(client: SupabaseClient, userId: string): Promise<PromptMemory[]> {
  const { data: setting } = await client
    .from('user_memory_settings')
    .select('enabled')
    .eq('user_id', userId)
    .maybeSingle()
  if (setting?.enabled === false) return []

  const result = await client
    .from('user_memory_items')
    .select('kind, content, memory_type, expires_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(8)
  let rows: Array<{ kind?: unknown; content?: unknown; memory_type?: unknown; expires_at?: unknown }> = result.data ?? []
  if (result.error && /memory_type|expires_at|schema cache|column/i.test(result.error.message)) {
    const fallback = await client.from('user_memory_items').select('kind, content').eq('user_id', userId).eq('status', 'active').order('updated_at', { ascending: false }).limit(8)
    if (fallback.error) return []
    rows = fallback.data ?? []
  } else if (result.error) return [] // migration rollout must never interrupt LINE replies

  return rows
    .filter((item) => {
      const type = typeof item.memory_type === 'string' ? item.memory_type : 'explicit'
      const expiresAt = typeof item.expires_at === 'string' ? Date.parse(item.expires_at) : Number.NaN
      return type !== 'sensitive' && (!Number.isFinite(expiresAt) || expiresAt > Date.now()) && (item.kind === 'preference' || item.kind === 'learning') && typeof item.content === 'string' && isSafeMemoryContent(item.content)
    })
    .map((item) => ({ kind: item.kind as PromptMemory['kind'], content: (item.content as string).trim().slice(0, 360) }))
}

// AI-originated notes are deliberately staged: normal use creates a proposal,
// never a silent user profile change. The opt-out setting is an explicit choice.
export async function stagePersonalMemoryProposal(
  client: SupabaseClient,
  userId: string,
  proposal: { kind: MemoryKind; content: string } | null | undefined,
) {
  if (!proposal || !isSafeMemoryContent(proposal.content)) return
  const content = proposal.content.trim().slice(0, 360)
  if (!content) return

  const { data: setting } = await client
    .from('user_memory_settings')
    .select('enabled, write_approval_required')
    .eq('user_id', userId)
    .maybeSingle()
  if (setting?.enabled === false) return

  const contentKey = memoryContentKey(content)
  const { data: existing } = await client
    .from('user_memory_items')
    .select('id')
    .eq('user_id', userId)
    .eq('content_key', contentKey)
    .maybeSingle()
  if (existing) return

  const { count } = await client
    .from('user_memory_items')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('status', ['active', 'proposed'])
  if ((count ?? 0) >= 50) return

  const approved = setting?.write_approval_required === false
  await client.from('user_memory_items').insert({
    user_id: userId,
    kind: proposal.kind,
    content,
    content_key: contentKey,
    source: 'agent',
    confidence: 0.7,
    status: approved ? 'active' : 'proposed',
    approved_at: approved ? new Date().toISOString() : null,
  })
}
import 'server-only'
