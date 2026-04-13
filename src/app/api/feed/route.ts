import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const PAGE_SIZE = 20

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  // page is 1-indexed; clamp to 1 on invalid input
  const rawPage = parseInt(searchParams.get('page') ?? '1', 10)
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1
  const offset = (page - 1) * PAGE_SIZE

  const supabase = await createClient()

  // RLS policy on tutor_profiles: "is_published = true OR auth.uid() = id"
  // Unauthenticated callers (anon key) only see is_published = true rows — no
  // extra filter needed here.
  //
  // The nested select follows FK chains:
  //   tutor_profiles.id → profiles.id          (returns single object)
  //   tutor_subcategories.tutor_id              (returns array)
  //     → subcategories.id                      (returns single object per row)
  //       → categories.id                       (returns single object per row)
  const { data: tutors, error, count } = await supabase
    .from('tutor_profiles')
    .select(
      `
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
    `,
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  if (error) {
    // PGRST103 = "Requested range not satisfiable" — offset exceeds total rows.
    // Return an empty page rather than a 500.
    if (error.code === 'PGRST103') {
      return NextResponse.json({
        feed: [],
        pagination: { page, page_size: PAGE_SIZE, total: 0, has_more: false },
      })
    }
    console.error('[feed] Fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Flatten and deduplicate categories per tutor.
  // A tutor may teach Basketball and Football (both under Sports) — we want
  // one "Sports" entry in the feed card, not two.
  const feed = (tutors ?? []).map((tutor) => {
    const categoryMap = new Map<
      string,
      { id: string; name_en: string; name_zh: string; slug: string }
    >()

    for (const ts of (tutor.tutor_subcategories as Array<{
      subcategories: { categories: { id: string; name_en: string; name_zh: string; slug: string } } | null
    }> ?? [])) {
      const cat = ts.subcategories?.categories
      if (cat && !categoryMap.has(cat.id)) {
        categoryMap.set(cat.id, cat)
      }
    }

    const profile = tutor.profiles as {
      display_name: string | null
      avatar_url: string | null
      district: string | null
    } | null

    return {
      slug: tutor.slug,
      bio: tutor.bio,
      created_at: tutor.created_at,
      display_name: profile?.display_name ?? null,
      avatar_url: profile?.avatar_url ?? null,
      district: profile?.district ?? null,
      categories: Array.from(categoryMap.values()),
    }
  })

  return NextResponse.json({
    feed,
    pagination: {
      page,
      page_size: PAGE_SIZE,
      total: count ?? 0,
      has_more: offset + PAGE_SIZE < (count ?? 0),
    },
  })
}
