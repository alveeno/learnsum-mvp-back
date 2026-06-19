import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Matches a UUID v4 — used to decide whether to query by id or slug
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const VALID_FORMATS = new Set(['online', 'in_person', 'both'])
const VALID_TYPES = new Set(['individual', 'group', 'both'])
const VALID_LEVELS = new Set(['kindergarten', 'primary', 'middle', 'high', 'university', 'adult'])

// Strip a leading "@" and surrounding spaces from an Instagram handle; "" → null
function normalizeInstagram(handle: string | null | undefined): string | null {
  if (handle == null) return null
  const cleaned = handle.trim().replace(/^@+/, '').trim()
  return cleaned === '' ? null : cleaned
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

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
      teaching_levels,
      education,
      current_studies,
      whatsapp_number,
      instagram_handle,
      wechat_id,
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
        achievements,
        qualifications,
        exam_results,
        experience,
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
      ),
      tutor_languages (
        language,
        proficiency
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

// ---------------------------------------------------------------------------
// PATCH /api/tutors/[slug]
// Updates the authenticated tutor's own profile.
// Accepts any subset of updatable fields — omitted fields are left unchanged.
// Slug cannot be changed after creation (it is used in public URLs).
// ---------------------------------------------------------------------------
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Resolve tutor — RLS allows the owner to see their own unpublished row
  const isUuid = UUID_REGEX.test(slug)
  const { data: tutor, error: tutorError } = await supabase
    .from('tutor_profiles')
    .select('id, slug')
    .eq(isUuid ? 'id' : 'slug', slug)
    .single()

  if (tutorError) {
    if (tutorError.code === 'PGRST116') {
      return NextResponse.json({ error: 'Tutor not found' }, { status: 404 })
    }
    console.error('[tutors/[slug] PATCH] Lookup error:', tutorError)
    return NextResponse.json({ error: tutorError.message }, { status: 500 })
  }

  if (tutor.id !== user.id) {
    return NextResponse.json(
      { error: 'You do not own this tutor profile' },
      { status: 403 }
    )
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    bio, bio_zh, university, tutoring_format, tutoring_type,
    whatsapp_number, instagram_handle, wechat_id, is_published,
    teaching_levels, education, current_studies,
  } =
    body as {
      bio?: string | null
      bio_zh?: string | null
      university?: string | null
      tutoring_format?: string | null
      tutoring_type?: string | null
      whatsapp_number?: string | null
      instagram_handle?: string | null
      wechat_id?: string | null
      is_published?: boolean
      teaching_levels?: unknown
      education?: unknown
      current_studies?: unknown
    }

  const allUndefined = [
    bio, bio_zh, university, tutoring_format, tutoring_type,
    whatsapp_number, instagram_handle, wechat_id, is_published,
    teaching_levels, education, current_studies,
  ].every((v) => v === undefined)

  if (allUndefined) {
    return NextResponse.json(
      { error: 'Provide at least one field to update' },
      { status: 400 }
    )
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

  if (is_published !== undefined && typeof is_published !== 'boolean') {
    return NextResponse.json({ error: 'is_published must be true or false' }, { status: 400 })
  }

  // A1 — teaching_levels: an array of the 6 levels, or null to clear.
  if (teaching_levels !== undefined && teaching_levels !== null) {
    if (!Array.isArray(teaching_levels) || teaching_levels.some((l) => typeof l !== 'string' || !VALID_LEVELS.has(l))) {
      return NextResponse.json(
        { error: 'teaching_levels must be an array of: kindergarten, primary, middle, high, university, adult' },
        { status: 400 }
      )
    }
  }
  // A3 — education (object keyed by level) + current_studies (array).
  if (education !== undefined && education !== null && (typeof education !== 'object' || Array.isArray(education))) {
    return NextResponse.json({ error: 'education must be an object or null' }, { status: 400 })
  }
  if (current_studies !== undefined && current_studies !== null && !Array.isArray(current_studies)) {
    return NextResponse.json({ error: 'current_studies must be an array or null' }, { status: 400 })
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (bio !== undefined) updates.bio = bio?.trim() ?? null
  if (bio_zh !== undefined) updates.bio_zh = bio_zh?.trim() ?? null
  if (university !== undefined) updates.university = university?.trim() ?? null
  if (tutoring_format !== undefined) updates.tutoring_format = tutoring_format
  if (tutoring_type !== undefined) updates.tutoring_type = tutoring_type
  if (whatsapp_number !== undefined) updates.whatsapp_number = whatsapp_number?.trim() ?? null
  if (instagram_handle !== undefined) updates.instagram_handle = normalizeInstagram(instagram_handle)
  if (wechat_id !== undefined) updates.wechat_id = wechat_id?.trim() ?? null
  if (is_published !== undefined) updates.is_published = is_published
  if (teaching_levels !== undefined) updates.teaching_levels = teaching_levels === null ? null : [...new Set(teaching_levels as string[])]
  if (education !== undefined) updates.education = education ?? null
  if (current_studies !== undefined) updates.current_studies = current_studies ?? null

  // RLS "tutor_profiles: owner update" (USING auth.uid() = id) enforces ownership at DB layer
  const { data: tutorProfile, error: updateError } = await supabase
    .from('tutor_profiles')
    .update(updates)
    .eq('id', tutor.id)
    .select()
    .single()

  if (updateError) {
    console.error('[tutors/[slug] PATCH] Update error:', updateError)
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ tutor_profile: tutorProfile })
}
