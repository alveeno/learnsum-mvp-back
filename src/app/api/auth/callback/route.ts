import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// GET /api/auth/callback?code=...&role=...&next=...
// OAuth redirect target. Exchanges the authorization `code` for a session
// (sets the session cookies), assigns the chosen `role` to a brand-new account
// (only while onboarding_done is false), then sends the user on:
//   - if `next` is present → redirect there (e.g. an app deep link)
//   - otherwise → JSON { ok, user }
// Requires the PKCE code-verifier cookie set by POST /api/auth/oauth.
// ---------------------------------------------------------------------------

const VALID_ROLES = new Set(['parent', 'student', 'tutor'])

// Redirect to `next` with an appended error, else return a JSON error.
function fail(next: string | null, error: string, status: number) {
  if (next) {
    const url = new URL(next)
    url.searchParams.set('error', error)
    return NextResponse.redirect(url.toString())
  }
  return NextResponse.json({ error }, { status })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const role = url.searchParams.get('role')
  const next = url.searchParams.get('next')
  const providerError = url.searchParams.get('error_description') || url.searchParams.get('error')

  // The provider can redirect back with an error (e.g. user cancelled consent).
  if (providerError) {
    return fail(next, providerError, 400)
  }
  if (!code) {
    return fail(next, 'Missing authorization code', 400)
  }

  const supabase = await createClient()

  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error || !data.user) {
    console.error('[auth/callback] exchangeCodeForSession error:', error)
    return fail(next, error?.message ?? 'Could not complete sign-in', 400)
  }

  // Assign the chosen role to a new account (before onboarding is finished).
  // A returning user already has their role + onboarding_done = true, so this
  // is skipped — a crafted link can't flip an established user's role.
  if (role && VALID_ROLES.has(role)) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('onboarding_done')
      .eq('id', data.user.id)
      .single()
    if (profile && !profile.onboarding_done) {
      const { error: roleError } = await supabase
        .from('profiles')
        .update({ role, updated_at: new Date().toISOString() })
        .eq('id', data.user.id)
      if (roleError) {
        console.error('[auth/callback] role assignment error:', roleError)
      }
    }
  }

  if (next) {
    return NextResponse.redirect(next)
  }
  return NextResponse.json({ ok: true, user: data.user })
}
