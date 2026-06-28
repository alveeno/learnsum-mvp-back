import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// Flatten a tutor row to the browse-card shape (mirrors /api/tutors + /api/feed),
// plus the tutor `id` and `saved_at` so the client can render and un-save it.
function shapeSavedTutor(
  tutor: {
    id: string
    slug: string
    bio: string | null
    tutoring_format: string | null
    tutoring_type: string | null
    created_at: string
    profiles: { display_name: string | null; avatar_url: string | null; district: string | null } | null
    tutor_subcategories: Array<{
      districts: string[] | null
      subcategories: { categories: { id: string; name_en: string; name_zh: string; slug: string } } | null
    }>
  },
  savedAt: string
) {
  const categoryMap = new Map<string, { id: string; name_en: string; name_zh: string; slug: string }>()
  const subdistricts = new Set<string>()
  for (const ts of tutor.tutor_subcategories ?? []) {
    const cat = ts.subcategories?.categories
    if (cat && !categoryMap.has(cat.id)) categoryMap.set(cat.id, cat)
    for (const d of ts.districts ?? []) subdistricts.add(d)
  }
  return {
    id: tutor.id,
    slug: tutor.slug,
    bio: tutor.bio,
    tutoring_format: tutor.tutoring_format,
    tutoring_type: tutor.tutoring_type,
    created_at: tutor.created_at,
    display_name: tutor.profiles?.display_name ?? null,
    avatar_url: tutor.profiles?.avatar_url ?? null,
    district: tutor.profiles?.district ?? null,
    subdistricts: Array.from(subdistricts),
    categories: Array.from(categoryMap.values()),
    saved_at: savedAt,
  }
}

// ---------------------------------------------------------------------------
// GET /api/saved
// The authenticated user's bookmarked tutors, most recently saved first.
// Tutors who have since unpublished drop out of the cards (RLS hides them) but
// their saved_tutors row remains — re-publishing makes them reappear.
// ---------------------------------------------------------------------------
export async function GET() {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { data: saved, error } = await supabase
    .from('saved_tutors')
    .select('tutor_id, created_at')
    .eq('profile_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[saved GET] Fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!saved || saved.length === 0) {
    return NextResponse.json({ saved: [] })
  }

  const savedAtById = new Map(saved.map((s) => [s.tutor_id, s.created_at]))
  const tutorIds = saved.map((s) => s.tutor_id)

  const { data: tutors, error: tutorsError } = await supabase
    .from('tutor_profiles')
    .select(
      `
      id,
      slug,
      bio,
      tutoring_format,
      tutoring_type,
      created_at,
      profiles ( display_name, avatar_url, district ),
      tutor_subcategories ( districts, subcategories ( categories ( id, name_en, name_zh, slug ) ) )
    `
    )
    .in('id', tutorIds)

  if (tutorsError) {
    console.error('[saved GET] Tutors fetch error:', tutorsError)
    return NextResponse.json({ error: tutorsError.message }, { status: 500 })
  }

  // Preserve saved-order (newest first); RLS may have dropped unpublished rows.
  // Cast away PostgREST's array-typed to-one embeds (the untyped client mis-infers
  // profiles/categories as arrays; shapeSavedTutor reads them as single objects).
  const tutorRows = (tutors ?? []) as unknown as Parameters<typeof shapeSavedTutor>[0][]
  const tutorById = new Map(tutorRows.map((t) => [t.id, t]))
  const cards = tutorIds
    .map((id) => {
      const t = tutorById.get(id)
      return t ? shapeSavedTutor(t, savedAtById.get(id)!) : null
    })
    .filter((c): c is ReturnType<typeof shapeSavedTutor> => c !== null)

  return NextResponse.json({ saved: cards })
}

// ---------------------------------------------------------------------------
// POST /api/saved
// Bookmark a tutor. Body: { tutor_id } (uuid) OR { slug }. Idempotent — saving
// an already-saved tutor returns { saved: true } without error.
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

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { tutor_id, slug } = body as { tutor_id?: string; slug?: string }

  if (!tutor_id && !slug?.trim()) {
    return NextResponse.json({ error: 'tutor_id or slug is required' }, { status: 400 })
  }
  if (tutor_id && !UUID_REGEX.test(tutor_id)) {
    return NextResponse.json({ error: 'tutor_id must be a valid UUID' }, { status: 400 })
  }

  // Resolve to a tutor id. RLS shows published tutors (and the caller's own row),
  // so you can't save a tutor that isn't publicly visible.
  const { data: tutor, error: tutorError } = await supabase
    .from('tutor_profiles')
    .select('id')
    .eq(tutor_id ? 'id' : 'slug', tutor_id ?? slug!.trim().toLowerCase())
    .single()

  if (tutorError || !tutor) {
    return NextResponse.json({ error: 'Tutor not found' }, { status: 404 })
  }

  const { error: insertError } = await supabase
    .from('saved_tutors')
    .insert({ profile_id: user.id, tutor_id: tutor.id })

  // 23505 = unique_violation — already saved. Idempotent success.
  if (insertError && insertError.code !== '23505') {
    console.error('[saved POST] Insert error:', insertError)
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json(
    { saved: true, tutor_id: tutor.id },
    { status: insertError?.code === '23505' ? 200 : 201 }
  )
}
