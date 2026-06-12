import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Schema enum values — must stay in sync with 0001_initial_schema.sql
const VALID_LANGUAGES = new Set(['english', 'cantonese', 'mandarin'])

const VALID_DISTRICTS = new Set([
  'CentralWestern', 'WanChai', 'Eastern', 'Southern',
  'YauTsimMong', 'ShamshuiPo', 'KowloonCity', 'WongTaiSin', 'KwunTong',
  'KwaiTsing', 'TsuenWan', 'TuenMun', 'YuenLong', 'North', 'TaiPo',
  'SaiKung', 'ShaTin', 'Islands',
])

const VALID_FORMATS = new Set(['online', 'in_person', 'both'])
const VALID_TYPES = new Set(['individual', 'group', 'both'])
const VALID_DAYS = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// Validates availability jsonb in the precise minute-range shape (matches
// /api/availability and the matching engine, §4.3): { [day]: [{ start, end }] },
// minutes from midnight, 0 ≤ start < end ≤ 1440. null clears the saved value.
// Example: { "mon": [{ "start": 540, "end": 720 }], "sat": [{ "start": 600, "end": 840 }] }
function validateAvailability(value: unknown): string | null {
  if (value === null || value === undefined) return null

  if (typeof value !== 'object' || Array.isArray(value)) {
    return 'availability must be an object of the form { "mon": [{ "start": 540, "end": 720 }], ... }'
  }

  for (const [day, ranges] of Object.entries(value as Record<string, unknown>)) {
    if (!VALID_DAYS.has(day)) {
      return `availability key "${day}" is invalid — must be one of: ${[...VALID_DAYS].join(', ')}`
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

// Shared auth guard — returns { user } or a NextResponse error
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

// ---------------------------------------------------------------------------
// GET /api/filters
// Returns the authenticated user's saved filter preferences.
// Returns { filters: null } if none have been saved yet.
// ---------------------------------------------------------------------------
export async function GET() {
  const supabase = await createClient()
  const { user, response } = await requireAuth(supabase)
  if (!user) return response!

  const { data: filters, error } = await supabase
    .from('saved_filter_preferences')
    .select('*')
    .eq('profile_id', user.id)
    .single()

  if (error) {
    // PGRST116 = no rows — user hasn't saved filters yet
    if (error.code === 'PGRST116') {
      return NextResponse.json({ filters: null })
    }
    console.error('[filters GET] Fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ filters })
}

// ---------------------------------------------------------------------------
// PUT /api/filters
// Upserts the authenticated user's saved filter preferences (full replace).
// All fields are optional — omitted fields are stored as null.
// ---------------------------------------------------------------------------
export async function PUT(request: Request) {
  const supabase = await createClient()
  const { user, response } = await requireAuth(supabase)
  if (!user) return response!

  const body = await request.json().catch(() => null)

  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    preferred_langs,
    districts,
    tutoring_format,
    tutoring_type,
    subcategory_ids,
    price_min,
    price_max,
    availability,
  } = body as {
    preferred_langs?: string[]
    districts?: string[]
    tutoring_format?: string
    tutoring_type?: string
    subcategory_ids?: string[]
    price_min?: number
    price_max?: number
    availability?: Record<string, { start: number; end: number }[]>
  }

  // --- Validate ---

  if (preferred_langs !== undefined && preferred_langs !== null) {
    if (!Array.isArray(preferred_langs)) {
      return NextResponse.json({ error: 'preferred_langs must be an array' }, { status: 400 })
    }
    const invalid = preferred_langs.find((l) => !VALID_LANGUAGES.has(l))
    if (invalid) {
      return NextResponse.json(
        { error: `preferred_langs contains invalid value "${invalid}" — must be one of: ${[...VALID_LANGUAGES].join(', ')}` },
        { status: 400 }
      )
    }
  }

  if (districts !== undefined && districts !== null) {
    if (!Array.isArray(districts)) {
      return NextResponse.json({ error: 'districts must be an array' }, { status: 400 })
    }
    const invalid = districts.find((d) => !VALID_DISTRICTS.has(d))
    if (invalid) {
      return NextResponse.json(
        { error: `districts contains invalid value "${invalid}" — must be one of: ${[...VALID_DISTRICTS].join(', ')}` },
        { status: 400 }
      )
    }
  }

  if (tutoring_format !== undefined && tutoring_format !== null && !VALID_FORMATS.has(tutoring_format)) {
    return NextResponse.json(
      { error: 'tutoring_format must be one of: online, in_person, both' },
      { status: 400 }
    )
  }

  if (tutoring_type !== undefined && tutoring_type !== null && !VALID_TYPES.has(tutoring_type)) {
    return NextResponse.json(
      { error: 'tutoring_type must be one of: individual, group, both' },
      { status: 400 }
    )
  }

  if (subcategory_ids !== undefined && subcategory_ids !== null) {
    if (!Array.isArray(subcategory_ids)) {
      return NextResponse.json({ error: 'subcategory_ids must be an array' }, { status: 400 })
    }
    const invalid = subcategory_ids.find((id) => !UUID_REGEX.test(id))
    if (invalid) {
      return NextResponse.json(
        { error: `subcategory_ids contains invalid UUID: "${invalid}"` },
        { status: 400 }
      )
    }
  }

  if (price_min !== undefined && price_min !== null) {
    if (!Number.isInteger(price_min) || price_min < 0) {
      return NextResponse.json({ error: 'price_min must be a non-negative integer' }, { status: 400 })
    }
  }

  if (price_max !== undefined && price_max !== null) {
    if (!Number.isInteger(price_max) || price_max < 0) {
      return NextResponse.json({ error: 'price_max must be a non-negative integer' }, { status: 400 })
    }
  }

  if (
    price_min !== undefined && price_min !== null &&
    price_max !== undefined && price_max !== null &&
    price_max < price_min
  ) {
    return NextResponse.json({ error: 'price_max must be greater than or equal to price_min' }, { status: 400 })
  }

  const availabilityError = validateAvailability(availability)
  if (availabilityError) {
    return NextResponse.json({ error: availabilityError }, { status: 400 })
  }

  // --- Upsert ---
  // profile_id has a UNIQUE constraint, so onConflict: 'profile_id' replaces
  // the existing row (full PUT semantics — omitted fields become null).
  const { data: filters, error: upsertError } = await supabase
    .from('saved_filter_preferences')
    .upsert(
      {
        profile_id: user.id,
        preferred_langs: preferred_langs ?? null,
        districts: districts ?? null,
        tutoring_format: tutoring_format ?? null,
        tutoring_type: tutoring_type ?? null,
        subcategory_ids: subcategory_ids ?? null,
        price_min: price_min ?? null,
        price_max: price_max ?? null,
        availability: availability ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'profile_id' }
    )
    .select()
    .single()

  if (upsertError) {
    console.error('[filters PUT] Upsert error:', upsertError)
    return NextResponse.json({ error: upsertError.message }, { status: 500 })
  }

  return NextResponse.json({ filters })
}
