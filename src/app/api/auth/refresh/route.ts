import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// POST /api/auth/refresh  { refresh_token } → { user, session }
//
// Exchanges a Supabase refresh token for a fresh session (a new ~1h access token
// + a rotated refresh token). The Expo app has no cookie session in React
// Native — it stores the access token (Bearer) and the refresh token, and calls
// this on a 401 so a long-idle session stays logged in instead of forcing a
// re-login. Mirrors the login route's response shape.
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const refresh_token =
    body && typeof body === 'object' ? (body as { refresh_token?: unknown }).refresh_token : null

  if (!refresh_token || typeof refresh_token !== 'string') {
    return NextResponse.json({ error: 'refresh_token is required' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.refreshSession({ refresh_token })

  if (error || !data.session) {
    // Invalid / revoked / expired refresh token — the app clears the session.
    return NextResponse.json(
      { error: error?.message ?? 'Could not refresh session' },
      { status: 401 },
    )
  }

  return NextResponse.json({ user: data.user, session: data.session })
}
