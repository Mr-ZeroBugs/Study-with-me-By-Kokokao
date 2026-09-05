import { createClient } from '@supabase/supabase-js'
import { getPublicSupabaseConfig } from './supabase-config'

const { url: supabaseUrl, anonKey: supabaseAnonKey } = getPublicSupabaseConfig()

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
