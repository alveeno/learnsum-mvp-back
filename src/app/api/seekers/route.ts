import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const VALID_LEVELS = new Set(['kindergarten', 'primary', 'middle', 'high', 'university', 'adult'])

// ---------------------------------------------------------------------------
// GET /api/seekers?q=&subcategory_id=&level=&district=&limit=
// Search PUBLIC seekers (students/parents who left their profile discoverable).
// Any signed-in user may search. Each card respects the seeker's
// share_personal_info (name/level hidden when off). Assembled by the
// SECURITY DEFINER search_seekers RPC (child data is owner-only). → { seekers }
// ---------------------------------------------------------------------------
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const q = searchParams.get('q')?.trim() || null
  const subRaw = searchParams.get('subcategory_id')?.trim() || null
  const levelRaw = searchParams.get('level')?.trim() || null
  const district = searchParams.get('district')?.trim() || null
  const limitRaw = parseInt(searchParams.get('limit') ?? '40', 10)

  if (subRaw && !UUID_REGEX.test(subRaw)) {
    return NextResponse.json({ error: 'subcategory_id must be a uuid' }, { status: 400 })
  }
  if (levelRaw && !VALID_LEVELS.has(levelRaw)) {
    return NextResponse.json({ error: `level must be one of: ${[...VALID_LEVELS].join(', ')}` }, { status: 400 })
  }

  const { data, error } = await supabase.rpc('search_seekers', {
    p_q: q,
    p_subcategory: subRaw,
    p_level: levelRaw,
    p_district: district,
    p_limit: Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 80) : 40,
  })

  if (error) {
    console.error('[seekers GET search]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ seekers: data ?? [] })
}
