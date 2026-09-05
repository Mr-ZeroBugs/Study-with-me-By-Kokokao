import { supabase } from './supabase'
import type { User } from '@supabase/supabase-js'
import { loadOntologySnapshot } from './ontology-client'

export type DayLog = Record<string, number>
export type SubjectDayLogs = Record<string, DayLog>
export type CanonicalSubjectDayLog = {
  subjectId: string
  subjectName: string
  days: DayLog
}
export type StudyStatsSnapshot = {
  logs: DayLog
  intervals: StudyInterval[]
  subjectLogs: SubjectDayLogs
  canonicalSubjectLogs: CanonicalSubjectDayLog[]
}
export type StudyInterval = {
  id: string
  startedAt: string
  endedAt: string
  durationSeconds: number
  timerMode: 'flow' | 'countdown'
  mode: 'focus' | 'short' | 'long'
  subject: string
  subjectId?: string
}

const DEFAULT_SUBJECT = 'General'
export const MAX_DAILY_FOCUS_MINUTES = 24 * 60
export const MAX_CONTINUOUS_FOCUS_SECONDS = 4 * 60 * 60
export const SUSPICIOUS_DAILY_FOCUS_MINUTES = 12 * 60

type CacheScope = User | null | undefined
const logsMemory = new Map<string, DayLog>()
const roundsMemory = new Map<string, number>()
const subjectsMemory = new Map<string, string[]>()
const subjectLogsMemory = new Map<string, SubjectDayLogs>()
const intervalsMemory = new Map<string, StudyInterval[]>()
const anomaliesMemory = new Map<string, SuspiciousStudyDay[]>()
function scopeKey(scope?: CacheScope) { return scope?.id ?? 'guest' }

/**
 * Format Date to YYYY-MM-DD local date string key
 */
export function getLocalDateKey(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Calculate study streak in consecutive days up to today
 */
export function calculateStreak(logs: DayLog): number {
  let streak = 0
  const today = new Date()
  
  // Check today first
  const todayKey = getLocalDateKey(today)
  const hasStudiedToday = (logs[todayKey] ?? 0) > 0
  
  if (hasStudiedToday) {
    streak = 1
  }

  // Count backwards from yesterday
  const checkDate = new Date(today)
  while (true) {
    checkDate.setDate(checkDate.getDate() - 1)
    const key = getLocalDateKey(checkDate)
    if ((logs[key] ?? 0) > 0) {
      streak++
    } else {
      break
    }
  }

  return streak
}

/**
 * Read the current tab's in-memory snapshot.
 */
export function getLocalLogs(scope?: CacheScope): DayLog {
  return logsMemory.get(scopeKey(scope)) ?? {}
}

/**
 * Update the current tab's in-memory snapshot.
 */
export function saveLocalLogs(logs: DayLog, scope?: CacheScope) {
  logsMemory.set(scopeKey(scope), Object.fromEntries(Object.entries(logs).map(([dateKey, minutes]) => [dateKey, Math.min(MAX_DAILY_FOCUS_MINUTES, Math.max(0, Number(minutes) || 0))])))
}

/**
 * Read today's session rounds from the in-memory snapshot.
 */
export function getLocalRounds(todayKey: string, scope?: CacheScope): number {
  return roundsMemory.get(`${scopeKey(scope)}:${todayKey}`) ?? 0
}

/**
 * Update today's in-memory session rounds.
 */
export function saveLocalRounds(todayKey: string, rounds: number, scope?: CacheScope) {
  roundsMemory.set(`${scopeKey(scope)}:${todayKey}`, rounds)
}

export async function loadStudyRounds(user: User | null, dateKey: string) {
  if (!user) return getLocalRounds(dateKey, null)
  const { data, error } = await supabase.from('daily_logs').select('rounds').eq('user_id', user.id).eq('date_key', dateKey).maybeSingle()
  if (error) throw error
  const rounds = Math.max(0, Number(data?.rounds) || 0)
  saveLocalRounds(dateKey, rounds, user)
  return rounds
}

export function getLocalSubjects(scope?: CacheScope): string[] {
  return subjectsMemory.get(scopeKey(scope)) ?? [DEFAULT_SUBJECT]
}

export function saveLocalSubjects(subjects: string[], scope?: CacheScope) {
  subjectsMemory.set(scopeKey(scope), Array.from(new Set([DEFAULT_SUBJECT, ...subjects])))
}

export function getLocalSubjectLogs(scope?: CacheScope): SubjectDayLogs {
  return subjectLogsMemory.get(scopeKey(scope)) ?? {}
}

export function saveLocalSubjectLogs(logs: SubjectDayLogs, scope?: CacheScope) {
  subjectLogsMemory.set(scopeKey(scope), logs)
}

function normalizeStudyInterval(value: unknown): StudyInterval | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<StudyInterval>
  if (typeof candidate.id !== 'string' || typeof candidate.startedAt !== 'string' || typeof candidate.endedAt !== 'string') return null
  const parsedStart = Date.parse(candidate.startedAt)
  const parsedEnd = Date.parse(candidate.endedAt)
  const durationSeconds = Math.min(
    Number(candidate.durationSeconds),
    Number.isFinite(parsedStart) && Number.isFinite(parsedEnd) ? Math.max(0, Math.floor((parsedEnd - parsedStart) / 1000)) : MAX_CONTINUOUS_FOCUS_SECONDS,
    MAX_CONTINUOUS_FOCUS_SECONDS,
  )
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null
  return {
    id: candidate.id,
    startedAt: candidate.startedAt,
    endedAt: Number.isFinite(parsedStart) ? new Date(parsedStart + durationSeconds * 1000).toISOString() : candidate.endedAt,
    durationSeconds: Math.round(durationSeconds),
    timerMode: candidate.timerMode === 'countdown' ? 'countdown' : 'flow',
    mode: candidate.mode === 'short' || candidate.mode === 'long' ? candidate.mode : 'focus',
    subject: typeof candidate.subject === 'string' && candidate.subject.trim() ? candidate.subject.trim() : DEFAULT_SUBJECT,
    ...(typeof candidate.subjectId === 'string' ? { subjectId: candidate.subjectId } : {}),
  }
}

export function createStudyIntervalId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function getLocalStudyIntervals(scope?: CacheScope): StudyInterval[] {
  return intervalsMemory.get(scopeKey(scope)) ?? []
}

export function saveLocalStudyIntervals(intervals: StudyInterval[], scope?: CacheScope) {
  intervalsMemory.set(scopeKey(scope), intervals)
}

/** Fetch the start/stop segments used by the daily focus timeline. */
export async function loadStudyIntervals(user: User | null): Promise<StudyInterval[]> {
  const localIntervals = getLocalStudyIntervals(user)
  if (!user) return localIntervals

  try {
    const { data, error } = await supabase
      .from('study_intervals')
      .select('id, started_at, ended_at, duration_seconds, timer_mode, mode, subject, subject_id')
      .eq('user_id', user.id)

    if (error || !data) return localIntervals

    const cloudIntervals = data.map((row) => normalizeStudyInterval({
      id: row.id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      durationSeconds: row.duration_seconds,
      timerMode: row.timer_mode,
      mode: row.mode,
      subject: row.subject,
      subjectId: row.subject_id,
    })).filter((item): item is StudyInterval => Boolean(item))
    saveLocalStudyIntervals(cloudIntervals, user)
    return cloudIntervals
  } catch {
    return localIntervals
  }
}

/** Persist one continuous running segment when the timer is paused or stopped. */
export async function recordStudyInterval(user: User | null, interval: StudyInterval) {
  const normalized = normalizeStudyInterval(interval)
  if (!normalized) return
  const startedAt = new Date(normalized.startedAt).getTime()
  const rawEndedAt = new Date(normalized.endedAt).getTime()
  if (!Number.isFinite(startedAt) || !Number.isFinite(rawEndedAt) || rawEndedAt <= startedAt) return

  // A forgotten open timer must never create a multi-day interval. Four
  // hours is deliberately generous for a real study block while still
  // bounding accidental data. Split at local midnight so the Stats timeline
  // attributes each segment to the correct calendar day.
  const boundedEnd = Math.min(rawEndedAt, startedAt + MAX_CONTINUOUS_FOCUS_SECONDS * 1000)
  const segments: StudyInterval[] = []
  let cursor = startedAt
  while (cursor < boundedEnd) {
    const cursorDate = new Date(cursor)
    const nextMidnight = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), cursorDate.getDate() + 1).getTime()
    const segmentEnd = Math.min(boundedEnd, nextMidnight)
    const durationSeconds = Math.floor((segmentEnd - cursor) / 1000)
    if (durationSeconds >= 5) {
      segments.push({
        ...normalized,
        id: segments.length === 0 && segmentEnd === boundedEnd ? normalized.id : createStudyIntervalId(),
        startedAt: new Date(cursor).toISOString(),
        endedAt: new Date(segmentEnd).toISOString(),
        durationSeconds,
      })
    }
    cursor = segmentEnd
  }

  const existing = getLocalStudyIntervals(user)
  const knownIds = new Set(existing.map((item) => item.id))
  const newSegments = segments.filter((item) => !knownIds.has(item.id))
  if (newSegments.length) saveLocalStudyIntervals([...existing, ...newSegments], user)

  if (!user || !newSegments.length) return
  for (const segment of newSegments) {
    try {
      const intervalRow = {
        id: segment.id,
        user_id: user.id,
        started_at: segment.startedAt,
        ended_at: segment.endedAt,
        duration_seconds: segment.durationSeconds,
        timer_mode: segment.timerMode,
        mode: segment.mode,
        subject: segment.subject,
        subject_id: segment.subjectId ?? null,
      }
      const { error } = await supabase.from('study_intervals').insert(intervalRow)
      if (error && /subject_id|schema cache|column/i.test(error.message)) {
        const { subject_id: _subjectId, ...legacyRow } = intervalRow
        await supabase.from('study_intervals').insert(legacyRow)
      }
    } catch {}
  }
}

/** Fetch per-subject daily minutes, with a General bucket for legacy totals. */
export async function loadSubjectLogs(user: User | null, reconciledDailyLogs?: DayLog): Promise<SubjectDayLogs> {
  const localSubjectLogs = getLocalSubjectLogs(user)
  const localLogs = getLocalLogs(user)

  // Older installs only have the aggregate log. Keep that history visible under General.
  for (const [dateKey, minutes] of Object.entries(localLogs)) {
    const knownMinutes = Object.values(localSubjectLogs).reduce((sum, days) => sum + (days[dateKey] ?? 0), 0)
    if (knownMinutes === 0 && minutes > 0) {
      localSubjectLogs[DEFAULT_SUBJECT] ??= {}
      localSubjectLogs[DEFAULT_SUBJECT][dateKey] = minutes
    }
  }

  if (!user) {
    const safeDailyLogs = reconciledDailyLogs ?? await loadStudyLogs(null)
    return reconcileSubjectLogsToDaily(localSubjectLogs, safeDailyLogs)
  }

  try {
    const { data, error } = await supabase
      .from('study_sessions')
      .select('subject, date_key, duration_seconds')
      .eq('user_id', user.id)

    if (error || !data) return reconcileSubjectLogsToDaily(localSubjectLogs, reconciledDailyLogs ?? await loadStudyLogs(user))

    const cloudLogs: SubjectDayLogs = {}
    for (const row of data) {
      const subject = typeof row.subject === 'string' && row.subject.trim() ? row.subject.trim() : DEFAULT_SUBJECT
      cloudLogs[subject] ??= {}
      cloudLogs[subject][row.date_key] = (cloudLogs[subject][row.date_key] ?? 0) + Math.max(0, Math.round((row.duration_seconds ?? 0) / 60))
    }
    const safeDailyLogs = reconciledDailyLogs ?? await loadStudyLogs(user)
    const reconciled = reconcileSubjectLogsToDaily(cloudLogs, safeDailyLogs)
    saveLocalSubjectLogs(reconciled, user)
    // A subject may be created before it has any study sessions. Loading
    // analytics must never replace the explicit subject library with only the
    // subjects present in historical logs, or a brand-new subject disappears
    // as soon as the learner opens Tasks/Stats.
    const ontologySubjects = await loadOntologySnapshot().then((snapshot) => snapshot.subjects.flatMap((subject) => typeof subject.name === 'string' ? [subject.name] : [])).catch(() => [])
    saveLocalSubjects([DEFAULT_SUBJECT, ...ontologySubjects, ...Object.keys(reconciled)], user)
    return reconciled
  } catch (err) {
    console.error('Failed to load subject logs from Supabase:', err)
    return reconcileSubjectLogsToDaily(localSubjectLogs, reconciledDailyLogs ?? await loadStudyLogs(user))
  }
}

function reconcileSubjectLogsToDaily(subjectLogs: SubjectDayLogs, dailyLogs: DayLog) {
  const reconciled: SubjectDayLogs = Object.fromEntries(Object.entries(subjectLogs).map(([subject, days]) => [subject, { ...days }]))
  const dateKeys = new Set(Object.values(reconciled).flatMap((days) => Object.keys(days)))
  for (const dateKey of dateKeys) {
    const subjectTotal = Object.values(reconciled).reduce((sum, days) => sum + (days[dateKey] ?? 0), 0)
    const dailyTotal = dailyLogs[dateKey] ?? 0
    if (subjectTotal <= dailyTotal + 1) continue
    let assigned = 0
    const active = Object.entries(reconciled).filter(([, days]) => (days[dateKey] ?? 0) > 0)
    active.forEach(([subject, days], index) => {
      const next = index === active.length - 1 ? dailyTotal - assigned : Math.round(dailyTotal * (days[dateKey] ?? 0) / subjectTotal)
      reconciled[subject][dateKey] = Math.max(0, next)
      assigned += Math.max(0, next)
    })
  }
  return reconciled
}

function addLegacyAggregateFallback(subjectLogs: SubjectDayLogs, dailyLogs: DayLog) {
  const next = Object.fromEntries(Object.entries(subjectLogs).map(([subject, days]) => [subject, { ...days }])) as SubjectDayLogs
  for (const [dateKey, minutes] of Object.entries(dailyLogs)) {
    const knownMinutes = Object.values(next).reduce((sum, days) => sum + (days[dateKey] ?? 0), 0)
    if (knownMinutes === 0 && minutes > 0) {
      next[DEFAULT_SUBJECT] ??= {}
      next[DEFAULT_SUBJECT][dateKey] = minutes
    }
  }
  return next
}

/**
 * Canonical, ID-backed session totals for Ontology-aware consumers. The
 * string-based subject logs above remain the display-compatible fallback for
 * guests and data created before Ontology V1 was applied.
 */
export async function loadCanonicalSubjectLogs(user: User | null): Promise<CanonicalSubjectDayLog[]> {
  if (!user) return []
  try {
    const { data, error } = await supabase
      .from('study_sessions')
      .select('subject_id, subject, date_key, duration_seconds')
      .eq('user_id', user.id)
      .not('subject_id', 'is', null)
    if (error || !data) return []

    const byId = new Map<string, CanonicalSubjectDayLog>()
    for (const row of data) {
      if (typeof row.subject_id !== 'string') continue
      const subjectName = typeof row.subject === 'string' && row.subject.trim() ? row.subject.trim() : DEFAULT_SUBJECT
      const current = byId.get(row.subject_id) ?? { subjectId: row.subject_id, subjectName, days: {} }
      current.days[row.date_key] = (current.days[row.date_key] ?? 0) + Math.max(0, Math.round((row.duration_seconds ?? 0) / 60))
      byId.set(row.subject_id, current)
    }
    return [...byId.values()]
  } catch {
    return []
  }
}

/**
 * Load every dataset used by Stats from one coordinated server snapshot.
 *
 * Stats used to load daily logs, intervals, and study sessions through three
 * separate helpers (some of which fetched the same table twice).  A focus
 * minute could then be visible in one card while another request was still
 * reading an older view of the account.  This keeps the three presentations
 * in step and removes the duplicate network work from the Stats route.
 */
export async function loadStudyStatsSnapshot(user: User | null): Promise<StudyStatsSnapshot> {
  if (!user) {
    const logs = await loadStudyLogs(null)
    const intervals = getLocalStudyIntervals(null)
    const subjectLogs = await loadSubjectLogs(null, logs)
    return { logs, intervals, subjectLogs, canonicalSubjectLogs: [] }
  }

  const localLogs = getLocalLogs(user)
  const localIntervals = getLocalStudyIntervals(user)
  try {
    const [dailyResponse, intervalResponse, sessionsResponse] = await Promise.all([
      supabase.from('daily_logs').select('date_key, total_minutes').eq('user_id', user.id),
      supabase.from('study_intervals').select('id, started_at, ended_at, duration_seconds, timer_mode, mode, subject, subject_id').eq('user_id', user.id),
      supabase.from('study_sessions').select('id, subject_id, subject, date_key, duration_seconds, completed_at, timer_mode, mode').eq('user_id', user.id),
    ])
    if (dailyResponse.error || intervalResponse.error || sessionsResponse.error) throw dailyResponse.error ?? intervalResponse.error ?? sessionsResponse.error

    const rawLogs: DayLog = {}
    for (const row of dailyResponse.data ?? []) {
      rawLogs[row.date_key] = Math.min(MAX_DAILY_FOCUS_MINUTES, Math.max(0, Number(row.total_minutes) || 0))
    }
    const intervals = (intervalResponse.data ?? []).map((row) => normalizeStudyInterval({
      id: row.id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      durationSeconds: row.duration_seconds,
      timerMode: row.timer_mode,
      mode: row.mode,
      subject: row.subject,
      subjectId: row.subject_id,
    })).filter((item): item is StudyInterval => Boolean(item))
    saveLocalStudyIntervals(intervals, user)
    const logs = reconcileStudyHistory(user, rawLogs, intervals)

    const rawSubjectLogs: SubjectDayLogs = {}
    const canonicalById = new Map<string, CanonicalSubjectDayLog>()
    const inferredTimelineIntervals: StudyInterval[] = []
    for (const row of sessionsResponse.data ?? []) {
      const subject = typeof row.subject === 'string' && row.subject.trim() ? row.subject.trim() : DEFAULT_SUBJECT
      const dateKey = typeof row.date_key === 'string' ? row.date_key : ''
      if (!dateKey) continue
      const minutes = Math.max(0, Math.round((row.duration_seconds ?? 0) / 60))
      rawSubjectLogs[subject] ??= {}
      rawSubjectLogs[subject][dateKey] = (rawSubjectLogs[subject][dateKey] ?? 0) + minutes

      // Legacy records have no ontology ID. Keep them in the same breakdown
      // with a stable display-only ID instead of dropping their focus time.
      const subjectId = typeof row.subject_id === 'string' ? row.subject_id : `legacy:${subject}`
      const current = canonicalById.get(subjectId) ?? { subjectId, subjectName: subject, days: {} }
      current.days[dateKey] = (current.days[dateKey] ?? 0) + minutes
      canonicalById.set(subjectId, current)

      // Focus sessions created before timeline persistence existed still have
      // a trustworthy completion timestamp. Use it only as display evidence
      // when no real interval overlaps, so old totals regain a useful day
      // timeline without altering any source data or double-counting minutes.
      const completedAt = Date.parse(typeof row.completed_at === 'string' ? row.completed_at : '')
      const durationSeconds = Math.max(0, Math.round(Number(row.duration_seconds) || 0))
      const startedAt = completedAt - durationSeconds * 1000
      const mode = row.mode === 'short' || row.mode === 'long' ? row.mode : 'focus'
      const timerMode = row.timer_mode === 'countdown' ? 'countdown' : 'flow'
      const overlapsRealInterval = intervals.some((interval) => {
        if (interval.mode !== mode) return false
        const intervalStart = Date.parse(interval.startedAt)
        const intervalEnd = Date.parse(interval.endedAt)
        return Number.isFinite(intervalStart) && Number.isFinite(intervalEnd) && intervalStart < completedAt && intervalEnd > startedAt
      })
      if (typeof row.id === 'string' && durationSeconds >= 5 && Number.isFinite(startedAt) && Number.isFinite(completedAt) && !overlapsRealInterval) {
        inferredTimelineIntervals.push({
          id: `session-${row.id}`,
          startedAt: new Date(startedAt).toISOString(),
          endedAt: new Date(completedAt).toISOString(),
          durationSeconds,
          timerMode,
          mode,
          subject,
          ...(typeof row.subject_id === 'string' ? { subjectId: row.subject_id } : {}),
        })
      }
    }
    const subjectLogs = reconcileSubjectLogsToDaily(addLegacyAggregateFallback(rawSubjectLogs, logs), logs)
    saveLocalSubjectLogs(subjectLogs, user)
    saveLocalSubjects([DEFAULT_SUBJECT, ...Object.keys(subjectLogs)], user)
    return { logs, intervals: [...intervals, ...inferredTimelineIntervals], subjectLogs, canonicalSubjectLogs: [...canonicalById.values()] }
  } catch (error) {
    console.warn('Failed to load coordinated Stats snapshot; using the last verified account data.', error)
    const [logs, intervals, subjectLogs, canonicalSubjectLogs] = await Promise.all([
      loadStudyLogs(user),
      loadStudyIntervals(user),
      loadSubjectLogs(user),
      loadCanonicalSubjectLogs(user),
    ])
    return {
      logs: Object.keys(logs).length ? logs : localLogs,
      intervals: intervals.length ? intervals : localIntervals,
      subjectLogs,
      canonicalSubjectLogs,
    }
  }
}

function reconcileStudyHistory(user: User | null, rawLogs: DayLog, intervals: StudyInterval[]) {
  const detected = defendStudyHistory(rawLogs, intervals)
  const incidents = detected.suspiciousDays.length ? detected.suspiciousDays : getLocalStudyAnomalies(user)
  const safeLogs = { ...detected.safeLogs }
  for (const incident of incidents) {
    incident.relatedDateKeys.forEach((key, index) => { safeLogs[key] = index === 0 ? incident.suggestedMinutes : 0 })
  }
  saveLocalStudyAnomalies(incidents, user)
  saveLocalLogs(safeLogs, user)
  return safeLogs
}

/**
 * Fetch canonical study logs from Supabase for authenticated users.
 */
export async function loadStudyLogs(user: User | null): Promise<DayLog> {
  const localLogs = getLocalLogs(user)

  if (!user) {
    return reconcileStudyHistory(null, localLogs, getLocalStudyIntervals(null))
  }

  try {
    const [{ data, error }, intervalResponse] = await Promise.all([
      supabase.from('daily_logs').select('date_key, total_minutes').eq('user_id', user.id),
      supabase.from('study_intervals').select('id, started_at, ended_at, duration_seconds, timer_mode, mode, subject, subject_id').eq('user_id', user.id),
    ])

    if (error) {
      console.warn('Supabase fetch error, fallback to local logs:', error)
      return reconcileStudyHistory(user, localLogs, getLocalStudyIntervals(user))
    }

    const cloudLogs: DayLog = {}
    if (data) {
      for (const row of data) {
      cloudLogs[row.date_key] = Math.min(MAX_DAILY_FOCUS_MINUTES, Math.max(0, Number(row.total_minutes) || 0))
      }
    }

    const cloudIntervals = (intervalResponse.data ?? []).map((row) => normalizeStudyInterval({
      id: row.id, startedAt: row.started_at, endedAt: row.ended_at, durationSeconds: row.duration_seconds,
      timerMode: row.timer_mode, mode: row.mode, subject: row.subject, subjectId: row.subject_id,
    })).filter((item): item is StudyInterval => Boolean(item))
    saveLocalStudyIntervals(cloudIntervals, user)
    return reconcileStudyHistory(user, cloudLogs, cloudIntervals)
  } catch (err) {
    console.error('Failed to load study logs from Supabase:', err)
    return reconcileStudyHistory(user, localLogs, getLocalStudyIntervals(user))
  }
}

/**
 * Record a completed focus session and update total daily minutes
 */
export async function recordFocusSession(
  user: User | null,
  durationMinutes: number,
  mode: string,
  timerMode: 'flow' | 'countdown',
  subject = DEFAULT_SUBJECT,
  subjectId?: string,
  options: { dateKey?: string; countRound?: boolean } = {},
): Promise<{ updatedLogs: DayLog; updatedSubjectLogs: SubjectDayLogs; newTotal: number }> {
  const todayKey = options.dateKey || getLocalDateKey(new Date())
  const safeDuration = Math.max(0, Math.round(Number(durationMinutes) || 0))
  const safeSubject = subject.trim() || DEFAULT_SUBJECT
  const currentLogs = getLocalLogs(user)
  const currentSubjectLogs = getLocalSubjectLogs(user)
  const currentTotal = Math.min(MAX_DAILY_FOCUS_MINUTES, Math.max(0, currentLogs[todayKey] ?? 0))
  const acceptedDuration = Math.min(safeDuration, MAX_DAILY_FOCUS_MINUTES - currentTotal)
  const newTotal = currentTotal + acceptedDuration
  
  const updatedLogs: DayLog = {
    ...currentLogs,
    [todayKey]: newTotal,
  }

  // Update the current view immediately; Supabase remains durable truth.
  saveLocalLogs(updatedLogs, user)
  const updatedSubjectLogs: SubjectDayLogs = {
    ...currentSubjectLogs,
    [safeSubject]: {
      ...(currentSubjectLogs[safeSubject] ?? {}),
      [todayKey]: (currentSubjectLogs[safeSubject]?.[todayKey] ?? 0) + acceptedDuration,
    },
  }
  saveLocalSubjectLogs(updatedSubjectLogs, user)
  saveLocalSubjects([...getLocalSubjects(user), safeSubject], user)

  // If user is logged in, sync to Supabase
  if (user) {
    try {
      const { data: existing } = await supabase
        .from('daily_logs')
        .select('id, total_minutes, rounds')
        .eq('user_id', user.id)
        .eq('date_key', todayKey)
        .maybeSingle()
      const cloudCurrent = Math.min(MAX_DAILY_FOCUS_MINUTES, Math.max(0, Number(existing?.total_minutes) || 0))
      const cloudAccepted = Math.min(safeDuration, MAX_DAILY_FOCUS_MINUTES - cloudCurrent)
      if (cloudAccepted <= 0) return { updatedLogs, updatedSubjectLogs, newTotal }

      // 1. Record session detail
      const sessionRow = {
        user_id: user.id,
        timer_mode: timerMode,
        mode: mode,
        duration_seconds: cloudAccepted * 60,
        date_key: todayKey,
        subject: safeSubject,
        subject_id: subjectId ?? null,
      }
      const { error: sessionError } = await supabase.from('study_sessions').insert(sessionRow)
      if (sessionError && /subject_id|schema cache|column/i.test(sessionError.message)) {
        const { subject_id: _subjectId, ...legacyRow } = sessionRow
        await supabase.from('study_sessions').insert(legacyRow)
      }

      // 2. Upsert aggregated daily log. Background minute syncs are not
      // separate rounds; only an explicitly completed block increments it.
      if (existing) {
        await supabase
          .from('daily_logs')
          .update({
            total_minutes: cloudCurrent + cloudAccepted,
            rounds: (existing.rounds || 0) + (options.countRound === false ? 0 : 1),
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
      } else {
        await supabase.from('daily_logs').insert({
          user_id: user.id,
          date_key: todayKey,
          total_minutes: cloudAccepted,
          rounds: options.countRound === false ? 0 : 1,
        })
      }
    } catch (err) {
      console.error('Failed to sync study session to Supabase:', err)
    }
  }

  return { updatedLogs, updatedSubjectLogs, newTotal }
}

/**
 * Record completed whole minutes against the local day in which each minute
 * actually happened. This prevents a sleeping/restored tab from assigning a
 * cross-midnight block entirely to yesterday or today.
 */
export async function recordFocusMinutesByTimeline(
  user: User | null,
  sessionStartedAt: number,
  fromElapsedSeconds: number,
  toElapsedSeconds: number,
  mode: string,
  timerMode: 'flow' | 'countdown',
  subject = DEFAULT_SUBJECT,
  subjectId?: string,
  countRound = false,
): Promise<DayLog> {
  const firstMinute = Math.floor(Math.max(0, fromElapsedSeconds) / 60) + 1
  const lastMinute = Math.floor(Math.max(0, toElapsedSeconds) / 60)
  if (lastMinute < firstMinute) return getLocalLogs(user)

  const minutesByDay = new Map<string, number>()
  for (let minute = firstMinute; minute <= lastMinute; minute++) {
    const minuteMidpoint = sessionStartedAt + (minute * 60 - 30) * 1000
    const dateKey = getLocalDateKey(new Date(minuteMidpoint))
    minutesByDay.set(dateKey, (minutesByDay.get(dateKey) ?? 0) + 1)
  }

  let updatedLogs = getLocalLogs(user)
  const dayEntries = [...minutesByDay.entries()]
  for (const [index, [dateKey, minutes]] of dayEntries.entries()) {
    const result = await recordFocusSession(user, minutes, mode, timerMode, subject, subjectId, {
      dateKey,
      countRound: countRound && index === dayEntries.length - 1,
    })
    updatedLogs = result.updatedLogs
  }
  return updatedLogs
}

export type SuspiciousStudyDay = {
  dateKey: string
  relatedDateKeys: string[]
  recordedMinutes: number
  suggestedMinutes: number
}

/** Keep clearly corrupted legacy totals out of charts until the learner reviews them. */
export function defendStudyHistory(logs: DayLog, intervals: StudyInterval[]) {
  const intervalMinutes: DayLog = {}
  for (const interval of intervals) {
    if (interval.mode !== 'focus') continue
    const start = Date.parse(interval.startedAt)
    if (!Number.isFinite(start)) continue
    const key = getLocalDateKey(new Date(start))
    intervalMinutes[key] = (intervalMinutes[key] ?? 0) + Math.min(interval.durationSeconds / 60, MAX_CONTINUOUS_FOCUS_SECONDS / 60)
  }

  const sortedKeys = Object.keys(logs).sort()
  const suspiciousKeys = new Set(sortedKeys.filter((key) => (logs[key] ?? 0) >= SUSPICIOUS_DAILY_FOCUS_MINUTES))

  // Earlier builds capped each slice of one runaway timer at exactly four
  // hours. Two or more consecutive 240-minute days are therefore treated as
  // one legacy incident, even though each individual day now looks plausible.
  let cappedRun: string[] = []
  const commitCappedRun = () => {
    if (cappedRun.length >= 2) cappedRun.forEach((key) => suspiciousKeys.add(key))
    cappedRun = []
  }
  for (const key of sortedKeys) {
    const previous = cappedRun.at(-1)
    const consecutive = !previous || Math.round((new Date(`${key}T12:00:00`).getTime() - new Date(`${previous}T12:00:00`).getTime()) / 86_400_000) === 1
    if (Math.abs((logs[key] ?? 0) - 240) <= 1 && consecutive) cappedRun.push(key)
    else {
      commitCappedRun()
      if (Math.abs((logs[key] ?? 0) - 240) <= 1) cappedRun = [key]
    }
  }
  commitCappedRun()

  const groups: string[][] = []
  for (const key of [...suspiciousKeys].sort()) {
    const current = groups.at(-1)
    const previous = current?.at(-1)
    const consecutive = previous && Math.round((new Date(`${key}T12:00:00`).getTime() - new Date(`${previous}T12:00:00`).getTime()) / 86_400_000) === 1
    if (current && consecutive) current.push(key)
    else groups.push([key])
  }

  const safeLogs = { ...logs }
  const suspiciousDays: SuspiciousStudyDay[] = groups.map((relatedDateKeys) => {
    const recordedMinutes = relatedDateKeys.reduce((sum, key) => sum + (logs[key] ?? 0), 0)
    const intervalEstimate = relatedDateKeys.reduce((sum, key) => sum + (intervalMinutes[key] ?? 0), 0)
    const suggestedMinutes = Math.min(180, Math.max(0, Math.round(intervalEstimate || 180)))
    relatedDateKeys.forEach((key, index) => { safeLogs[key] = index === 0 ? suggestedMinutes : 0 })
    return { dateKey: relatedDateKeys[0], relatedDateKeys, recordedMinutes, suggestedMinutes }
  })
  return { safeLogs, suspiciousDays }
}

export function getLocalStudyAnomalies(scope?: CacheScope): SuspiciousStudyDay[] {
  return anomaliesMemory.get(scopeKey(scope)) ?? []
}

function saveLocalStudyAnomalies(anomalies: SuspiciousStudyDay[], scope?: CacheScope) {
  anomaliesMemory.set(scopeKey(scope), anomalies)
}

export async function repairStudyIncident(user: User | null, incident: SuspiciousStudyDay, minutes: number) {
  const keys = incident.relatedDateKeys.length ? incident.relatedDateKeys : [incident.dateKey]
  for (const [index, dateKey] of keys.entries()) await repairStudyDay(user, dateKey, index === 0 ? minutes : 0)
  saveLocalStudyAnomalies(getLocalStudyAnomalies(user).filter((item) => item.dateKey !== incident.dateKey), user)
}

/** Replace one suspicious day's derived records with a user-approved total. */
export async function repairStudyDay(user: User | null, dateKey: string, minutes: number) {
  const safeMinutes = Math.min(MAX_DAILY_FOCUS_MINUTES, Math.max(0, Math.round(minutes)))
  const logs = getLocalLogs(user)
  logs[dateKey] = safeMinutes
  saveLocalLogs(logs, user)

  const subjectLogs = getLocalSubjectLogs(user)
  const subjectsForDay = Object.entries(subjectLogs).filter(([, days]) => (days[dateKey] ?? 0) > 0)
  const previousTotal = subjectsForDay.reduce((sum, [, days]) => sum + (days[dateKey] ?? 0), 0)
  for (const [, days] of Object.entries(subjectLogs)) delete days[dateKey]
  if (safeMinutes > 0) {
    if (previousTotal > 0) {
      let assigned = 0
      subjectsForDay.forEach(([subject, days], index) => {
        const amount = index === subjectsForDay.length - 1
          ? safeMinutes - assigned
          : Math.round(safeMinutes * ((days[dateKey] ?? 0) / previousTotal))
        subjectLogs[subject] ??= {}
        subjectLogs[subject][dateKey] = Math.max(0, amount)
        assigned += amount
      })
    } else {
      subjectLogs[DEFAULT_SUBJECT] ??= {}
      subjectLogs[DEFAULT_SUBJECT][dateKey] = safeMinutes
    }
  }
  saveLocalSubjectLogs(subjectLogs, user)

  const dayStart = new Date(`${dateKey}T00:00:00`).getTime()
  const dayEnd = new Date(`${dateKey}T23:59:59.999`).getTime()
  saveLocalStudyIntervals(getLocalStudyIntervals(user).filter((interval) => {
    const start = Date.parse(interval.startedAt)
    const end = Date.parse(interval.endedAt)
    return end <= dayStart || start > dayEnd
  }), user)

  if (!user) return
  const startIso = new Date(dayStart).toISOString()
  const endIso = new Date(dayEnd + 1).toISOString()
  const { data: cloudSessions } = await supabase
    .from('study_sessions')
    .select('subject, duration_seconds')
    .eq('user_id', user.id)
    .eq('date_key', dateKey)
  const cloudBySubject = new Map<string, number>()
  for (const row of cloudSessions ?? []) {
    const subject = typeof row.subject === 'string' && row.subject.trim() ? row.subject : DEFAULT_SUBJECT
    cloudBySubject.set(subject, (cloudBySubject.get(subject) ?? 0) + Math.max(0, Number(row.duration_seconds) || 0))
  }
  const cloudTotal = [...cloudBySubject.values()].reduce((sum, value) => sum + value, 0)

  await Promise.all([
    supabase.from('daily_logs').upsert({ user_id: user.id, date_key: dateKey, total_minutes: safeMinutes, updated_at: new Date().toISOString() }, { onConflict: 'user_id,date_key' }),
    supabase.from('study_sessions').delete().eq('user_id', user.id).eq('date_key', dateKey),
    supabase.from('study_intervals').delete().eq('user_id', user.id).lt('started_at', endIso).gte('ended_at', startIso),
  ])
  if (safeMinutes > 0) {
    const rows = cloudTotal > 0
      ? [...cloudBySubject.entries()].map(([subject, seconds], index, all) => ({
          user_id: user.id,
          timer_mode: 'flow',
          mode: 'focus',
          subject,
          duration_seconds: (index === all.length - 1 ? safeMinutes - all.slice(0, -1).reduce((sum, [, value]) => sum + Math.round(safeMinutes * value / cloudTotal), 0) : Math.round(safeMinutes * seconds / cloudTotal)) * 60,
          date_key: dateKey,
        }))
      : [{ user_id: user.id, timer_mode: 'flow', mode: 'focus', subject: DEFAULT_SUBJECT, duration_seconds: safeMinutes * 60, date_key: dateKey }]
    await supabase.from('study_sessions').insert(rows.filter((row) => row.duration_seconds > 0))
  }
}
