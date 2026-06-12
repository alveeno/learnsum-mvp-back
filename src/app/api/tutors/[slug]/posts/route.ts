import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const PAGE_SIZE = 10
const VALID_POST_TYPES = ['update', 'showcase', 'result'] as const
type PostType = (typeof VALID_POST_TYPES)[number]

const VALID_MEDIA_TYPES = new Set(['image', 'video'])
const MAX_MEDIA_PER_POST = 10
// Only accept media URLs that live in our own public Storage bucket (from /api/upload).
const MEDIA_URL_PREFIX = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}/storage/v1/object/public/media/`

type MediaInput = { url: string; media_type: string; sort_order: number }

// Validates the optional `media` array on post creation. Missing/null → []. URLs
// must point at our media bucket; media_type must be image|video; sort_order
// defaults to the array index.
function validateMedia(value: unknown): { rows: MediaInput[] } | { error: string } {
  if (value === undefined || value === null) return { rows: [] }
  if (!Array.isArray(value)) return { error: 'media must be an array of { url, media_type, sort_order? }' }
  if (value.length > MAX_MEDIA_PER_POST) return { error: `a post can have at most ${MAX_MEDIA_PER_POST} media items` }

  const rows: MediaInput[] = []
  for (let i = 0; i < value.length; i++) {
    const m = value[i]
    if (typeof m !== 'object' || m === null) return { error: 'each media item must be an object' }
    const { url, media_type, sort_order } = m as { url?: unknown; media_type?: unknown; sort_order?: unknown }
    if (typeof url !== 'string' || MEDIA_URL_PREFIX === '/storage/v1/object/public/media/' || !url.startsWith(MEDIA_URL_PREFIX)) {
      return { error: 'each media url must be a file uploaded to the media bucket (via POST /api/upload)' }
    }
    if (typeof media_type !== 'string' || !VALID_MEDIA_TYPES.has(media_type)) {
      return { error: "each media item needs media_type 'image' or 'video'" }
    }
    const so = sort_order === undefined ? i : sort_order
    if (!Number.isInteger(so) || (so as number) < 0) {
      return { error: 'sort_order must be a non-negative integer' }
    }
    rows.push({ url, media_type, sort_order: so as number })
  }
  return { rows }
}

// ---------------------------------------------------------------------------
// Shared helper — resolves slug or UUID to a tutor_profiles row.
// RLS applies: unauthenticated callers only see is_published = true rows;
// authenticated owners can see their own unpublished row.
// ---------------------------------------------------------------------------
async function resolveTutor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  slugOrId: string
) {
  const isUuid = UUID_REGEX.test(slugOrId)
  return supabase
    .from('tutor_profiles')
    .select('id, slug, is_published')
    .eq(isUuid ? 'id' : 'slug', slugOrId)
    .single()
}

// ---------------------------------------------------------------------------
// GET /api/tutors/[slug]/posts?page=N
// Public — no auth required. Returns paginated posts for a published tutor.
// ---------------------------------------------------------------------------
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const { searchParams } = new URL(request.url)

  const rawPage = parseInt(searchParams.get('page') ?? '1', 10)
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1
  const offset = (page - 1) * PAGE_SIZE

  const supabase = await createClient()

  const { data: tutor, error: tutorError } = await resolveTutor(supabase, slug)

  if (tutorError) {
    if (tutorError.code === 'PGRST116') {
      return NextResponse.json({ error: 'Tutor not found' }, { status: 404 })
    }
    console.error('[tutors/posts GET] Tutor lookup error:', tutorError)
    return NextResponse.json({ error: tutorError.message }, { status: 500 })
  }

  const { data: posts, error: postsError, count } = await supabase
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
    `,
      { count: 'exact' }
    )
    .eq('tutor_id', tutor.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  if (postsError) {
    // PGRST103 = range not satisfiable — page is beyond last row.
    // Fetch the real count separately so pagination metadata stays accurate.
    if (postsError.code === 'PGRST103') {
      const { count: totalCount } = await supabase
        .from('posts')
        .select('*', { count: 'exact', head: true })
        .eq('tutor_id', tutor.id)
      return NextResponse.json({
        posts: [],
        pagination: { page, page_size: PAGE_SIZE, total: totalCount ?? 0, has_more: false },
      })
    }
    console.error('[tutors/posts GET] Posts fetch error:', postsError)
    return NextResponse.json({ error: postsError.message }, { status: 500 })
  }

  const postsWithSortedMedia = (posts ?? []).map((post) => ({
    ...post,
    post_media: (post.post_media ?? []).sort(
      (a: { sort_order: number }, b: { sort_order: number }) =>
        a.sort_order - b.sort_order
    ),
  }))

  return NextResponse.json({
    posts: postsWithSortedMedia,
    pagination: {
      page,
      page_size: PAGE_SIZE,
      total: count ?? 0,
      has_more: offset + PAGE_SIZE < (count ?? 0),
    },
  })
}

// ---------------------------------------------------------------------------
// POST /api/tutors/[slug]/posts
// Authenticated — tutor owner only.
// ---------------------------------------------------------------------------
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const supabase = await createClient()

  // 1. Verify session
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // 2. Resolve the tutor — RLS lets the owner see their own unpublished row
  const { data: tutor, error: tutorError } = await resolveTutor(supabase, slug)

  if (tutorError) {
    if (tutorError.code === 'PGRST116') {
      return NextResponse.json({ error: 'Tutor not found' }, { status: 404 })
    }
    console.error('[tutors/posts POST] Tutor lookup error:', tutorError)
    return NextResponse.json({ error: tutorError.message }, { status: 500 })
  }

  // 3. App-level ownership check — tutor_profiles.id === auth.uid()
  // (DB enforces the same via RLS "posts: owner insert", this gives a clear 403)
  if (tutor.id !== user.id) {
    return NextResponse.json(
      { error: 'You do not own this tutor profile' },
      { status: 403 }
    )
  }

  // 4. Parse and validate body
  const body = await request.json().catch(() => null)

  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { content, content_zh, post_type } = body as {
    content?: string
    content_zh?: string
    post_type?: string
  }

  if (!content || !content.trim()) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 })
  }

  if (!post_type || !VALID_POST_TYPES.includes(post_type as PostType)) {
    return NextResponse.json(
      { error: `post_type must be one of: ${VALID_POST_TYPES.join(', ')}` },
      { status: 400 }
    )
  }

  // Validate optional media before creating the post.
  const mediaResult = validateMedia((body as { media?: unknown }).media)
  if ('error' in mediaResult) {
    return NextResponse.json({ error: mediaResult.error }, { status: 400 })
  }

  // 5. Insert — RLS "posts: owner insert" enforces ownership at the DB layer too
  const { data: post, error: insertError } = await supabase
    .from('posts')
    .insert({
      tutor_id: tutor.id,
      content: content.trim(),
      content_zh: content_zh?.trim() ?? null,
      post_type,
    })
    .select()
    .single()

  if (insertError) {
    console.error('[tutors/posts POST] Insert error:', insertError)
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // 6. Attach media (post_media RLS "owner insert" enforced via post ownership).
  let postMedia: Array<{ url: string; media_type: string; sort_order: number }> = []
  if (mediaResult.rows.length) {
    const mediaRows = mediaResult.rows.map((m) => ({
      post_id: post.id,
      url: m.url,
      media_type: m.media_type,
      sort_order: m.sort_order,
    }))
    const { data: inserted, error: mediaError } = await supabase
      .from('post_media')
      .insert(mediaRows)
      .select('url, media_type, sort_order')

    if (mediaError) {
      // Roll back the post so we never leave a post that lost its media.
      await supabase.from('posts').delete().eq('id', post.id)
      console.error('[tutors/posts POST] Media insert error:', mediaError)
      return NextResponse.json({ error: mediaError.message }, { status: 500 })
    }
    postMedia = (inserted ?? []).sort((a, b) => a.sort_order - b.sort_order)
  }

  return NextResponse.json({ post: { ...post, post_media: postMedia } }, { status: 201 })
}
