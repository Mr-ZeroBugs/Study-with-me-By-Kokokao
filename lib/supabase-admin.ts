import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { getPublicSupabaseConfig } from './supabase-config'

const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

export const getSupabaseAdmin = () => {
  if (!supabaseServiceRoleKey) {
    console.warn('SUPABASE_SERVICE_ROLE_KEY is not set. Admin queries may fail RLS.')
  }
  const { url, anonKey } = getPublicSupabaseConfig()
  return createClient(url, supabaseServiceRoleKey || anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
