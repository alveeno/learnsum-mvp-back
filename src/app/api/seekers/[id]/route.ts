import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// GET /api/seekers/[id]
// The seeker (student/parent) profile a TUTOR views: preferences, category, and
// (for parents) the child's level + age. Visible to any signed-in tutor (Req:
// "tutors see the seeker profile in all tiers") — but the PHONE is gated behind a
// contact unlock. Assembled by the SECURITY DEFINER get_seeker_for_tutor RPC,
// which is needed because child_profiles are owner-only (minors). Returns the
// `Seeker` shape (lib/api/seekers.ts) directly.
// ---------------------------------------------------------------------------
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid seeker id' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { data, error } = await supabase.rpc('get_seeker_for_tutor', { p_seeker_id: id })

  if (error) {
    // The RPC RAISEs for non-tutors / unauthenticated.
    if (error.message?.includes('tutors only')) {
      return NextResponse.json({ error: 'Tutors only' }, { status: 403 })
    }
    console.error('[seekers/[id] GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) return NextResponse.json({ error: 'Seeker not found' }, { status: 404 })

  return NextResponse.json(data)
}
