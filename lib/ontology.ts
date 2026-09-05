/**
 * Koko Personal Ontology V0 contracts.
 *
 * These are intentionally independent of React UI state. They describe the
 * stable nouns and relationships the web app, LINE bot, and future AI tools
 * will share. Legacy planner records still use subject names while the UI is
 * migrated incrementally to these canonical IDs.
 */

export type OntologyId = string

export type OntologySubject = {
  id: OntologyId
  userId: OntologyId
  name: string
  color?: string | null
  archivedAt?: string | null
  createdAt: string
  updatedAt: string
}

export type OntologySubjectGroup = {
  id: OntologyId
  userId: OntologyId
  name: string
  description: string
  color?: string | null
  archivedAt?: string | null
  createdAt: string
  updatedAt: string
}

export type OntologyRhythmGoalRole = 'major' | 'minor' | 'unassigned'
export type OntologyRhythmGoalStatus = 'active' | 'paused' | 'completed' | 'archived'

export type OntologyRhythmGoal = {
  id: OntologyId
  userId: OntologyId
  title: string
  description: string
  subjectGroupId?: OntologyId | null
  role: OntologyRhythmGoalRole
  status: OntologyRhythmGoalStatus
  createdAt: string
  updatedAt: string
}

export type OntologyMaintenancePractice = {
  id: OntologyId
  userId: OntologyId
  subjectId: OntologyId
  minutesPerDay: number
  active: boolean
  createdAt: string
  updatedAt: string
}

export type OntologyActionSource = 'web' | 'line' | 'agent' | 'database' | 'system'

export type OntologyActionLog = {
  id: OntologyId
  actorUserId?: OntologyId | null
  workspaceId?: OntologyId | null
  action: string
  objectType: string
  objectId: string
  source: OntologyActionSource
  beforeState?: Record<string, unknown> | null
  afterState?: Record<string, unknown> | null
  metadata: Record<string, unknown>
  createdAt: string
}

export type KokoActionName =
  | 'create_subject'
  | 'create_subject_group'
  | 'update_subject_group'
  | 'archive_subject_group'
  | 'replace_group_subjects'
  | 'create_rhythm_goal'
  | 'set_rhythm_goal_role'
  | 'set_maintenance_practice'
  | 'deactivate_maintenance_practice'
  | 'sync_rhythm_plan'
  | 'create_task'
  | 'complete_task'

/**
 * Every future write tool must carry enough information to authorize and
 * audit it. An LLM may propose an action, but it never chooses the actor.
 */
export type KokoActionRequest<TInput extends Record<string, unknown> = Record<string, unknown>> = {
  action: KokoActionName
  actorUserId: OntologyId
  source: Exclude<OntologyActionSource, 'database' | 'system'>
  requestId: string
  input: TInput
}
