import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Matches a UUID v4 — used to decide whether to query by id or slug
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(
  _request: Request,
  { params }: { params: { slug: string } }
) {
  const { slug } = params

  // Use the anon-key client so RLS applies — unpublished tutors are
  // invisible to unauthenticated callers (policy: is_published = true OR auth.uid() = id)
  const supabase = await createClient()

  const isUuid = UUID_REGEX.test(slug)

  // Single query: tutor profile + base profile fields + subjects/categories
  const { data: tutor, error: tutorError } = await supabase
    .from('tutor_profiles')
    .select(
      `
      id,
      slug,
      bio,
      bio_zh,
      university,
      tutoring_format,
      tutoring_type,
      whatsapp_number,
      is_published,
      created_at,
      profiles (
        display_name,
        avatar_url,
        district,
        preferred_language
      ),
      tutor_subcategories (
        id,
        years_experience,
        hourly_rate_min,
        hourly_rate_max,
        subcategories (
          id,
          name_en,
          name_zh,
          slug,
          categories (
            id,
            name_en,
            name_zh,
            slug
          )
        )
      )
    `
    )
    .eq(isUuid ? 'id' : 'slug', slug)
    .single()

  if (tutorError) {
    // PGRST116 = "The result contains 0 rows" — tutor not found or not published
    if (tutorError.code === 'PGRST116') {
      return NextResponse.json({ error: 'Tutor not found' }, { status: 404 })
    }
    console.error('[tutors/[slug]] Profile fetch error:', tutorError)
    return NextResponse.json({ error: tutorError.message }, { status: 500 })
  }

  // Separate query for posts so we can control ordering and add pagination later.
  // posts RLS policy is "public read" (USING true), so no auth needed.
  const { data: posts, error: postsError } = await supabase
    .from('posts')
    .select(
      `
      id,
      content,
      content_zh,
      post_type,
      likes_count,
      comments_count,
      created_at,
      post_media (
        url,
        media_type,
        sort_order
      )
    `
    )
    .eq('tutor_id', tutor.id)
    .order('created_at', { ascending: false })
    .limit(10)

  if (postsError) {
    console.error('[tutors/[slug]] Posts fetch error:', postsError)
    return NextResponse.json({ error: postsError.message }, { status: 500 })
  }

  // Sort post_media by sort_order within each post
  const postsWithSortedMedia = (posts ?? []).map((post) => ({
    ...post,
    post_media: (post.post_media ?? []).sort(
      (a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order
    ),
  }))

  return NextResponse.json({
    tutor: {
      ...tutor,
      posts: postsWithSortedMedia,
    },
  })
}
