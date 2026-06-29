import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// DELETE /api/saved/people/[id]
// Un-bookmark. [id] is a tutor slug OR a seeker/profile uuid. Idempotent —
// removing something you haven't saved is a no-op success.
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
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  // Resolve slug → profile id (a uuid is used directly).
  let personId = id
  if (!UUID_REGEX.test(id)) {
    const { data: tutor } = await supabase
      .from('tutor_profiles')
      .select('id')
      .eq('slug', id.trim().toLowerCase())
      .maybeSingle()
    if (!tutor) return NextResponse.json({ saved: false, removed: false })
    personId = tutor.id
  }

  const { data: deleted, error } = await supabase
    .from('saved_people')
    .delete()
    .eq('owner_id', user.id)
    .eq('person_id', personId)
    .select('id')

  if (error) {
    console.error('[saved/people/[id] DELETE]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ saved: false, removed: (deleted ?? []).length > 0 })
}
