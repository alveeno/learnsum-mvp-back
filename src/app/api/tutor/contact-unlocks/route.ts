import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const TIER_QUOTA: Record<string, number> = { free: 0, premium: 1, deluxe: 3 }
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

function todayStartIso(): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

// Current { remaining, unlocked } for this tutor given their tier allowance.
async function quotaSnapshot(supabase: SupabaseClient, tutorId: string, allowance: number) {
  const { data: unlocks } = await supabase
    .from('tutor_contact_unlocks')
    .select('seeker_id, created_at')
    .eq('tutor_id', tutorId)
  const today = todayStartIso()
  const usedToday = (unlocks ?? []).filter((u) => u.created_at >= today).length
  return {
    remaining: Math.max(0, allowance - usedToday),
    unlocked: (unlocks ?? []).map((u) => u.seeker_id),
  }
}

// ---------------------------------------------------------------------------
// POST /api/tutor/contact-unlocks  { seeker_id }
// Spend one of today's tier allowance to permanently unlock a seeker — reveals
// their phone (GET /api/seekers/[id]) and lets the tutor reply in chat. Idempotent
// (already-unlocked is free). 403 when out of daily quota; the app reverts its
// optimistic unlock only on a 403 (see contactQuota.ts).
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { seeker_id?: string } | null
  const seekerId = body?.seeker_id
  if (typeof seekerId !== 'string' || !UUID_REGEX.test(seekerId)) {
    return NextResponse.json({ error: 'seeker_id (uuid) is required' }, { status: 400 })
  }

  const { data: tutor } = await supabase
    .from('tutor_profiles')
    .select('tier')
    .eq('id', user.id)
    .maybeSingle()
  if (!tutor) return NextResponse.json({ error: 'Not a tutor' }, { status: 403 })
  const allowance = TIER_QUOTA[tutor.tier ?? 'free'] ?? 0

  // Already unlocked → idempotent, free.
  const { data: existing } = await supabase
    .from('tutor_contact_unlocks')
    .select('id')
    .eq('tutor_id', user.id)
    .eq('seeker_id', seekerId)
    .maybeSingle()
  if (existing) return NextResponse.json(await quotaSnapshot(supabase, user.id, allowance))

  // Enforce the daily cap (free = 0 ⇒ always blocked).
  const snap = await quotaSnapshot(supabase, user.id, allowance)
  if (snap.remaining <= 0) {
    return NextResponse.json(
      {
        error:
          allowance === 0
            ? 'Upgrade to Premium or Deluxe to contact students.'
            : 'No contacts left today.',
      },
      { status: 403 }
    )
  }

  const { error: insertErr } = await supabase
    .from('tutor_contact_unlocks')
    .insert({ tutor_id: user.id, seeker_id: seekerId })
  if (insertErr) {
    if (insertErr.code === '23505') {
      // Race — already inserted; treat as success.
      return NextResponse.json(await quotaSnapshot(supabase, user.id, allowance))
    }
    if (insertErr.code === '23503') {
      return NextResponse.json({ error: 'Seeker not found' }, { status: 404 })
    }
    console.error('[contact-unlocks POST]', insertErr)
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  return NextResponse.json(await quotaSnapshot(supabase, user.id, allowance), { status: 201 })
}
