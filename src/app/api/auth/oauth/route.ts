import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// /api/auth/oauth — start a social sign-in (Google / Microsoft / Apple).
//   POST (JSON, for the app):  body { provider, role?, redirect_to? } → { url }
//   GET  (browser):            ?provider=&role=&redirect_to= → 302 to the provider
// Both set the PKCE code-verifier cookie that GET /api/auth/callback needs, so
// the browser GET flow keeps the cookie across the round-trip; the POST flow is
// for programmatic clients that manage the cookie themselves.
//   provider     'google' | 'microsoft' | 'apple'  (Microsoft → Supabase 'azure')
//   role         optional desired role for a NEW account (parent|student|tutor)
//   redirect_to  optional final URL/deep-link to land on after sign-in
// ---------------------------------------------------------------------------

type SupabaseProvider = 'google' | 'apple' | 'azure'
const PROVIDER_MAP: Record<string, SupabaseProvider> = {
  google: 'google',
  apple: 'apple',
  microsoft: 'azure',
  azure: 'azure',
}
const VALID_ROLES = new Set(['parent', 'student', 'tutor'])

// Validates inputs and asks Supabase for the provider authorization URL (which
// also sets the PKCE cookie on the response). Returns the url or an error+status.
async function buildAuthUrl(
  request: Request,
  provider: unknown,
  role: unknown,
  redirectTo: unknown
): Promise<{ url: string; provider: SupabaseProvider } | { error: string; status: number }> {
  const mapped = typeof provider === 'string' ? PROVIDER_MAP[provider.toLowerCase()] : undefined
  if (!mapped) return { error: 'provider must be one of: google, microsoft, apple', status: 400 }
  if (role !== undefined && role !== null && !VALID_ROLES.has(role as string)) {
    return { error: 'role must be one of: parent, student, tutor', status: 400 }
  }
  if (redirectTo !== undefined && redirectTo !== null && typeof redirectTo !== 'string') {
    return { error: 'redirect_to must be a string', status: 400 }
  }

  // The provider redirects back to our callback carrying the chosen role + the
  // app's final destination so the callback can apply them.
  const origin = new URL(request.url).origin
  const callback = new URL('/api/auth/callback', origin)
  if (role) callback.searchParams.set('role', role as string)
  if (redirectTo) callback.searchParams.set('next', redirectTo as string)

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: mapped,
    options: { redirectTo: callback.toString(), skipBrowserRedirect: true },
  })
  if (error || !data?.url) {
    console.error('[auth/oauth] signInWithOAuth error:', error)
    return { error: error?.message ?? 'Could not start sign-in', status: 400 }
  }
  return { url: data.url, provider: mapped }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { provider, role, redirect_to } = body as Record<string, unknown>
  const result = await buildAuthUrl(request, provider, role, redirect_to)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ url: result.url, provider: result.provider })
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams
  const result = await buildAuthUrl(request, q.get('provider'), q.get('role') ?? undefined, q.get('redirect_to') ?? undefined)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
  // 302 the browser to the provider; the PKCE cookie was set on this response.
  return NextResponse.redirect(result.url)
}
