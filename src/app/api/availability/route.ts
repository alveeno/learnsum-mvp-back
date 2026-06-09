import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Schema enum values — must stay in sync with 0001_initial_schema.sql
const VALID_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const VALID_SLOTS = new Set(['morning', 'afternoon', 'evening'])

type AvailabilityMap = Record<string, string[]>

// Validates the { [day]: string[] } shape, mirroring /api/filters.
// Example: { "mon": ["morning", "evening"], "sat": ["afternoon"] }
function validateAvailability(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'availability must be an object of the form { "mon": ["morning"], ... }'
  }

  for (const [day, slots] of Object.entries(value as Record<string, unknown>)) {
    if (!VALID_DAYS.includes(day as (typeof VALID_DAYS)[number])) {
      return `availability key "${day}" is invalid — must be one of: ${VALID_DAYS.join(', ')}`
    }
    if (!Array.isArray(slots)) {
      return `availability["${day}"] must be an array of time slots`
    }
    for (const slot of slots) {
      if (!VALID_SLOTS.has(slot)) {
        return `availability["${day}"] contains invalid slot "${slot}" — must be one of: ${[...VALID_SLOTS].join(', ')}`
      }
    }
  }

  return null
}

// Picks the availability table + owner column for the caller's role.
// Tutors store slots they can teach; students/parents store slots they need.
function tableForRole(role: string) {
  if (role === 'tutor') return { table: 'tutor_availability', ownerCol: 'tutor_id' } as const
  if (role === 'student' || role === 'parent') {
    return { table: 'seeker_availability', ownerCol: 'profile_id' } as const
  }
  return null
}

// Shared auth guard — returns { user } or a 401 response
async function requireAuth(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return { user: null, response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }
  return { user, response: null }
}

// Resolves the caller's role and the table it owns availability in.
async function resolveTarget(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
) {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single()

  if (error || !profile) {
    return { target: null, response: NextResponse.json({ error: 'Profile not found' }, { status: 404 }) }
  }

  const target = tableForRole(profile.role)
  if (!target) {
    return {
      target: null,
      response: NextResponse.json({ error: `role "${profile.role}" has no availability` }, { status: 400 }),
    }
  }
  return { target, response: null }
}

// Groups normalized rows into { [day]: slots[] }, days ordered Mon→Sun.
function groupSlots(rows: Array<{ day_of_week: string; time_slot: string }>): AvailabilityMap {
  const map: AvailabilityMap = {}
  for (const day of VALID_DAYS) {
    const slots = rows.filter((r) => r.day_of_week === day).map((r) => r.time_slot)
    if (slots.length) map[day] = slots
  }
  return map
}

// ---------------------------------------------------------------------------
// GET /api/availability
// Returns the authenticated user's availability as { [day]: slots[] }.
// Empty object if none set.
// ---------------------------------------------------------------------------
export async function GET() {
  const supabase = await createClient()
  const { user, response } = await requireAuth(supabase)
  if (!user) return response!

  const { target, response: targetErr } = await resolveTarget(supabase, user.id)
  if (!target) return targetErr!

  const { data, error } = await supabase
    .from(target.table)
    .select('day_of_week, time_slot')
    .eq(target.ownerCol, user.id)

  if (error) {
    console.error('[availability GET] Fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ availability: groupSlots(data ?? []) })
}

// ---------------------------------------------------------------------------
// PUT /api/availability
// Full-replace of the caller's availability. Body: { availability: { [day]: slots[] } }.
// Pass {} to clear all slots.
// ---------------------------------------------------------------------------
export async function PUT(request: Request) {
  const supabase = await createClient()
  const { user, response } = await requireAuth(supabase)
  if (!user) return response!

  const { target, response: targetErr } = await resolveTarget(supabase, user.id)
  if (!target) return targetErr!

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const availability = (body as { availability?: unknown }).availability
  if (availability === undefined) {
    return NextResponse.json({ error: 'availability is required (use {} to clear)' }, { status: 400 })
  }

  const validationError = validateAvailability(availability)
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  // Flatten to normalized rows, deduplicating slots within a day.
  const rows: Array<Record<string, string>> = []
  for (const [day, slots] of Object.entries(availability as AvailabilityMap)) {
    for (const slot of new Set(slots)) {
      rows.push({ [target.ownerCol]: user.id, day_of_week: day, time_slot: slot })
    }
  }

  // Full replace: clear existing rows, then insert the new set.
  // RLS restricts both operations to the caller's own rows.
  const { error: deleteError } = await supabase
    .from(target.table)
    .delete()
    .eq(target.ownerCol, user.id)

  if (deleteError) {
    console.error('[availability PUT] Delete error:', deleteError)
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  if (rows.length) {
    const { error: insertError } = await supabase.from(target.table).insert(rows)
    if (insertError) {
      // A tutor without a tutor_profiles row yet fails either the FK (23503)
      // or the owner-check RLS policy (42501) — both mean "no profile yet".
      if (insertError.code === '23503' || insertError.code === '42501') {
        return NextResponse.json(
          { error: 'Create your tutor profile before setting availability' },
          { status: 409 }
        )
      }
      console.error('[availability PUT] Insert error:', insertError)
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }
  }

  return NextResponse.json({ availability: availability as AvailabilityMap })
}
