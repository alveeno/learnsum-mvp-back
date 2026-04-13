import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const PAGE_SIZE = 20

const VALID_DISTRICTS = new Set([
  'CentralWestern', 'WanChai', 'Eastern', 'Southern',
  'YauTsimMong', 'ShamshuiPo', 'KowloonCity', 'WongTaiSin', 'KwunTong',
  'KwaiTsing', 'TsuenWan', 'TuenMun', 'YuenLong', 'North', 'TaiPo',
  'SaiKung', 'ShaTin', 'Islands',
])

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// Deduplicate and flatten categories per tutor — same logic as /api/feed
function shapeTutor(tutor: {
  slug: string
  bio: string | null
  tutoring_format: string | null
  tutoring_type: string | null
  created_at: string
  profiles: { display_name: string | null; avatar_url: string | null; district: string | null } | null
  tutor_subcategories: Array<{
    subcategories: {
      categories: { id: string; name_en: string; name_zh: string; slug: string }
    } | null
  }>
}) {
  const categoryMap = new Map<
    string,
    { id: string; name_en: string; name_zh: string; slug: string }
  >()

  for (const ts of tutor.tutor_subcategories ?? []) {
    const cat = ts.subcategories?.categories
    if (cat && !categoryMap.has(cat.id)) {
      categoryMap.set(cat.id, cat)
    }
  }

  return {
    slug: tutor.slug,
    bio: tutor.bio,
    tutoring_format: tutor.tutoring_format,
    tutoring_type: tutor.tutoring_type,
    created_at: tutor.created_at,
    display_name: tutor.profiles?.display_name ?? null,
    avatar_url: tutor.profiles?.avatar_url ?? null,
    district: tutor.profiles?.district ?? null,
    categories: Array.from(categoryMap.values()),
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  // --- Pagination ---
  const rawPage = parseInt(searchParams.get('page') ?? '1', 10)
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1
  const offset = (page - 1) * PAGE_SIZE

  // --- Filter params ---
  const subcategoryId = searchParams.get('subcategory_id')
  const district = searchParams.get('district')
  const format = searchParams.get('tutoring_format')
  const type = searchParams.get('tutoring_type')
  const rawMinRate = searchParams.get('min_rate')
  const rawMaxRate = searchParams.get('max_rate')
  const minRate = rawMinRate !== null ? parseInt(rawMinRate, 10) : null
  const maxRate = rawMaxRate !== null ? parseInt(rawMaxRate, 10) : null

  // --- Validate ---
  if (district && !VALID_DISTRICTS.has(district)) {
    return NextResponse.json(
      { error: `district must be one of: ${[...VALID_DISTRICTS].join(', ')}` },
      { status: 400 }
    )
  }

  if (format && !['online', 'in_person', 'both'].includes(format)) {
    return NextResponse.json(
      { error: 'tutoring_format must be one of: online, in_person, both' },
      { status: 400 }
    )
  }

  if (type && !['individual', 'group', 'both'].includes(type)) {
    return NextResponse.json(
      { error: 'tutoring_type must be one of: individual, group, both' },
      { status: 400 }
    )
  }

  if (subcategoryId && !UUID_REGEX.test(subcategoryId)) {
    return NextResponse.json(
      { error: 'subcategory_id must be a valid UUID' },
      { status: 400 }
    )
  }

  if (rawMinRate !== null && (isNaN(minRate!) || minRate! < 0)) {
    return NextResponse.json(
      { error: 'min_rate must be a non-negative integer' },
      { status: 400 }
    )
  }

  if (rawMaxRate !== null && (isNaN(maxRate!) || maxRate! < 0)) {
    return NextResponse.json(
      { error: 'max_rate must be a non-negative integer' },
      { status: 400 }
    )
  }

  const supabase = await createClient()

  // --- Pre-query A: subcategory / rate filter ---
  // tutor_subcategories is public-readable (USING true).
  // Returns deduplicated tutor IDs, or null if no subcategory/rate filters given.
  let subcatTutorIds: string[] | null = null

  if (subcategoryId || minRate !== null || maxRate !== null) {
    let q = supabase.from('tutor_subcategories').select('tutor_id')

    if (subcategoryId) q = q.eq('subcategory_id', subcategoryId)
    // min_rate: tutor must have at least one slot at or above min_rate
    if (minRate !== null) q = q.gte('hourly_rate_max', minRate)
    // max_rate: tutor's starting rate must be within the caller's budget
    if (maxRate !== null) q = q.lte('hourly_rate_min', maxRate)

    const { data, error } = await q

    if (error) {
      console.error('[tutors GET] Subcat pre-query error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Deduplicate: a tutor may appear once per matching subcategory row
    subcatTutorIds = [...new Set((data ?? []).map((r) => r.tutor_id))]
  }

  // --- Pre-query B: district filter ---
  // profiles.id === tutor_profiles.id, so profile IDs are tutor IDs directly.
  // profiles is public-readable (USING true).
  let districtTutorIds: string[] | null = null

  if (district) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('district', district)

    if (error) {
      console.error('[tutors GET] District pre-query error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    districtTutorIds = (data ?? []).map((r) => r.id)
  }

  // --- Intersect pre-queried sets ---
  // If both filters ran, we need tutors that satisfy both.
  let restrictedIds: string[] | null = null

  if (subcatTutorIds !== null && districtTutorIds !== null) {
    const districtSet = new Set(districtTutorIds)
    restrictedIds = subcatTutorIds.filter((id) => districtSet.has(id))
  } else {
    restrictedIds = subcatTutorIds ?? districtTutorIds
  }

  // Short-circuit: filters produced an empty intersection — no results possible.
  // (Avoids sending an invalid IN () clause to Postgres.)
  if (restrictedIds !== null && restrictedIds.length === 0) {
    return NextResponse.json({
      tutors: [],
      pagination: { page, page_size: PAGE_SIZE, total: 0, has_more: false },
    })
  }

  // --- Main query ---
  // RLS on tutor_profiles enforces is_published = true for anon callers.
  let query = supabase
    .from('tutor_profiles')
    .select(
      `
      slug,
      bio,
      tutoring_format,
      tutoring_type,
      created_at,
      profiles (
        display_name,
        avatar_url,
        district
      ),
      tutor_subcategories (
        subcategories (
          categories (
            id,
            name_en,
            name_zh,
            slug
          )
        )
      )
    `,
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  // Format filter: inclusive — 'online' matches tutors offering online OR both,
  // since a tutor who does 'both' can serve an online-only request.
  if (format === 'online') {
    query = query.in('tutoring_format', ['online', 'both'])
  } else if (format === 'in_person') {
    query = query.in('tutoring_format', ['in_person', 'both'])
  } else if (format === 'both') {
    query = query.eq('tutoring_format', 'both')
  }

  if (type === 'individual') {
    query = query.in('tutoring_type', ['individual', 'both'])
  } else if (type === 'group') {
    query = query.in('tutoring_type', ['group', 'both'])
  } else if (type === 'both') {
    query = query.eq('tutoring_type', 'both')
  }

  if (restrictedIds !== null) {
    query = query.in('id', restrictedIds)
  }

  const { data: tutors, error, count } = await query

  if (error) {
    if (error.code === 'PGRST103') {
      return NextResponse.json({
        tutors: [],
        pagination: { page, page_size: PAGE_SIZE, total: 0, has_more: false },
      })
    }
    console.error('[tutors GET] Main query error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    tutors: (tutors ?? []).map(shapeTutor),
    pagination: {
      page,
      page_size: PAGE_SIZE,
      total: count ?? 0,
      has_more: offset + PAGE_SIZE < (count ?? 0),
    },
  })
}

// Slug must be lowercase letters, numbers, and hyphens, 3–80 chars
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$|^[a-z0-9]{1,2}$/

// ---------------------------------------------------------------------------
// POST /api/tutors
// Creates a tutor profile for the authenticated user.
// Requires the user's profiles.role to be 'tutor'.
// tutor_profiles.id === profiles.id (1:1 extension table).
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Verify the user signed up as a tutor
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  if (profile.role !== 'tutor') {
    return NextResponse.json(
      { error: 'Only users with role "tutor" can create a tutor profile' },
      { status: 403 }
    )
  }

  // Idempotency — return 409 if the row already exists
  const { data: existing } = await supabase
    .from('tutor_profiles')
    .select('id, slug')
    .eq('id', user.id)
    .single()

  if (existing) {
    return NextResponse.json(
      { error: 'Tutor profile already exists', tutor_profile: existing },
      { status: 409 }
    )
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { slug, bio, bio_zh, university, tutoring_format, tutoring_type, whatsapp_number } =
    body as {
      slug?: string
      bio?: string
      bio_zh?: string
      university?: string
      tutoring_format?: string
      tutoring_type?: string
      whatsapp_number?: string
    }

  if (!slug?.trim()) {
    return NextResponse.json({ error: 'slug is required' }, { status: 400 })
  }

  const slugNormalized = slug.trim().toLowerCase()

  if (!SLUG_REGEX.test(slugNormalized)) {
    return NextResponse.json(
      {
        error:
          'slug must be 3–80 characters, lowercase letters, numbers, and hyphens only, and must start and end with a letter or number',
      },
      { status: 400 }
    )
  }

  if (tutoring_format && !VALID_FORMATS.has(tutoring_format)) {
    return NextResponse.json(
      { error: 'tutoring_format must be one of: online, in_person, both' },
      { status: 400 }
    )
  }

  if (tutoring_type && !VALID_TYPES.has(tutoring_type)) {
    return NextResponse.json(
      { error: 'tutoring_type must be one of: individual, group, both' },
      { status: 400 }
    )
  }

  // RLS "tutor_profiles: owner insert" (WITH CHECK auth.uid() = id) enforces ownership at DB layer
  const { data: tutorProfile, error: insertError } = await supabase
    .from('tutor_profiles')
    .insert({
      id: user.id,
      slug: slugNormalized,
      bio: bio?.trim() ?? null,
      bio_zh: bio_zh?.trim() ?? null,
      university: university?.trim() ?? null,
      tutoring_format: tutoring_format ?? null,
      tutoring_type: tutoring_type ?? null,
      whatsapp_number: whatsapp_number?.trim() ?? null,
      is_published: false,
    })
    .select()
    .single()

  if (insertError) {
    // 23505 = unique_violation — slug already claimed by another tutor
    if (insertError.code === '23505') {
      return NextResponse.json(
        { error: 'That slug is already taken — choose a different one' },
        { status: 409 }
      )
    }
    console.error('[tutors POST] Insert error:', insertError)
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({ tutor_profile: tutorProfile }, { status: 201 })
}
