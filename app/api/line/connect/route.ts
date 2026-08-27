import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { supabase } from '@/lib/supabase'

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

    // Generate 6-character uppercase alphanumeric code
    const randomSuffix = Math.floor(1000 + Math.random() * 9000).toString()
    const linkCode = `LINK-${randomSuffix}`
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString() // 15 mins

    const admin = getSupabaseAdmin()
    const { error: upsertError } = await admin
      .from('user_line_connections')
      .upsert({
        user_id: user.id,
        link_code: linkCode,
        link_code_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })

    if (upsertError) {
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
