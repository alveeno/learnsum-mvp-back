import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const PAGE_SIZE = 20

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// Nested select shared by both feed paths. `id` is needed to re-attach scores
// in the personalized path; it is not exposed in the response.
const TUTOR_SELECT = `
  id,
  slug,
  bio,
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
`

type TutorRow = {
  id: string
  slug: string
  bio: string | null
  created_at: string
  profiles: { display_name: string | null; avatar_url: string | null; district: string | null } | null
  tutor_subcategories: Array<{
    subcategories: { categories: { id: string; name_en: string; name_zh: string; slug: string } } | null
  }> | null
}

// Flatten + deduplicate categories per tutor (a tutor teaching Basketball and
// Football, both under Sports, yields one "Sports" entry). `score` is attached
// only in the personalized path.
function shapeTutor(tutor: TutorRow, score: number | null) {
  const categoryMap = new Map<
    string,
    { id: string; name_en: string; name_zh: string; slug: string }
  >()

  for (const ts of tutor.tutor_subcategories ?? []) {
    const cat = ts.subcategories?.categories
    if (cat && !categoryMap.has(cat.id)) categoryMap.set(cat.id, cat)
  }

  return {
    slug: tutor.slug,
    bio: tutor.bio,
    created_at: tutor.created_at,
    display_name: tutor.profiles?.display_name ?? null,
    avatar_url: tutor.profiles?.avatar_url ?? null,
    district: tutor.profiles?.district ?? null,
    categories: Array.from(categoryMap.values()),
    ...(score !== null ? { score } : {}),
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  // page is 1-indexed; clamp to 1 on invalid input
  const rawPage = parseInt(searchParams.get('page') ?? '1', 10)
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1
  const offset = (page - 1) * PAGE_SIZE

  // Parents browse per child; students browse for themselves.
  const childId = searchParams.get('child_id')

  const supabase = await createClient()

  // --- Decide guest vs personalized ---
  // Matching runs for an authenticated seeker with ≥1 category interest:
  //   student → their own interests;  parent → the selected child's interests.
  // Everyone else (guests, tutors, seekers with no interests, parents who
  // haven't picked a child) gets the latest-tutors feed.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let personalized = false
  let pChildId: string | null = null

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role === 'student') {
      const { count } = await supabase
        .from('user_category_interests')
        .select('*', { count: 'exact', head: true })
        .eq('profile_id', user.id)
      personalized = (count ?? 0) > 0
    } else if (profile?.role === 'parent' && childId && UUID_REGEX.test(childId)) {
      // child_profiles RLS is owner-only, so this resolves only the parent's own child.
      const { data: child } = await supabase
        .from('child_profiles')
        .select('id')
        .eq('id', childId)
        .single()

      if (child) {
        const { count } = await supabase
          .from('child_category_interests')
          .select('*', { count: 'exact', head: true })
          .eq('child_id', childId)
        personalized = (count ?? 0) > 0
        if (personalized) pChildId = childId
      }
    }
  }

  if (personalized) {
    return personalizedFeed(supabase, page, offset, pChildId)
  }
  return latestFeed(supabase, page, offset)
}

// ---------------------------------------------------------------------------
// Personalized: rank published tutors via the match_tutors_for_seeker RPC,
// then hydrate full cards for the current page and preserve the RPC ordering.
// ---------------------------------------------------------------------------
async function personalizedFeed(
  supabase: Awaited<ReturnType<typeof createClient>>,
  page: number,
  offset: number,
  childId: string | null
) {
  const { data: ranked, error: rpcError } = await supabase.rpc('match_tutors_for_seeker', {
    p_child_id: childId,
    p_page: page,
    p_page_size: PAGE_SIZE,
  })

  if (rpcError) {
    // PGRST202 = function not found — migration 0008 isn't applied yet.
    // Degrade gracefully to the latest-tutors feed instead of 500-ing.
    if (rpcError.code === 'PGRST202') {
      console.warn('[feed] match_tutors_for_seeker missing — falling back to latest feed')
      return latestFeed(supabase, page, offset)
    }
    console.error('[feed] RPC error:', rpcError)
    return NextResponse.json({ error: rpcError.message }, { status: 500 })
  }

  const rows = (ranked ?? []) as Array<{ tutor_id: string; score: number; total_count: number }>
  const total = rows[0]?.total_count ?? 0

  if (rows.length === 0) {
    return NextResponse.json({
      feed: [],
      personalized: true,
      pagination: { page, page_size: PAGE_SIZE, total, has_more: false },
    })
  }

  const orderedIds = rows.map((r) => r.tutor_id)
  const scoreById = new Map(rows.map((r) => [r.tutor_id, r.score]))

  const { data: tutors, error } = await supabase
    .from('tutor_profiles')
    .select(TUTOR_SELECT)
    .in('id', orderedIds)

  if (error) {
    console.error('[feed] Hydrate error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Supabase types nested selects structurally; cast once via unknown (the
  // FK relationships guarantee the single-object shape TutorRow describes).
  const tutorRows = (tutors ?? []) as unknown as TutorRow[]

  // .in() does not preserve order — re-sort to match the RPC ranking.
  const byId = new Map(tutorRows.map((t) => [t.id, t]))
  const feed = orderedIds
    .map((id) => byId.get(id))
    .filter((t): t is TutorRow => t !== undefined)
    .map((t) => shapeTutor(t, scoreById.get(t.id) ?? null))

  return NextResponse.json({
    feed,
    personalized: true,
    pagination: { page, page_size: PAGE_SIZE, total, has_more: offset + PAGE_SIZE < total },
  })
}

// ---------------------------------------------------------------------------
// Latest: published tutors newest-first. RLS on tutor_profiles already limits
// anon/non-owner callers to is_published = true rows.
// ---------------------------------------------------------------------------
async function latestFeed(
  supabase: Awaited<ReturnType<typeof createClient>>,
  page: number,
  offset: number
) {
  const { data: tutors, error, count } = await supabase
    .from('tutor_profiles')
    .select(TUTOR_SELECT, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  if (error) {
    // PGRST103 = range beyond last row — return an accurate empty page.
    if (error.code === 'PGRST103') {
      const { count: totalCount } = await supabase
        .from('tutor_profiles')
        .select('*', { count: 'exact', head: true })
      return NextResponse.json({
        feed: [],
        personalized: false,
        pagination: { page, page_size: PAGE_SIZE, total: totalCount ?? 0, has_more: false },
      })
    }
    console.error('[feed] Fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const feed = ((tutors ?? []) as unknown as TutorRow[]).map((t) => shapeTutor(t, null))

  return NextResponse.json({
    feed,
    personalized: false,
    pagination: {
      page,
      page_size: PAGE_SIZE,
      total: count ?? 0,
      has_more: offset + PAGE_SIZE < (count ?? 0),
    },
  })
}
