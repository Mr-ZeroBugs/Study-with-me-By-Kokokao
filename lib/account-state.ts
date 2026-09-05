import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

const memory = new Map<string, unknown>()
let accountStateTableUnavailable = false
let didReportUnavailableTable = false

function key(user: User | null | undefined, namespace: string) {
  return `${user?.id ?? 'guest'}:${namespace}`
}

function isMissingAccountStateTable(error: { code?: string; message?: string } | null) {
  return error?.code === 'PGRST205'
    || error?.code === '42P01'
    || /user_app_state|schema cache|relation .* does not exist/i.test(error?.message ?? '')
}

function reportUnavailableTable() {
  if (didReportUnavailableTable) return
  didReportUnavailableTable = true
  console.warn('Account state is waiting for Supabase migration 012_account_app_state.sql. Using this tab only until it is applied.')
}

export function readEphemeralState<T>(user: User | null | undefined, namespace: string, fallback: T): T {
  return (memory.get(key(user, namespace)) as T | undefined) ?? fallback
}

export function writeEphemeralState<T>(user: User | null | undefined, namespace: string, value: T) {
  memory.set(key(user, namespace), value)
}

export async function loadAccountState<T>(user: User | null | undefined, namespace: string, fallback: T): Promise<T> {
  if (!user) return readEphemeralState(user, namespace, fallback)
  if (accountStateTableUnavailable) return readEphemeralState(user, namespace, fallback)
  const { data, error } = await supabase
    .from('user_app_state')
    .select('payload')
    .eq('user_id', user.id)
    .eq('namespace', namespace)
    .maybeSingle()
  if (error) {
    if (isMissingAccountStateTable(error)) {
      accountStateTableUnavailable = true
      reportUnavailableTable()
      return readEphemeralState(user, namespace, fallback)
    }
    throw error
  }
  const value = (data?.payload as T | undefined) ?? fallback
  writeEphemeralState(user, namespace, value)
  return value
}

export async function saveAccountState<T>(user: User | null | undefined, namespace: string, value: T) {
  writeEphemeralState(user, namespace, value)
  if (!user) return
  if (accountStateTableUnavailable) return
  const { error } = await supabase.from('user_app_state').upsert({
    user_id: user.id,
    namespace,
    payload: value,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,namespace' })
  if (error) {
    if (isMissingAccountStateTable(error)) {
      accountStateTableUnavailable = true
      reportUnavailableTable()
      return
    }
    throw error
  }
}

export async function removeAccountState(user: User | null | undefined, namespace: string) {
  memory.delete(key(user, namespace))
  if (!user) return
  if (accountStateTableUnavailable) return
  const { error } = await supabase.from('user_app_state').delete().eq('user_id', user.id).eq('namespace', namespace)
  if (error) {
    if (isMissingAccountStateTable(error)) {
      accountStateTableUnavailable = true
      reportUnavailableTable()
      return
    }
    throw error
  }
}
