import type { User } from '@supabase/supabase-js'

export type RhythmGroup = {
  id: string
  name: string
  subjects: RhythmSubject[]
}

export type RhythmSubject = {
  id: string
  name: string
}

export type RhythmMaintenance = {
  id: string
  subjectId: string
  subjectName: string
  minutes: 5 | 10 | 15 | 20
}

export type KokoRhythmPlan = {
  groups: RhythmGroup[]
  majorGroupId: string
  minorGroupId: string
  maintenance: RhythmMaintenance[]
  updatedAt: string
}

export type RhythmRole = 'major' | 'minor' | 'maintenance' | 'unassigned'

export const RHYTHM_UPDATED_EVENT = 'koko-rhythm-updated'
const planMemory = new Map<string, KokoRhythmPlan>()
function storageKey(user?: User | null) { return user?.id ?? 'guest' }

export function createRhythmId(prefix = 'rhythm') {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}_${crypto.randomUUID()}`
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

export function createLocalRhythmSubject(name: string): RhythmSubject {
  const safeName = name.trim() || 'General'
  // A deterministic local ID keeps an offline plan stable until Ontology
  // replaces it with the canonical UUID returned by Supabase.
  return { id: `local_subject_${encodeURIComponent(safeName.toLocaleLowerCase())}`, name: safeName }
}

export function createDefaultKokoRhythmPlan(subjects: string[] = ['General']): KokoRhythmPlan {
  const names = Array.from(new Set(subjects.map((subject) => subject.trim()).filter(Boolean)))
  const initialSubjects = names.length ? names : ['General']
  const groupId = createRhythmId('group')
  return {
    groups: [{ id: groupId, name: 'General', subjects: initialSubjects.map(createLocalRhythmSubject) }],
    majorGroupId: groupId,
    minorGroupId: '',
    maintenance: [],
    updatedAt: new Date().toISOString(),
  }
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

/** The UI treats spacing/case variants as one learner-facing subject. */
export function rhythmIdentity(value: string) {
  return value.trim().normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase()
}

function normalizePlan(value: unknown): KokoRhythmPlan | null {
  if (!value || typeof value !== 'object') return null
  const parsed = value as Partial<KokoRhythmPlan>
  const groups = Array.isArray(parsed.groups)
    ? parsed.groups.map((group, index) => {
      const item = group as Partial<RhythmGroup> | null
      return {
        id: asString(item?.id) || `group_${index}`,
        name: asString(item?.name).trim() || `Group ${index + 1}`,
        subjects: Array.isArray(item?.subjects)
          ? Array.from(new Map((item.subjects as unknown[]).flatMap((subject) => {
            if (typeof subject === 'string' && subject.trim()) {
              const local = createLocalRhythmSubject(subject)
              return [[rhythmIdentity(local.name), local] as const]
            }
            if (subject && typeof subject === 'object') {
              const row = subject as Partial<RhythmSubject>
              const name = asString(row.name).trim()
              if (name) {
                const local = { id: asString(row.id) || createLocalRhythmSubject(name).id, name }
                return [[rhythmIdentity(local.name), local] as const]
              }
            }
            return []
          })).values())
          : [],
      }
  })
    : []
  // A concrete subject has one home in Koko Rhythm. Older local snapshots
  // could preserve the same subject in multiple groups, which later made a
  // cloud refresh appear to randomly move it. Keep the first explicit home.
  const assignedSubjectKeys = new Set<string>()
  for (const group of groups) {
    group.subjects = group.subjects.filter((subject) => {
      const key = rhythmIdentity(subject.name)
      if (assignedSubjectKeys.has(key)) return false
      assignedSubjectKeys.add(key)
      return true
    })
  }
  if (!groups.length) groups.push({ id: 'group_general', name: 'General', subjects: [createLocalRhythmSubject('General')] })
  const groupIds = new Set(groups.map((group) => group.id))
  const maintenance = Array.isArray(parsed.maintenance)
    ? parsed.maintenance.flatMap((item, index) => {
      const row = item as Partial<RhythmMaintenance> | null
      // Compatibility for the previous group-based maintenance UI: retain a
      // small practice by assigning it to the first concrete subject there.
      const legacyGroup = groups.find((group) => group.id === asString((row as { groupId?: unknown } | null)?.groupId))
      const legacyName = asString((row as { subject?: unknown } | null)?.subject)
      const linkedSubject = groups.flatMap((group) => group.subjects).find((subject) => subject.name === legacyName) ?? legacyGroup?.subjects[0]
      const subjectName = asString((row as { subjectName?: unknown } | null)?.subjectName) || linkedSubject?.name || legacyName
      const subjectId = asString((row as { subjectId?: unknown } | null)?.subjectId) || linkedSubject?.id || (subjectName ? createLocalRhythmSubject(subjectName).id : '')
      if (!subjectName || !subjectId) return []
      const minutes = Number(row?.minutes)
      const safeMinutes = ([5, 10, 15, 20] as const).includes(minutes as 5 | 10 | 15 | 20) ? minutes as 5 | 10 | 15 | 20 : 10
      return [{ id: asString(row?.id) || `maintenance_${index}`, subjectId, subjectName, minutes: safeMinutes }]
    })
    : []
  return {
    groups,
    majorGroupId: groupIds.has(asString(parsed.majorGroupId)) ? asString(parsed.majorGroupId) : '',
    minorGroupId: groupIds.has(asString(parsed.minorGroupId)) ? asString(parsed.minorGroupId) : '',
    maintenance,
    updatedAt: asString(parsed.updatedAt) || new Date().toISOString(),
  }
}

export function loadKokoRhythmPlan(user?: User | null): KokoRhythmPlan | null {
  return normalizePlan(planMemory.get(storageKey(user)))
}

export function saveKokoRhythmPlan(user: User | null | undefined, plan: KokoRhythmPlan) {
  const next = { ...plan, updatedAt: new Date().toISOString() }
  planMemory.set(storageKey(user), next)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(RHYTHM_UPDATED_EVENT, { detail: next }))
}

export function rhythmRoleForSubject(subject: string, plan: KokoRhythmPlan | null | undefined): RhythmRole {
  if (!plan) return 'unassigned'
  const group = plan.groups.find((item) => item.subjects.some((itemSubject) => itemSubject.name === subject))
  if (!group) return 'unassigned'
  if (group.id === plan.majorGroupId) return 'major'
  if (group.id === plan.minorGroupId) return 'minor'
  if (plan.maintenance.some((item) => item.subjectName === subject)) return 'maintenance'
  return 'unassigned'
}
