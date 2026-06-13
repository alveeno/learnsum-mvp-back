import { createServerClient } from '@supabase/ssr'
import { cookies, headers } from 'next/headers'

// Creates a request-scoped Supabase client. Authentication works two ways:
//   • Web: the session lives in cookies (set by /api/auth/login, refreshed by
//     middleware) — the default @supabase/ssr behaviour.
//   • Mobile (Expo / React Native): the app holds the Supabase session itself
//     and sends `Authorization: Bearer <access_token>`. React Native cookie
//     handling is unreliable, so this is the robust transport for native apps.
// When a Bearer token is present it takes precedence: every PostgREST/Storage
// query runs under that token (so RLS still resolves auth.uid() to the caller),
// and auth.getUser() validates the token directly.
export async function createClient() {
  const cookieStore = await cookies()
  const headerStore = await headers()

  // Extract a Bearer token if the caller sent one (header name is case-insensitive).
  const bearer = headerStore.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Run DB/Storage requests under the user's JWT so RLS sees the real
      // auth.uid(); without this a Bearer caller would hit tables as `anon`.
      ...(bearer ? { global: { headers: { Authorization: `Bearer ${bearer}` } } } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component — middleware handles session refresh
          }
        },
      },
    }
  )

  // Routes call `supabase.auth.getUser()` with no argument. With a Bearer token
  // there is no cookie session to read, so default getUser() to validate the
  // token directly (getUser(jwt) checks it against the auth server). An explicit
  // getUser(otherJwt) still works.
  if (bearer) {
    const authClient = supabase.auth
    const originalGetUser = authClient.getUser.bind(authClient)
    authClient.getUser = ((jwt?: string) => originalGetUser(jwt ?? bearer)) as typeof authClient.getUser
  }

  return supabase
}
