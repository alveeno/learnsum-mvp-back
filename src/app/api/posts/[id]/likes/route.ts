import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// Likes for a single post.
//   GET    — public: { liked, likes_count } (liked is false when unauthenticated)
//   POST   — authenticated: like the post (idempotent)
//   DELETE — authenticated: unlike the post (idempotent)
//
// post_likes + the likes_count triggers already exist (migration 0001); RLS
// ("post_likes: owner insert/delete", WITH CHECK auth.uid() = profile_id) lets a
// user manage only their own likes. likes_count is read back AFTER the write —
// the trigger fires in the same transaction, so the value is already current.
// ---------------------------------------------------------------------------

// Reads the post's current likes_count. Posts are public-read.
async function loadLikesCount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  postId: string
) {
  return supabase.from('posts').select('id, likes_count').eq('id', postId).single()
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid post id' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data: post, error } = await loadLikesCount(supabase, id)
  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }
    console.error('[posts/[id]/likes GET] Lookup error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // liked state only applies to a signed-in caller; anonymous → false.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let liked = false
  if (user) {
    const { data: like } = await supabase
      .from('post_likes')
      .select('id')
      .eq('post_id', id)
      .eq('profile_id', user.id)
      .maybeSingle()
    liked = !!like
  }

  return NextResponse.json({ liked, likes_count: post.likes_count })
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid post id' }, { status: 400 })
  }

  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Confirm the post exists before inserting (clean 404 vs an FK error).
  const { data: post, error: lookupError } = await loadLikesCount(supabase, id)
  if (lookupError) {
    if (lookupError.code === 'PGRST116') {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }
    console.error('[posts/[id]/likes POST] Lookup error:', lookupError)
    return NextResponse.json({ error: lookupError.message }, { status: 500 })
  }

  // Insert the like. 23505 = unique_violation (already liked) — treat as success.
  const { error: insertError } = await supabase
    .from('post_likes')
    .insert({ post_id: id, profile_id: user.id })

  if (insertError && insertError.code !== '23505') {
    console.error('[posts/[id]/likes POST] Insert error:', insertError)
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // Re-read the count (a fresh insert bumped it via trigger; a duplicate didn't).
  const alreadyLiked = insertError?.code === '23505'
  const likes_count = alreadyLiked
    ? post.likes_count
    : (await loadLikesCount(supabase, id)).data?.likes_count ?? post.likes_count + 1

  return NextResponse.json({ liked: true, likes_count }, { status: alreadyLiked ? 200 : 201 })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid post id' }, { status: 400 })
  }

  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Delete the like (idempotent — deleting a non-existent like is a no-op).
  // .select() tells us whether a row was actually removed (trigger fired).
  const { data: deleted, error: deleteError } = await supabase
    .from('post_likes')
    .delete()
    .eq('post_id', id)
    .eq('profile_id', user.id)
    .select('id')

  if (deleteError) {
    console.error('[posts/[id]/likes DELETE] Delete error:', deleteError)
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  const { data: post, error: countError } = await loadLikesCount(supabase, id)
  if (countError) {
    if (countError.code === 'PGRST116') {
      // The post was removed concurrently — the like is gone regardless.
      return NextResponse.json({ liked: false, likes_count: 0 })
    }
    console.error('[posts/[id]/likes DELETE] Count error:', countError)
    return NextResponse.json({ error: countError.message }, { status: 500 })
  }

  return NextResponse.json({
    liked: false,
    likes_count: post.likes_count,
    removed: (deleted ?? []).length > 0,
  })
}
