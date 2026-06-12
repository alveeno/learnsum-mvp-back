import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// DELETE /api/posts/[id]
// Authenticated — post owner (the tutor) only.
// Cascades remove the post's media / likes / comments (FK ON DELETE CASCADE).
// RLS "posts: owner delete" (USING auth.uid() = tutor_id) enforces ownership at
// the DB layer too; the explicit lookup here returns clean 404 / 403 responses.
// ---------------------------------------------------------------------------
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid post id' }, { status: 400 })
  }

  const supabase = await createClient()

  // 1. Verify session
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // 2. Resolve the post — posts are public-read, so this finds any post.
  const { data: post, error: lookupError } = await supabase
    .from('posts')
    .select('id, tutor_id')
    .eq('id', id)
    .single()

  if (lookupError) {
    // PGRST116 = 0 rows — post does not exist
    if (lookupError.code === 'PGRST116') {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }
    console.error('[posts/[id] DELETE] Lookup error:', lookupError)
    return NextResponse.json({ error: lookupError.message }, { status: 500 })
  }

  // 3. App-level ownership check — posts.tutor_id === auth.uid()
  if (post.tutor_id !== user.id) {
    return NextResponse.json(
      { error: 'You do not own this post' },
      { status: 403 }
    )
  }

  // 4. Delete — RLS "posts: owner delete" enforces ownership at the DB layer too.
  // .select() returns the deleted row so we can confirm a row was actually removed.
  const { data: deleted, error: deleteError } = await supabase
    .from('posts')
    .delete()
    .eq('id', id)
    .select('id')
    .single()

  if (deleteError) {
    // PGRST116 here means RLS filtered the row out (not the owner) — treat as 403.
    if (deleteError.code === 'PGRST116') {
      return NextResponse.json(
        { error: 'You do not own this post' },
        { status: 403 }
      )
    }
    console.error('[posts/[id] DELETE] Delete error:', deleteError)
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, deleted_id: deleted.id })
}
