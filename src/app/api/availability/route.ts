import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Schema enum values — must stay in sync with 0001 / 0007.
const VALID_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
type Day = (typeof VALID_DAYS)[number]

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// A time range in minutes from midnight: { start: 540, end: 720 } = 09:00–12:00.
type Range = { start: number; end: number }
type AvailabilityMap = Record<string, Range[]>

// Validates { [day]: [{ start, end }, ...] } — minutes 0..1440, start < end.
function validateAvailability(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'availability must be an object of the form { "mon": [{ "start": 540, "end": 720 }], ... }'
  }

  for (const [day, ranges] of Object.entries(value as Record<string, unknown>)) {
    if (!VALID_DAYS.includes(day as Day)) {
      return `availability key "${day}" is invalid — must be one of: ${VALID_DAYS.join(', ')}`
    }
    if (!Array.isArray(ranges)) {
      return `availability["${day}"] must be an array of { start, end } ranges`
    }
    for (const r of ranges) {
      if (typeof r !== 'object' || r === null || Array.isArray(r)) {
        return `availability["${day}"] entries must be { start, end } objects (minutes from midnight)`
      }
      const { start, end } = r as { start?: unknown; end?: unknown }
      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        return `availability["${day}"] start/end must be whole numbers (minutes from midnight)`
      }
      if ((start as number) < 0 || (end as number) > 1440 || (start as number) >= (end as number)) {
        return `availability["${day}"] needs 0 ≤ start < end ≤ 1440`
      }
    }
  }

  return null
}

// Groups normalized rows into { [day]: ranges[] }, days Mon→Sun, ranges sorted.
function groupRanges(
  rows: Array<{ day_of_week: string; start_min: number; end_min: number }>
): AvailabilityMap {
  const map: AvailabilityMap = {}
  for (const day of VALID_DAYS) {
    const ranges = rows
      .filter((r) => r.day_of_week === day)
      .map((r) => ({ start: r.start_min, end: r.end_min }))
      .sort((a, b) => a.start - b.start || a.end - b.end)
    if (ranges.length) map[day] = ranges
  }
  return map
}

// Describes where a caller's availability lives: which table, and the
// owner-identifying columns used both to filter (GET/delete) and to stamp on
// inserted rows.
type Target = { table: string; owner: Record<string, string> }

// Shared auth guard — returns { user } or a 401 response.
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

// Resolves the caller's role → availability target.
// Tutors store what they can teach; students store what they need; parents store
// per child, so they must pass a child_id they own.
async function resolveTarget(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  childId: string | null
): Promise<{ target: Target | null; response: NextResponse | null }> {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single()

  if (error || !profile) {
    return { target: null, response: NextResponse.json({ error: 'Profile not found' }, { status: 404 }) }
  }

  if (profile.role === 'tutor') {
    return { target: { table: 'tutor_availability', owner: { tutor_id: userId } }, response: null }
  }

  if (profile.role === 'student') {
    return {
      target: { table: 'seeker_availability', owner: { owner_id: userId, owner_type: 'student' } },
      response: null,
    }
  }

  if (profile.role === 'parent') {
    if (!childId) {
      return { target: null, response: NextResponse.json({ error: 'child_id is required for parents' }, { status: 400 }) }
    }
    if (!UUID_REGEX.test(childId)) {
      return { target: null, response: NextResponse.json({ error: 'child_id must be a valid UUID' }, { status: 400 }) }
    }
    // child_profiles RLS is owner-only, so this only resolves the parent's own child.
    const { data: child, error: childErr } = await supabase
      .from('child_profiles')
      .select('id')
      .eq('id', childId)
      .single()

    if (childErr || !child) {
      return { target: null, response: NextResponse.json({ error: 'Child not found' }, { status: 404 }) }
    }

    return {
      target: { table: 'seeker_availability', owner: { owner_id: childId, owner_type: 'child' } },
      response: null,
    }
  }

  return {
    target: null,
    response: NextResponse.json({ error: `role "${profile.role}" has no availability` }, { status: 400 }),
  }
}

// ---------------------------------------------------------------------------
// GET /api/availability        (parents: GET /api/availability?child_id=...)
// Returns the caller's availability as { [day]: [{ start, end }] }.
// ---------------------------------------------------------------------------
export async function GET(request: Request) {
  const supabase = await createClient()
  const { user, response } = await requireAuth(supabase)
  if (!user) return response!

  const childId = new URL(request.url).searchParams.get('child_id')
  const { target, response: targetErr } = await resolveTarget(supabase, user.id, childId)
  if (!target) return targetErr!

  let query = supabase.from(target.table).select('day_of_week, start_min, end_min')
  for (const [col, val] of Object.entries(target.owner)) query = query.eq(col, val)

  const { data, error } = await query

  if (error) {
    console.error('[availability GET] Fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ availability: groupRanges(data ?? []) })
}

// ---------------------------------------------------------------------------
// PUT /api/availability
// Full-replace of the caller's availability.
// Body: { availability: { [day]: [{ start, end }] }, child_id?: string }.
// Pass availability: {} to clear all ranges. Parents must include child_id.
// ---------------------------------------------------------------------------
export async function PUT(request: Request) {
  const supabase = await createClient()
  const { user, response } = await requireAuth(supabase)
  if (!user) return response!

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const childId = (body as { child_id?: unknown }).child_id
  if (childId !== undefined && typeof childId !== 'string') {
    return NextResponse.json({ error: 'child_id must be a string' }, { status: 400 })
  }

  const { target, response: targetErr } = await resolveTarget(supabase, user.id, childId ?? null)
  if (!target) return targetErr!

  const availability = (body as { availability?: unknown }).availability
  if (availability === undefined) {
    return NextResponse.json({ error: 'availability is required (use {} to clear)' }, { status: 400 })
  }

  const validationError = validateAvailability(availability)
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  // Flatten to rows, deduplicating identical ranges within a day.
  const rows: Array<Record<string, unknown>> = []
  for (const [day, ranges] of Object.entries(availability as AvailabilityMap)) {
    const seen = new Set<string>()
    for (const { start, end } of ranges) {
      const key = `${start}-${end}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({ ...target.owner, day_of_week: day, start_min: start, end_min: end })
    }
  }

  // Full replace: clear existing rows, then insert the new set.
  // RLS restricts both operations to rows the caller owns.
  let del = supabase.from(target.table).delete()
  for (const [col, val] of Object.entries(target.owner)) del = del.eq(col, val)
  const { error: deleteError } = await del

  if (deleteError) {
    console.error('[availability PUT] Delete error:', deleteError)
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  if (rows.length) {
    const { error: insertError } = await supabase.from(target.table).insert(rows)
    if (insertError) {
      // A tutor without a tutor_profiles row yet fails the FK (23503) or the
      // owner-check RLS policy (42501) — both mean "no profile yet".
      if (insertError.code === '23503' || insertError.code === '42501') {
        return NextResponse.json(
          { error: 'Create your profile before setting availability' },
          { status: 409 }
        )
      }
      console.error('[availability PUT] Insert error:', insertError)
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }
  }

  return NextResponse.json({ availability: availability as AvailabilityMap })
}
