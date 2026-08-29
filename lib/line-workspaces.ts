import type { SupabaseClient } from '@supabase/supabase-js'

export type LineWorkspaceContext = {
  ids: string[]
  names: Record<string, string>
}

const emptyContext = (): LineWorkspaceContext => ({ ids: [], names: {} })

/** Resolve the shared spaces a linked LINE user belongs to. */
export async function loadLineWorkspaceContext(admin: SupabaseClient, userId: string): Promise<LineWorkspaceContext> {
  try {
    const { data: memberships, error: membershipError } = await admin
      .from('shared_workspace_members')
      .select('workspace_id')
      .eq('user_id', userId)

    if (membershipError || !memberships?.length) return emptyContext()

    const ids = Array.from(new Set(memberships
      .map((row) => row.workspace_id)
      .filter((id): id is string => typeof id === 'string' && Boolean(id))))
    if (!ids.length) return emptyContext()

    const { data: workspaces, error: workspaceError } = await admin
      .from('shared_workspaces')
      .select('id, name')
      .in('id', ids)

    if (workspaceError || !workspaces) return { ids, names: {} }
    return {
      ids,
      names: Object.fromEntries(workspaces.map((workspace) => [workspace.id, workspace.name])),
    }
  } catch (error) {
    // Shared planner support is additive; keep personal LINE features usable
    // when an older database has not received those tables yet.
    console.warn('LINE shared workspace lookup unavailable:', error)
    return emptyContext()
  }
}

export function decorateLineWorkspaceRow<T extends Record<string, unknown>>(row: T, context: LineWorkspaceContext): T & { workspace_name?: string } {
  const workspaceId = typeof row.workspace_id === 'string' ? row.workspace_id : ''
  const workspaceName = workspaceId ? context.names[workspaceId] : undefined
  return workspaceName ? { ...row, workspace_name: workspaceName } : row
}
