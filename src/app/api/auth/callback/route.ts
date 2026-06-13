import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// GET /api/auth/callback?code=...&role=...&next=...
// OAuth redirect target. Exchanges the authorization `code` for a session
// (sets the session cookies), assigns the chosen `role` to a brand-new account
// (only while onboarding_done is false), then sends the user on:
//   - if `next` is a TRUSTED target → redirect there (e.g. an app deep link)
//   - otherwise → JSON { ok, user }
// `next` is allowlist-validated to prevent an open redirect (a crafted link
// could otherwise bounce an authenticated user to an attacker's site).
// Requires the PKCE code-verifier cookie set by POST /api/auth/oauth.
// ---------------------------------------------------------------------------

const VALID_ROLES = new Set(['parent', 'student', 'tutor'])

// Extra trusted redirect prefixes beyond the API's own origin: a comma-separated
// list (e.g. "learnsum://,https://app.learnsum.com"). Set this to the Expo
// deep-link scheme + production web origin when wiring the frontend.
function redirectAllowlist(): string[] {
  return (process.env.OAUTH_REDIRECT_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

// Validates the caller-supplied `next` to prevent an open redirect. Returns a
// safe absolute target, or null (callers then fall back to a JSON response).
// Allowed: same-origin relative paths, the request's own origin, and any prefix
// in OAUTH_REDIRECT_ALLOWLIST. Rejects protocol-relative ("//evil") and other
// off-origin targets.
function safeRedirect(next: string | null, origin: string): string | null {
  if (!next) return null
  // Same-origin relative path — reject "//evil.com" and "/\evil.com" tricks.
  if (next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')) {
    return origin + next
  }
  const allowed = [origin, ...redirectAllowlist()]
  if (allowed.some((prefix) => prefix.length > 0 && next.startsWith(prefix))) {
    return next
  }
  return null
}

// Redirect to a pre-validated target with the error appended, else return JSON.
function fail(safeNext: string | null, error: string, status: number) {
  if (safeNext) {
    try {
      const u = new URL(safeNext)
      u.searchParams.set('error', error)
      return NextResponse.redirect(u.toString())
    } catch {
      // safeNext wasn't parseable — fall through to JSON.
    }
  }
  return NextResponse.json({ error }, { status })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const role = url.searchParams.get('role')
  const providerError = url.searchParams.get('error_description') || url.searchParams.get('error')

  // Validate the redirect target ONCE, up front — every exit path uses safeNext.
  const safeNext = safeRedirect(url.searchParams.get('next'), url.origin)

  // The provider can redirect back with an error (e.g. user cancelled consent).
  if (providerError) {
    return fail(safeNext, providerError, 400)
  }
  if (!code) {
    return fail(safeNext, 'Missing authorization code', 400)
  }

  const supabase = await createClient()

  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error || !data.user) {
    console.error('[auth/callback] exchangeCodeForSession error:', error)
    return fail(safeNext, error?.message ?? 'Could not complete sign-in', 400)
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

  if (safeNext) {
    return NextResponse.redirect(safeNext)
  }
  return NextResponse.json({ ok: true, user: data.user })
}
