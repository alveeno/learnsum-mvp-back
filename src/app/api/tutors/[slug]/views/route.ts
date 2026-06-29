import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// POST /api/tutors/[slug]/views
// Record that the signed-in caller viewed this tutor's profile (backs the tutor
// Analytics "who viewed you" list). Upserts on (tutor_id, viewer_id) so a re-view
// bumps created_at → most-recent-viewers-first. Best-effort: self-views and
// unknown/unpublished tutors are quietly ignored.
// ---------------------------------------------------------------------------
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false }, { status: 401 })

  const isUuid = UUID_REGEX.test(slug)
  const { data: tutor } = await supabase
    .from('tutor_profiles')
    .select('id')
    .eq(isUuid ? 'id' : 'slug', isUuid ? slug : slug.trim().toLowerCase())
    .maybeSingle()

  // RLS hides unpublished tutors → not found → nothing to record.
  if (!tutor) return NextResponse.json({ ok: false })
  if (tutor.id === user.id) return NextResponse.json({ ok: true }) // don't log self-views

  const { error } = await supabase
    .from('profile_views')
    .upsert(
      { tutor_id: tutor.id, viewer_id: user.id, created_at: new Date().toISOString() },
      { onConflict: 'tutor_id,viewer_id' }
    )

  if (error) {
    console.error('[tutors/[slug]/views POST]', error)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
  return NextResponse.json({ ok: true }, { status: 201 })
}
