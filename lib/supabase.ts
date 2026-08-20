import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jjuhmonumxapeidwgunt.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpqdWhtb251bXhhcGVpZHdndW50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyMzAwMzUsImV4cCI6MjEwMjgwNjAzNX0.JPKZ5IePLFMFh5lujRnCwRWVhEim8olVPb3TxWTh1I4'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
