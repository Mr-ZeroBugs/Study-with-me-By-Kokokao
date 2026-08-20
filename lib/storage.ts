import { supabase } from './supabase'
import type { User } from '@supabase/supabase-js'

export type DayLog = Record<string, number>

const LOCAL_STORAGE_KEY = 'study_timer_logs_v1'
const LOCAL_STORAGE_SESSIONS_KEY = 'study_timer_sessions_count_v1'

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
  checkDate.setDate(checkDate.getDate() - (hasStudiedToday ? 1 : 0))

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
  timerMode: 'flow' | 'countdown'
): Promise<{ updatedLogs: DayLog; newTotal: number }> {
  const todayKey = getLocalDateKey(new Date())
  const currentLogs = getLocalLogs()
  const newTotal = (currentLogs[todayKey] ?? 0) + durationMinutes
  
  const updatedLogs: DayLog = {
    ...currentLogs,
    [todayKey]: newTotal,
  }

  // Always save to LocalStorage immediately
  saveLocalLogs(updatedLogs)

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

  return { updatedLogs, newTotal }
}
