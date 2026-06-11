import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const PAGE_SIZE = 10
const VALID_POST_TYPES = ['update', 'showcase', 'result'] as const
type PostType = (typeof VALID_POST_TYPES)[number]

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

  return NextResponse.json({ post }, { status: 201 })
}
