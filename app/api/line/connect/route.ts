import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { supabase } from '@/lib/supabase'
import { randomInt } from 'crypto'

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getSupabaseAdmin()
    const { data: connection } = await admin
      .from('user_line_connections')
      .select('line_user_id, link_code, link_code_expires_at')
      .eq('user_id', user.id)
      .maybeSingle()

    const isConnected = Boolean(connection?.line_user_id)
    const isCodeValid = connection?.link_code && connection.link_code_expires_at && new Date(connection.link_code_expires_at) > new Date()

    return NextResponse.json({
      isConnected,
      lineUserId: connection?.line_user_id || null,
      activeCode: isCodeValid ? connection.link_code : null,
      expiresAt: isCodeValid ? connection.link_code_expires_at : null,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString() // 15 mins

    const admin = getSupabaseAdmin()
    let linkCode = ''
    let upsertError: { message?: string; code?: string } | null = null

    // Ten numeric characters make accidental collisions practically
    // impossible. Retry if the database unique index catches a race.
    for (let attempt = 0; attempt < 5 && !linkCode; attempt += 1) {
      const randomSuffix = randomInt(1_000_000_000, 10_000_000_000).toString()
      const candidate = `LINK-${randomSuffix}`
      const response = await admin
        .from('user_line_connections')
        .upsert({
          user_id: user.id,
          link_code: candidate,
          link_code_expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' })

      upsertError = response.error
      if (!response.error) linkCode = candidate
      else if (response.error.code !== '23505') break
    }

    if (!linkCode) {
      console.error('Failed to generate link code:', upsertError)
      return NextResponse.json({ error: 'Failed to generate code' }, { status: 500 })
    }

    return NextResponse.json({
      linkCode,
      expiresAt,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getSupabaseAdmin()
    await admin
      .from('user_line_connections')
      .update({
        line_user_id: null,
        link_code: null,
        link_code_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 })
  }
}
