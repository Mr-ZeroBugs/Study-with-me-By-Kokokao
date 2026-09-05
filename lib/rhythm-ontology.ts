import type { User } from '@supabase/supabase-js'
import { loadOntologySnapshot, runOntologyAction } from './ontology-client'
import type { KokoRhythmPlan, RhythmSubject } from './rhythm-storage'

type Row = Record<string, unknown>
const migrationKey = (userId: string) => `koko_rhythm_ontology_v1_${userId}`
const string = (value: unknown) => typeof value === 'string' ? value : ''

/**
 * Mirrors the existing local Rhythm plan into the new Ontology. This bridge is
 * deliberately idempotent: it is safe to retry after a network interruption.
 * It returns the same plan rewritten with canonical Ontology UUIDs, so the UI
 * no longer depends on names once a learner has signed in.
 */
export async function syncRhythmPlanToOntology(user: User, plan: KokoRhythmPlan): Promise<KokoRhythmPlan> {
  const snapshot = await loadOntologySnapshot()
  const subjectRows = [...snapshot.subjects] as Row[]
  const subjectByName = new Map<string, string>(subjectRows
    .map((row): [string, string] => [string(row.name), string(row.id)])
    .filter(([name, id]) => Boolean(name && id)))

  const allSubjects = Array.from(new Map(plan.groups.flatMap((group) => group.subjects).map((subject) => [subject.name, subject])).values())
  const canonicalSubjects = new Map<string, RhythmSubject>()
  for (const subject of allSubjects) {
    let id = subjectByName.get(subject.name)
    if (!id) {
      const created = await runOntologyAction<Row>('create_subject', { name: subject.name })
      id = string(created.id)
      subjectByName.set(string(created.name), id)
    }
    if (!id) throw new Error(`Could not resolve subject ${subject.name}.`)
    canonicalSubjects.set(subject.name, { id, name: subject.name })
  }

  const groupRows = [...snapshot.groups] as Row[]
  const groupByName = new Map<string, string>(groupRows
    .map((row): [string, string] => [string(row.name), string(row.id)])
    .filter(([name, id]) => Boolean(name && id)))
  const cloudGroupIds = new Set(groupRows.map((row) => string(row.id)))
  const canonicalGroupIdByLocalId = new Map<string, string>()
  const canonicalGroups = [] as KokoRhythmPlan['groups']
  for (const group of plan.groups) {
    let cloudId = cloudGroupIds.has(group.id) ? group.id : groupByName.get(group.name)
    if (!cloudId) {
      const created = await runOntologyAction<Row>('create_subject_group', { name: group.name })
      cloudId = string(created.id)
      groupByName.set(group.name, cloudId)
    }
    if (!cloudId) throw new Error(`Could not resolve group ${group.name}.`)
    const existingGroup = groupRows.find((row) => string(row.id) === cloudId)
    if (existingGroup && string(existingGroup.name) !== group.name) {
      await runOntologyAction('update_subject_group', { groupId: cloudId, name: group.name })
    }
    canonicalGroupIdByLocalId.set(group.id, cloudId)
    const canonicalGroupSubjects = group.subjects.map((subject) => canonicalSubjects.get(subject.name)).filter((subject): subject is RhythmSubject => Boolean(subject))
    await runOntologyAction('replace_group_subjects', {
      groupId: cloudId,
      subjectIds: canonicalGroupSubjects.map((subject) => subject.id),
    })
    canonicalGroups.push({ ...group, id: cloudId, subjects: canonicalGroupSubjects })
  }

  const latest = await loadOntologySnapshot()
  const activeGoals = (latest.rhythmGoals as Row[]).filter((goal) => string(goal.status) === 'active')
  const setRole = async (role: 'major' | 'minor', localGroupId: string) => {
    const groupId = canonicalGroupIdByLocalId.get(localGroupId)
    const current = activeGoals.find((goal) => string(goal.role) === role)
    if (!groupId) {
      if (current) await runOntologyAction('set_rhythm_goal_role', { goalId: string(current.id), role: 'unassigned' })
      return
    }
    const group = canonicalGroups.find((item) => item.id === groupId)
    const existing = activeGoals.find((goal) => string(goal.subject_group_id) === groupId)
    if (existing) {
      await runOntologyAction('set_rhythm_goal_role', { goalId: string(existing.id), role })
    } else {
      await runOntologyAction('create_rhythm_goal', { title: group?.name || 'Rhythm goal', subjectGroupId: groupId, role })
    }
  }
  await setRole('major', plan.majorGroupId)
  await setRole('minor', plan.minorGroupId)

  // Legacy maintenance was group-based. Ontology V0 correctly tracks it per
  // subject, so migrate a legacy path to its first concrete subject. The UI
  // will expose per-subject maintenance in the next focused UI pass.
  const canonicalMaintenance = [] as KokoRhythmPlan['maintenance']
  for (const item of plan.maintenance) {
    const subject = canonicalGroups.flatMap((group) => group.subjects).find((candidate) => candidate.name === item.subjectName)
      ?? canonicalSubjects.get(item.subjectName)
    if (!subject) continue
    const saved = await runOntologyAction<Row>('set_maintenance_practice', { subjectId: subject.id, minutesPerDay: item.minutes })
    canonicalMaintenance.push({ id: string(saved.id) || item.id, subjectId: subject.id, subjectName: subject.name, minutes: item.minutes })
  }

  const canonicalPlan = {
    ...plan,
    groups: canonicalGroups,
    majorGroupId: canonicalGroupIdByLocalId.get(plan.majorGroupId) ?? '',
    minorGroupId: canonicalGroupIdByLocalId.get(plan.minorGroupId) ?? '',
    maintenance: canonicalMaintenance,
  }
  if (typeof window !== 'undefined') window.localStorage.setItem(migrationKey(user.id), 'complete')
  return canonicalPlan
}

/** Read the cloud graph back into the existing UI shape during the transition. */
export async function loadRhythmPlanFromOntology(fallback: KokoRhythmPlan): Promise<KokoRhythmPlan | null> {
  const snapshot = await loadOntologySnapshot()
  const groups = snapshot.groups as Row[]
  const subjects = snapshot.subjects as Row[]
  const goals = snapshot.rhythmGoals as Row[]
  if (!groups.length && !goals.length) return null

  const subjectById = new Map<string, RhythmSubject>(subjects.map((row): [string, RhythmSubject] => [string(row.id), { id: string(row.id), name: string(row.name) }]))
  const memberIdsByGroup = new Map<string, string[]>()
  for (const membership of snapshot.memberships) {
    const ids = memberIdsByGroup.get(membership.group_id) ?? []
    ids.push(membership.subject_id)
    memberIdsByGroup.set(membership.group_id, ids)
  }
  const planGroups = groups.map((group) => {
    const id = string(group.id)
    return {
      id,
      name: string(group.name) || 'Group',
      subjects: (memberIdsByGroup.get(id) ?? []).map((subjectId) => subjectById.get(subjectId)).filter((subject): subject is RhythmSubject => Boolean(subject)),
    }
  })
  if (!planGroups.length) return null
  const activeGoals = goals.filter((goal) => string(goal.status) === 'active')
  const majorGroupId = string(activeGoals.find((goal) => string(goal.role) === 'major')?.subject_group_id)
  const minorGroupId = string(activeGoals.find((goal) => string(goal.role) === 'minor')?.subject_group_id)
  const maintenance = (snapshot.maintenance as Row[]).flatMap((item, index) => {
    const subject = subjectById.get(string(item.subject_id))
    const minutes = Number(item.minutes_per_day)
    return subject && [5, 10, 15, 20].includes(minutes)
      ? [{ id: string(item.id) || `maintenance_${index}`, subjectId: subject.id, subjectName: subject.name, minutes: minutes as 5 | 10 | 15 | 20 }]
      : []
  })
  return { ...fallback, groups: planGroups, majorGroupId, minorGroupId, maintenance, updatedAt: new Date().toISOString() }
}

export function hasMigratedRhythmPlan(user: User | null) {
  return Boolean(user && typeof window !== 'undefined' && window.localStorage.getItem(migrationKey(user.id)) === 'complete')
}
