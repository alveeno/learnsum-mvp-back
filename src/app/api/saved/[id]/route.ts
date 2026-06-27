import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// DELETE /api/saved/[id]
// Remove a bookmark. [id] is the tutor's uuid OR slug. Idempotent — removing a
// tutor you haven't saved is a no-op success. RLS "saved_tutors: owner delete"
// guarantees you can only delete your own bookmarks.
// ---------------------------------------------------------------------------
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Resolve slug → tutor id (a uuid is used directly). We don't 404 a missing
  // tutor here: the goal is "this isn't in my saved list afterwards".
  let tutorId = id
  if (!UUID_REGEX.test(id)) {
    const { data: tutor } = await supabase
      .from('tutor_profiles')
      .select('id')
      .eq('slug', id.trim().toLowerCase())
      .single()
    if (!tutor) {
      return NextResponse.json({ saved: false, removed: false })
    }
    tutorId = tutor.id
  }

  const { data: deleted, error: deleteError } = await supabase
    .from('saved_tutors')
    .delete()
    .eq('profile_id', user.id)
    .eq('tutor_id', tutorId)
    .select('id')

  if (deleteError) {
    console.error('[saved/[id] DELETE] Delete error:', deleteError)
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ saved: false, removed: (deleted ?? []).length > 0 })
}
