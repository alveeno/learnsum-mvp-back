import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Daily contact-unlock allowance per tier.
const TIER_QUOTA: Record<string, number> = { free: 0, premium: 1, deluxe: 3 }

// Start of "today" in UTC — matches the app's ISO date key so the daily reset
// lines up on both sides.
function todayStartIso(): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

// ---------------------------------------------------------------------------
// GET /api/tutor/contact-quota → { remaining, unlocked }
//   remaining = tier allowance − unlocks created today
//   unlocked  = every seeker id this tutor has unlocked (permanent)
// ---------------------------------------------------------------------------
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { data: tutor } = await supabase
    .from('tutor_profiles')
    .select('tier')
    .eq('id', user.id)
    .maybeSingle()
  const allowance = TIER_QUOTA[tutor?.tier ?? 'free'] ?? 0

  const { data: unlocks, error } = await supabase
    .from('tutor_contact_unlocks')
    .select('seeker_id, created_at')
    .eq('tutor_id', user.id)
  if (error) {
    console.error('[contact-quota GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const today = todayStartIso()
  const usedToday = (unlocks ?? []).filter((u) => u.created_at >= today).length
  const unlocked = (unlocks ?? []).map((u) => u.seeker_id)

  return NextResponse.json({ remaining: Math.max(0, allowance - usedToday), unlocked })
}
