import 'server-only'

import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export type ManagerAction =
  | 'manager_inbox_apply'
  | 'manager_inbox_undo'
  | 'adaptive_reschedule_overdue'
  | 'adaptive_split_task'
  | 'adaptive_update_estimate'
  | 'adaptive_undo'

export type ActionRisk = 'low' | 'medium' | 'high'

type ActionPolicy = {
  risk: ActionRisk
  confirmationRequired: boolean
  personalOnly: boolean
  undoable: boolean
}

const POLICIES: Record<ManagerAction, ActionPolicy> = {
  manager_inbox_apply: { risk: 'medium', confirmationRequired: true, personalOnly: false, undoable: true },
  manager_inbox_undo: { risk: 'high', confirmationRequired: true, personalOnly: false, undoable: false },
  adaptive_reschedule_overdue: { risk: 'high', confirmationRequired: true, personalOnly: true, undoable: true },
  adaptive_split_task: { risk: 'high', confirmationRequired: true, personalOnly: true, undoable: true },
  adaptive_update_estimate: { risk: 'medium', confirmationRequired: true, personalOnly: true, undoable: true },
  adaptive_undo: { risk: 'high', confirmationRequired: true, personalOnly: true, undoable: false },
}

export class ManagerActionError extends Error {}

export function managerActionPolicy(action: ManagerAction) {
  return POLICIES[action]
}

/**
 * Every mutable manager flow enters through these two assertions. The UI's
 * final button is the confirmation, but the server still requires an explicit
 * marker so a future model or background job cannot call a write path by
 * accident.
 */
export function requireConfirmedManagerAction(action: ManagerAction, confirmed: unknown) {
  const policy = managerActionPolicy(action)
  if (policy.confirmationRequired && confirmed !== true) {
    throw new ManagerActionError('Review this change and confirm it before Koko updates your planner.')
  }
}

export function requirePersonalManagerScope(action: ManagerAction, workspaceId: unknown) {
  const policy = managerActionPolicy(action)
  if (policy.personalOnly && workspaceId) {
    throw new ManagerActionError('Koko cannot change a Team Space item through this personal manager action.')
  }
}

export function managerRequestId(value: unknown) {
  const candidate = typeof value === 'string' ? value.trim().slice(0, 120) : ''
  return candidate || crypto.randomUUID()
}

export async function writeManagerActionAudit(
  client: SupabaseClient,
  input: {
    action: ManagerAction
    requestId: string
    objectType: string
    objectId: string
    beforeState?: unknown
    afterState?: unknown
    metadata?: Record<string, unknown>
    workspaceId?: string | null
  },
) {
  const policy = managerActionPolicy(input.action)
  const { error } = await client.rpc('write_ontology_action_log', {
    next_action: input.action,
    next_object_type: input.objectType,
    next_object_id: input.objectId,
    next_source: 'agent',
    next_before_state: input.beforeState ?? null,
    next_after_state: input.afterState ?? null,
    next_metadata: {
      requestId: input.requestId,
      risk: policy.risk,
      confirmationRequired: policy.confirmationRequired,
      undoable: policy.undoable,
      ...(input.metadata ?? {}),
    },
    next_workspace_id: input.workspaceId ?? null,
  })

  // The primary write is already protected by RLS and scope checks. A missing
  // optional Ontology migration must not turn a safe personal task save into a
  // failed user action, but it remains visible to the server operator.
  if (error) console.info('Manager action audit unavailable:', error.message)
}
