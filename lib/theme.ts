'use client'

import type { User } from '@supabase/supabase-js'
import { loadAccountState, readEphemeralState, saveAccountState } from './account-state'

// ── Intensity Threshold ──────────────────────────────────────────────────────
// How many minutes = "high" (deep focus) on the study calendar.
// Default: 90 minutes = 1.5 hr
export const INTENSITY_UPDATED_EVENT = 'study-intensity-updated'
const DEFAULT_THRESHOLD = 90

function safe(value: unknown) {
  const minutes = Number(value)
  return Number.isFinite(minutes) && minutes >= 15 ? Math.round(minutes) : DEFAULT_THRESHOLD
}

export function getIntensityThreshold(user?: User | null) {
  return safe(readEphemeralState(user, 'study_preferences', { intensityMinutes: DEFAULT_THRESHOLD }).intensityMinutes)
}

export async function loadIntensityThreshold(user?: User | null) {
  const state = await loadAccountState(user, 'study_preferences', { intensityMinutes: DEFAULT_THRESHOLD })
  return safe(state.intensityMinutes)
}

export async function setIntensityThreshold(user: User | null | undefined, minutes: number) {
  const intensityMinutes = safe(minutes)
  await saveAccountState(user, 'study_preferences', { intensityMinutes })
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(INTENSITY_UPDATED_EVENT, { detail: intensityMinutes }))
}
