import { NextResponse } from 'next/server'

// ---------------------------------------------------------------------------
// POST /api/auth/logout   (optional body: { refresh_token })
//
// Revokes the caller's Supabase refresh token(s) so a logged-out session can't
// be resumed. React Native has no cookie session (the app holds the tokens and
// sends `Authorization: Bearer <access_token>`), so the old cookie-based
// `supabase.auth.signOut()` was a no-op here. Instead we hit GoTrue's global
// sign-out directly with the caller's access token; if that token is missing or
// expired, we mint a fresh one from the refresh token first (which also rotates
// the old one). scope=global invalidates every refresh token for the user.
//
// Best-effort: the app has already cleared its local session before calling
// this, so any failure here must not surface as a logout failure.
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return NextResponse.json({ success: true })

  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  const body = await request.json().catch(() => null)
  const refreshToken =
    body && typeof body === 'object' ? (body as { refresh_token?: unknown }).refresh_token : null

  // Global sign-out with a given access token → revokes all the user's refresh
  // tokens. Returns true on success (204); false if the token was rejected.
  const revokeWith = async (accessToken: string): Promise<boolean> => {
    const res = await fetch(`${url}/auth/v1/logout?scope=global`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, apikey: anonKey },
    })
    return res.ok
  }

  try {
    // 1) Fast path — the caller's (usually fresh) access token.
    if (bearer && (await revokeWith(bearer))) {
      return NextResponse.json({ success: true })
    }
    // 2) Fallback — the access token was missing/expired; mint a fresh one from
    //    the refresh token, then revoke.
    if (typeof refreshToken === 'string' && refreshToken) {
      const res = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anonKey },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      if (res.ok) {
        const data = (await res.json()) as { access_token?: string }
        if (data.access_token) await revokeWith(data.access_token)
      }
    }
  } catch {
    // Best-effort — the client is already logged out locally.
  }

  return NextResponse.json({ success: true })
}
