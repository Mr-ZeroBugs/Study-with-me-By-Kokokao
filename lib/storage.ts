import { supabase } from './supabase'
import type { User } from '@supabase/supabase-js'

export type DayLog = Record<string, number>
export type SubjectDayLogs = Record<string, DayLog>
export type StudyInterval = {
  id: string
  startedAt: string
  endedAt: string
  durationSeconds: number
  timerMode: 'flow' | 'countdown'
  mode: 'focus' | 'short' | 'long'
  subject: string
}

const LOCAL_STORAGE_KEY = 'study_timer_logs_v1'
const LOCAL_STORAGE_SESSIONS_KEY = 'study_timer_sessions_count_v1'
const LOCAL_STORAGE_SUBJECT_LOGS_KEY = 'study_timer_subject_logs_v1'
const LOCAL_STORAGE_SUBJECTS_KEY = 'study_timer_subjects_v1'
const LOCAL_STORAGE_INTERVALS_KEY = 'study_timer_intervals_v1'
const DEFAULT_SUBJECT = 'General'

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
export function getLocalLogs(): DayLog {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch (err) {
    console.error('Error reading local logs:', err)
    return {}
  }
}

/**
 * Save logs to LocalStorage
 */
export function saveLocalLogs(logs: DayLog) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(logs))
  } catch (err) {
    console.error('Error saving local logs:', err)
  }
}

/**
 * Read today's session rounds from LocalStorage
 */
export function getLocalRounds(todayKey: string): number {
  if (typeof window === 'undefined') return 0
  try {
    const raw = localStorage.getItem(`${LOCAL_STORAGE_SESSIONS_KEY}_${todayKey}`)
    return raw ? Number(raw) : 0
  } catch {
    return 0
  }
}

/**
 * Save today's session rounds to LocalStorage
 */
export function saveLocalRounds(todayKey: string, rounds: number) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(`${LOCAL_STORAGE_SESSIONS_KEY}_${todayKey}`, String(rounds))
  } catch {}
}

export function getLocalSubjects(): string[] {
  if (typeof window === 'undefined') return [DEFAULT_SUBJECT]
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_SUBJECTS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    const subjects = Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim())
      : []
    return Array.from(new Set([DEFAULT_SUBJECT, ...subjects]))
  } catch {
    return [DEFAULT_SUBJECT]
  }
}

export function saveLocalSubjects(subjects: string[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(LOCAL_STORAGE_SUBJECTS_KEY, JSON.stringify(Array.from(new Set([DEFAULT_SUBJECT, ...subjects]))))
  } catch {}
}

export function getLocalSubjectLogs(): SubjectDayLogs {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_SUBJECT_LOGS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch (err) {
    console.error('Error reading local subject logs:', err)
    return {}
  }
}

export function saveLocalSubjectLogs(logs: SubjectDayLogs) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(LOCAL_STORAGE_SUBJECT_LOGS_KEY, JSON.stringify(logs))
  } catch (err) {
    console.error('Error saving local subject logs:', err)
  }
}

function normalizeStudyInterval(value: unknown): StudyInterval | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<StudyInterval>
  if (typeof candidate.id !== 'string' || typeof candidate.startedAt !== 'string' || typeof candidate.endedAt !== 'string') return null
  const durationSeconds = Number(candidate.durationSeconds)
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null
  return {
    id: candidate.id,
    startedAt: candidate.startedAt,
    endedAt: candidate.endedAt,
    durationSeconds: Math.round(durationSeconds),
    timerMode: candidate.timerMode === 'countdown' ? 'countdown' : 'flow',
    mode: candidate.mode === 'short' || candidate.mode === 'long' ? candidate.mode : 'focus',
    subject: typeof candidate.subject === 'string' && candidate.subject.trim() ? candidate.subject.trim() : DEFAULT_SUBJECT,
  }
}

export function createStudyIntervalId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function getLocalStudyIntervals(): StudyInterval[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_INTERVALS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.map(normalizeStudyInterval).filter((item): item is StudyInterval => Boolean(item))
      : []
  } catch {
    return []
  }
}

export function saveLocalStudyIntervals(intervals: StudyInterval[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(LOCAL_STORAGE_INTERVALS_KEY, JSON.stringify(intervals))
  } catch {}
}

/** Fetch the start/stop segments used by the daily focus timeline. */
export async function loadStudyIntervals(user: User | null): Promise<StudyInterval[]> {
  const localIntervals = getLocalStudyIntervals()
  if (!user) return localIntervals

  try {
    const { data, error } = await supabase
      .from('study_intervals')
      .select('id, started_at, ended_at, duration_seconds, timer_mode, mode, subject')
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
    })).filter((item): item is StudyInterval => Boolean(item))
    const merged = Array.from(new Map([...cloudIntervals, ...localIntervals].map((item) => [item.id, item])).values())
    saveLocalStudyIntervals(merged)
    return merged
  } catch {
    return localIntervals
  }
}

/** Persist one continuous running segment when the timer is paused or stopped. */
export async function recordStudyInterval(user: User | null, interval: StudyInterval) {
  const normalized = normalizeStudyInterval(interval)
  if (!normalized) return
  const existing = getLocalStudyIntervals()
  if (!existing.some((item) => item.id === normalized.id)) saveLocalStudyIntervals([...existing, normalized])

  if (!user) return
  try {
    await supabase.from('study_intervals').insert({
      id: normalized.id,
      user_id: user.id,
      started_at: normalized.startedAt,
      ended_at: normalized.endedAt,
      duration_seconds: normalized.durationSeconds,
      timer_mode: normalized.timerMode,
      mode: normalized.mode,
      subject: normalized.subject,
    })
  } catch {}
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
export async function loadSubjectLogs(user: User | null): Promise<SubjectDayLogs> {
  const localSubjectLogs = getLocalSubjectLogs()
  const localLogs = getLocalLogs()

  // Older installs only have the aggregate log. Keep that history visible under General.
  for (const [dateKey, minutes] of Object.entries(localLogs)) {
    const knownMinutes = Object.values(localSubjectLogs).reduce((sum, days) => sum + (days[dateKey] ?? 0), 0)
    if (knownMinutes === 0 && minutes > 0) {
      localSubjectLogs[DEFAULT_SUBJECT] ??= {}
      localSubjectLogs[DEFAULT_SUBJECT][dateKey] = minutes
    }
  }

  if (!user) return localSubjectLogs

  try {
    const { data, error } = await supabase
      .from('study_sessions')
      .select('subject, date_key, duration_seconds')
      .eq('user_id', user.id)

    if (error || !data) return localSubjectLogs

    const cloudLogs: SubjectDayLogs = {}
    for (const row of data) {
      const subject = typeof row.subject === 'string' && row.subject.trim() ? row.subject.trim() : DEFAULT_SUBJECT
      cloudLogs[subject] ??= {}
      cloudLogs[subject][row.date_key] = (cloudLogs[subject][row.date_key] ?? 0) + Math.max(0, Math.round((row.duration_seconds ?? 0) / 60))
    }
    const merged = mergeSubjectLogs(localSubjectLogs, cloudLogs)
    saveLocalSubjectLogs(merged)
    saveLocalSubjects(Object.keys(merged))
    return merged
  } catch (err) {
    console.error('Failed to load subject logs from Supabase:', err)
    return localSubjectLogs
  }
}

/**
 * Fetch all study logs for the user (from Supabase if authenticated, merged with LocalStorage)
 */
export async function loadStudyLogs(user: User | null): Promise<DayLog> {
  const localLogs = getLocalLogs()

  if (!user) {
    return localLogs
  }

  try {
    const { data, error } = await supabase
      .from('daily_logs')
      .select('date_key, total_minutes')
      .eq('user_id', user.id)

    if (error) {
      console.warn('Supabase fetch error, fallback to local logs:', error)
      return localLogs
    }

    const cloudLogs: DayLog = {}
    if (data) {
      for (const row of data) {
        cloudLogs[row.date_key] = row.total_minutes
      }
    }

    // Merge cloud and local logs taking the higher value
    const merged: DayLog = { ...localLogs }
    for (const [key, minutes] of Object.entries(cloudLogs)) {
      merged[key] = Math.max(merged[key] ?? 0, minutes)
    }

    saveLocalLogs(merged)
    return merged
  } catch (err) {
    console.error('Failed to load study logs from Supabase:', err)
    return localLogs
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
  subject = DEFAULT_SUBJECT
): Promise<{ updatedLogs: DayLog; updatedSubjectLogs: SubjectDayLogs; newTotal: number }> {
  const todayKey = getLocalDateKey(new Date())
  const safeSubject = subject.trim() || DEFAULT_SUBJECT
  const currentLogs = getLocalLogs()
  const currentSubjectLogs = getLocalSubjectLogs()
  const newTotal = (currentLogs[todayKey] ?? 0) + durationMinutes
  
  const updatedLogs: DayLog = {
    ...currentLogs,
    [todayKey]: newTotal,
  }

  // Always save to LocalStorage immediately
  saveLocalLogs(updatedLogs)
  const updatedSubjectLogs: SubjectDayLogs = {
    ...currentSubjectLogs,
    [safeSubject]: {
      ...(currentSubjectLogs[safeSubject] ?? {}),
      [todayKey]: (currentSubjectLogs[safeSubject]?.[todayKey] ?? 0) + durationMinutes,
    },
  }
  saveLocalSubjectLogs(updatedSubjectLogs)
  saveLocalSubjects([...getLocalSubjects(), safeSubject])

  // If user is logged in, sync to Supabase
  if (user) {
    try {
      // 1. Record session detail
      await supabase.from('study_sessions').insert({
        user_id: user.id,
        timer_mode: timerMode,
        mode: mode,
        duration_seconds: durationMinutes * 60,
        date_key: todayKey,
        subject: safeSubject,
      })

      // 2. Upsert aggregated daily log
      const { data: existing } = await supabase
        .from('daily_logs')
        .select('id, total_minutes, rounds')
        .eq('user_id', user.id)
        .eq('date_key', todayKey)
        .maybeSingle()

      if (existing) {
        await supabase
          .from('daily_logs')
          .update({
            total_minutes: existing.total_minutes + durationMinutes,
            rounds: (existing.rounds || 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
      } else {
        await supabase.from('daily_logs').insert({
          user_id: user.id,
          date_key: todayKey,
          total_minutes: durationMinutes,
          rounds: 1,
        })
      }
    } catch (err) {
      console.error('Failed to sync study session to Supabase:', err)
    }
  }

  return { updatedLogs, updatedSubjectLogs, newTotal }
}
