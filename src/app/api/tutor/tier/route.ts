import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const VALID_TIERS = new Set(['free', 'premium', 'deluxe'])

// ---------------------------------------------------------------------------
// PATCH /api/tutor/tier  { tier: 'free' | 'premium' | 'deluxe' }
// Sets the signed-in tutor's subscription tier. No real payment yet — this backs
// the app's temporary tier switcher. RLS "tutor_profiles: owner update" guarantees
// a tutor can only change their own row.
// ---------------------------------------------------------------------------
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { tier?: string } | null
  const tier = body?.tier
  if (typeof tier !== 'string' || !VALID_TIERS.has(tier)) {
    return NextResponse.json({ error: 'tier must be one of: free, premium, deluxe' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('tutor_profiles')
    .update({ tier, updated_at: new Date().toISOString() })
    .eq('id', user.id)
    .select('tier')
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'No tutor profile for this user' }, { status: 404 })
    }
    console.error('[tutor/tier PATCH]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ tier: data.tier })
}
