import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildChildFields, MAX_CHILDREN } from '@/lib/children'

// ---------------------------------------------------------------------------
// /api/children — parent-only management of child_profiles.
// child_profiles RLS is owner-only (auth.uid() = parent_id), so every query
// here is automatically scoped to the calling parent's own children.
// ---------------------------------------------------------------------------

// Reshapes a child row's embedded interests into a flat id array.
function shapeChild(c: Record<string, unknown>) {
  const { child_category_interests, ...rest } = c as {
    child_category_interests?: { subcategory_id: string }[]
  } & Record<string, unknown>
  return {
    ...rest,
    interest_subcategory_ids: (child_category_interests ?? []).map((i) => i.subcategory_id),
  }
}

async function requireParent(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) {
    return { user: null, response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile) {
    return { user: null, response: NextResponse.json({ error: 'Profile not found' }, { status: 404 }) }
  }
  if (profile.role !== 'parent') {
    return { user: null, response: NextResponse.json({ error: 'Only parent accounts have children' }, { status: 403 }) }
  }
  return { user, response: null }
}

// ---------------------------------------------------------------------------
// GET /api/children — list the parent's children, each with their interest ids.
// ---------------------------------------------------------------------------
export async function GET() {
  const supabase = await createClient()
  const { user, response } = await requireParent(supabase)
  if (!user) return response!

  const { data, error } = await supabase
    .from('child_profiles')
    .select('*, child_category_interests ( subcategory_id )')
    .eq('parent_id', user.id)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[children GET] Fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ children: (data ?? []).map(shapeChild) })
}

// ---------------------------------------------------------------------------
// POST /api/children — add a child (enforces the 1..MAX_CHILDREN limit).
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  const supabase = await createClient()
  const { user, response } = await requireParent(supabase)
  if (!user) return response!

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const built = buildChildFields(body as Record<string, unknown>, { partial: false })
  if ('error' in built) {
    return NextResponse.json({ error: built.error }, { status: 400 })
  }

  // Enforce the max-children cap.
  const { count, error: countError } = await supabase
    .from('child_profiles')
    .select('*', { count: 'exact', head: true })
    .eq('parent_id', user.id)
  if (countError) {
    console.error('[children POST] Count error:', countError)
    return NextResponse.json({ error: countError.message }, { status: 500 })
  }
  if ((count ?? 0) >= MAX_CHILDREN) {
    return NextResponse.json({ error: `A parent can have at most ${MAX_CHILDREN} children` }, { status: 409 })
  }

  // RLS "child_profiles: owner insert" (WITH CHECK auth.uid() = parent_id) enforces ownership.
  const { data: child, error: insertError } = await supabase
    .from('child_profiles')
    .insert({ parent_id: user.id, ...built.updates })
    .select()
    .single()
  if (insertError) {
    console.error('[children POST] Insert error:', insertError)
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  let interestIds: string[] = []
  if (built.interestIds && built.interestIds.length) {
    const rows = built.interestIds.map((subcategory_id) => ({ child_id: child.id, subcategory_id }))
    const { error: interestError } = await supabase.from('child_category_interests').insert(rows)
    if (interestError) {
      // 23503 = FK violation → one or more subcategory ids don't exist
      if (interestError.code === '23503') {
        // Roll back the just-created child so we don't leave a half-written record.
        await supabase.from('child_profiles').delete().eq('id', child.id)
        return NextResponse.json({ error: 'One or more interest_subcategory_ids do not exist' }, { status: 400 })
      }
      console.error('[children POST] Interest insert error:', interestError)
      return NextResponse.json({ error: interestError.message }, { status: 500 })
    }
    interestIds = built.interestIds
  }

  return NextResponse.json(
    { child: { ...child, interest_subcategory_ids: interestIds } },
    { status: 201 }
  )
}
