'use client'

export type AppTheme = 'cozy' | 'light' | 'dark-glass'

const THEME_STORAGE_KEY = 'study_timer_theme_v2'

export function getStoredTheme(): AppTheme {
  if (typeof window === 'undefined') return 'cozy'
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY) as AppTheme | null
    if (saved === 'cozy' || saved === 'light' || saved === 'dark-glass') {
      return saved
    }
    return 'cozy'
  } catch {
    return 'cozy'
  }
}

export function setAppTheme(theme: AppTheme) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
    document.documentElement.setAttribute('data-theme', theme)
  } catch (err) {
    console.error('Failed to set theme:', err)
  }
}

export function initTheme() {
  if (typeof window === 'undefined') return
  const current = getStoredTheme()
  document.documentElement.setAttribute('data-theme', current)
}

// ── Intensity Threshold ──────────────────────────────────────────────────────
// How many minutes = "high" (deep focus) on the study calendar.
// Default: 90 minutes = 1.5 hr
const INTENSITY_KEY = 'study_intensity_threshold'
const DEFAULT_THRESHOLD = 90

export function getIntensityThreshold(): number {
  if (typeof window === 'undefined') return DEFAULT_THRESHOLD
  try {
    const saved = parseInt(localStorage.getItem(INTENSITY_KEY) ?? '', 10)
    return Number.isFinite(saved) && saved >= 15 ? saved : DEFAULT_THRESHOLD
  } catch {
    return DEFAULT_THRESHOLD
  }
}

export function setIntensityThreshold(minutes: number) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(INTENSITY_KEY, String(Math.round(minutes)))
    // Broadcast to other components on the same page
    window.dispatchEvent(new StorageEvent('storage', {
      key: INTENSITY_KEY,
      newValue: String(Math.round(minutes)),
      storageArea: localStorage,
    }))
  } catch (err) {
    console.error('Failed to set intensity threshold:', err)
  }
}

