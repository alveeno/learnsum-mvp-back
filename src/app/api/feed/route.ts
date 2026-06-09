import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const PAGE_SIZE = 20

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

  const supabase = await createClient()

  // --- Decide guest vs personalized ---
  // Matching runs only for an authenticated student/parent who has expressed
  // at least one category interest. Everyone else (guests, tutors, seekers with
  // no interests yet) gets the latest-tutors feed.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let personalized = false
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role === 'student' || profile?.role === 'parent') {
      const { count: interestCount } = await supabase
        .from('user_category_interests')
        .select('*', { count: 'exact', head: true })
        .eq('profile_id', user.id)

      personalized = (interestCount ?? 0) > 0
    }
  }

  if (personalized) {
    return personalizedFeed(supabase, page, offset)
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
  offset: number
) {
  const { data: ranked, error: rpcError } = await supabase.rpc('match_tutors_for_seeker', {
    p_page: page,
    p_page_size: PAGE_SIZE,
  })

  if (rpcError) {
    // PGRST202 = function not found — the 0003 migration isn't applied yet.
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
