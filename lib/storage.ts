import { supabase } from './supabase'
import type { User } from '@supabase/supabase-js'

export type DayLog = Record<string, number>
export type SubjectDayLogs = Record<string, DayLog>
export type CanonicalSubjectDayLog = {
  subjectId: string
  subjectName: string
  days: DayLog
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

const LOCAL_STORAGE_KEY = 'study_timer_logs_v1'
const LOCAL_STORAGE_SESSIONS_KEY = 'study_timer_sessions_count_v1'
const LOCAL_STORAGE_SUBJECT_LOGS_KEY = 'study_timer_subject_logs_v1'
const LOCAL_STORAGE_SUBJECTS_KEY = 'study_timer_subjects_v1'
const LOCAL_STORAGE_INTERVALS_KEY = 'study_timer_intervals_v1'
const LOCAL_STORAGE_ANOMALIES_KEY = 'study_timer_anomalies_v1'
const DEFAULT_SUBJECT = 'General'
export const MAX_DAILY_FOCUS_MINUTES = 24 * 60
export const MAX_CONTINUOUS_FOCUS_SECONDS = 4 * 60 * 60
export const SUSPICIOUS_DAILY_FOCUS_MINUTES = 12 * 60

type LocalStorageScope = User | null | undefined

// LocalStorage is shared by every account in the same browser. Keep the
// guest cache backwards-compatible, but give each signed-in user an isolated
// namespace so one account can never hydrate another account's study data.
function scopedStorageKey(baseKey: string, scope?: LocalStorageScope) {
  return scope?.id ? `${baseKey}_${scope.id}` : baseKey
}

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
 * Read logs from LocalStorage
 */
export function getLocalLogs(scope?: LocalStorageScope): DayLog {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(scopedStorageKey(LOCAL_STORAGE_KEY, scope))
    const parsed = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).map(([dateKey, minutes]) => [
      dateKey,
      Math.min(MAX_DAILY_FOCUS_MINUTES, Math.max(0, Number(minutes) || 0)),
    ]))
  } catch (err) {
    console.error('Error reading local logs:', err)
    return {}
  }
}

/**
 * Save logs to LocalStorage
 */
export function saveLocalLogs(logs: DayLog, scope?: LocalStorageScope) {
  if (typeof window === 'undefined') return
  try {
    const bounded = Object.fromEntries(Object.entries(logs).map(([dateKey, minutes]) => [
      dateKey,
      Math.min(MAX_DAILY_FOCUS_MINUTES, Math.max(0, Number(minutes) || 0)),
    ]))
    localStorage.setItem(scopedStorageKey(LOCAL_STORAGE_KEY, scope), JSON.stringify(bounded))
  } catch (err) {
    console.error('Error saving local logs:', err)
  }
}

/**
 * Read today's session rounds from LocalStorage
 */
export function getLocalRounds(todayKey: string, scope?: LocalStorageScope): number {
  if (typeof window === 'undefined') return 0
  try {
    const raw = localStorage.getItem(`${scopedStorageKey(LOCAL_STORAGE_SESSIONS_KEY, scope)}_${todayKey}`)
    return raw ? Number(raw) : 0
  } catch {
    return 0
  }
}

/**
 * Save today's session rounds to LocalStorage
 */
export function saveLocalRounds(todayKey: string, rounds: number, scope?: LocalStorageScope) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(`${scopedStorageKey(LOCAL_STORAGE_SESSIONS_KEY, scope)}_${todayKey}`, String(rounds))
  } catch {}
}

export function getLocalSubjects(scope?: LocalStorageScope): string[] {
  if (typeof window === 'undefined') return [DEFAULT_SUBJECT]
  try {
    const raw = localStorage.getItem(scopedStorageKey(LOCAL_STORAGE_SUBJECTS_KEY, scope))
    const parsed = raw ? JSON.parse(raw) : []
    const subjects = Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim())
      : []
    return Array.from(new Set([DEFAULT_SUBJECT, ...subjects]))
  } catch {
    return [DEFAULT_SUBJECT]
  }
}

export function saveLocalSubjects(subjects: string[], scope?: LocalStorageScope) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(scopedStorageKey(LOCAL_STORAGE_SUBJECTS_KEY, scope), JSON.stringify(Array.from(new Set([DEFAULT_SUBJECT, ...subjects]))))
  } catch {}
}

export function getLocalSubjectLogs(scope?: LocalStorageScope): SubjectDayLogs {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(scopedStorageKey(LOCAL_STORAGE_SUBJECT_LOGS_KEY, scope))
    return raw ? JSON.parse(raw) : {}
  } catch (err) {
    console.error('Error reading local subject logs:', err)
    return {}
  }
}

export function saveLocalSubjectLogs(logs: SubjectDayLogs, scope?: LocalStorageScope) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(scopedStorageKey(LOCAL_STORAGE_SUBJECT_LOGS_KEY, scope), JSON.stringify(logs))
  } catch (err) {
    console.error('Error saving local subject logs:', err)
  }
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

export function getLocalStudyIntervals(scope?: LocalStorageScope): StudyInterval[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(scopedStorageKey(LOCAL_STORAGE_INTERVALS_KEY, scope))
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.map(normalizeStudyInterval).filter((item): item is StudyInterval => Boolean(item))
      : []
  } catch {
    return []
  }
}

export function saveLocalStudyIntervals(intervals: StudyInterval[], scope?: LocalStorageScope) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(scopedStorageKey(LOCAL_STORAGE_INTERVALS_KEY, scope), JSON.stringify(intervals))
  } catch {}
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
    const merged = Array.from(new Map([...cloudIntervals, ...localIntervals].map((item) => [item.id, item])).values())
    saveLocalStudyIntervals(merged, user)
    return merged
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

function mergeSubjectLogs(base: SubjectDayLogs, incoming: SubjectDayLogs): SubjectDayLogs {
  const merged: SubjectDayLogs = Object.fromEntries(
    Object.entries(base).map(([subject, days]) => [subject, { ...days }])
  )
  for (const [subject, days] of Object.entries(incoming)) {
    merged[subject] ??= {}
    for (const [dateKey, minutes] of Object.entries(days)) {
      merged[subject][dateKey] = Math.max(merged[subject][dateKey] ?? 0, minutes)
    }
  }
  return merged
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
    const merged = mergeSubjectLogs(localSubjectLogs, cloudLogs)
    const safeDailyLogs = reconciledDailyLogs ?? await loadStudyLogs(user)
    const reconciled = reconcileSubjectLogsToDaily(merged, safeDailyLogs)
    saveLocalSubjectLogs(reconciled, user)
    // A subject may be created before it has any study sessions. Loading
    // analytics must never replace the explicit subject library with only the
    // subjects present in historical logs, or a brand-new subject disappears
    // as soon as the learner opens Tasks/Stats.
    saveLocalSubjects([...getLocalSubjects(user), ...Object.keys(reconciled)], user)
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
 * Fetch all study logs for the user (from Supabase if authenticated, merged with LocalStorage)
 */
export async function loadStudyLogs(user: User | null): Promise<DayLog> {
  const localLogs = getLocalLogs(user)

  const reconcile = (rawLogs: DayLog, intervals: StudyInterval[]) => {
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

  if (!user) {
    return reconcile(localLogs, getLocalStudyIntervals(null))
  }

  try {
    const [{ data, error }, intervalResponse] = await Promise.all([
      supabase.from('daily_logs').select('date_key, total_minutes').eq('user_id', user.id),
      supabase.from('study_intervals').select('id, started_at, ended_at, duration_seconds, timer_mode, mode, subject, subject_id').eq('user_id', user.id),
    ])

    if (error) {
      console.warn('Supabase fetch error, fallback to local logs:', error)
      return reconcile(localLogs, getLocalStudyIntervals(user))
    }

    const cloudLogs: DayLog = {}
    if (data) {
      for (const row of data) {
      cloudLogs[row.date_key] = Math.min(MAX_DAILY_FOCUS_MINUTES, Math.max(0, Number(row.total_minutes) || 0))
      }
    }

    // Merge cloud and local logs taking the higher value
    const merged: DayLog = { ...localLogs }
    for (const [key, minutes] of Object.entries(cloudLogs)) {
      merged[key] = Math.max(merged[key] ?? 0, minutes)
    }

    const cloudIntervals = (intervalResponse.data ?? []).map((row) => normalizeStudyInterval({
      id: row.id, startedAt: row.started_at, endedAt: row.ended_at, durationSeconds: row.duration_seconds,
      timerMode: row.timer_mode, mode: row.mode, subject: row.subject, subjectId: row.subject_id,
    })).filter((item): item is StudyInterval => Boolean(item))
    return reconcile(merged, [...cloudIntervals, ...getLocalStudyIntervals(user)])
  } catch (err) {
    console.error('Failed to load study logs from Supabase:', err)
    return reconcile(localLogs, getLocalStudyIntervals(user))
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

  // Always save to LocalStorage immediately
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

export function getLocalStudyAnomalies(scope?: LocalStorageScope): SuspiciousStudyDay[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(scopedStorageKey(LOCAL_STORAGE_ANOMALIES_KEY, scope)) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((item) => item?.dateKey && Array.isArray(item.relatedDateKeys)) : []
  } catch { return [] }
}

function saveLocalStudyAnomalies(anomalies: SuspiciousStudyDay[], scope?: LocalStorageScope) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(scopedStorageKey(LOCAL_STORAGE_ANOMALIES_KEY, scope), JSON.stringify(anomalies)) } catch {}
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
