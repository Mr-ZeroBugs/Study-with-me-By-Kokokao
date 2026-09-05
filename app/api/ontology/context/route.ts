import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { compilePersonalOntologySnapshot } from '@/lib/personal-ontology-context'
import { getPublicSupabaseConfig } from '@/lib/supabase-config'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 })

  const { url, anonKey } = getPublicSupabaseConfig()
  const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await authClient.auth.getUser(token)
  if (error || !data.user) return NextResponse.json({ error: 'Your session is no longer valid.' }, { status: 401 })

  try {
    // Authentication determines the user ID; the server compiler performs
    // only explicitly user-scoped reads and stores the account's latest backup.
    const snapshot = await compilePersonalOntologySnapshot(getSupabaseAdmin(), data.user.id, { persist: true })
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (contextError) {
    console.error('Personal Ontology context build failed:', contextError)
    return NextResponse.json({ error: 'Koko could not build your context yet.' }, { status: 503 })
  }
}
