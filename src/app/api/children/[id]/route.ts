import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildChildFields, UUID_REGEX } from '@/lib/children'

// ---------------------------------------------------------------------------
// /api/children/[id] — read / edit / delete a single child.
// child_profiles RLS is owner-only, so a child belonging to another parent
// simply isn't visible (resolves to 404).
// ---------------------------------------------------------------------------

async function requireAuth(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) {
    return { user: null, response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }
  return { user, response: null }
}

// Resolves the caller's own child by id, or returns a 404/400 response.
async function resolveOwnChild(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string
) {
  if (!UUID_REGEX.test(id)) {
    return { child: null, response: NextResponse.json({ error: 'Invalid child id' }, { status: 400 }) }
  }
  const { data: child, error } = await supabase
    .from('child_profiles')
    .select('id')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.error('[children/[id]] Lookup error:', error)
    return { child: null, response: NextResponse.json({ error: error.message }, { status: 500 }) }
  }
  if (!child) {
    return { child: null, response: NextResponse.json({ error: 'Child not found' }, { status: 404 }) }
  }
  return { child, response: null }
}

// ---------------------------------------------------------------------------
// GET /api/children/[id]
// ---------------------------------------------------------------------------
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { user, response } = await requireAuth(supabase)
  if (!user) return response!

  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid child id' }, { status: 400 })
  }

  const { data: child, error } = await supabase
    .from('child_profiles')
    .select('*, child_category_interests ( subcategory_id )')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.error('[children/[id] GET] Fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!child) {
    return NextResponse.json({ error: 'Child not found' }, { status: 404 })
  }

  const { child_category_interests, ...rest } = child as {
    child_category_interests?: { subcategory_id: string }[]
  } & Record<string, unknown>
  return NextResponse.json({
    child: { ...rest, interest_subcategory_ids: (child_category_interests ?? []).map((i) => i.subcategory_id) },
  })
}

// ---------------------------------------------------------------------------
// PATCH /api/children/[id] — edit any subset; interests full-replace if sent.
// ---------------------------------------------------------------------------
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { user, response } = await requireAuth(supabase)
  if (!user) return response!

  const { child, response: resolveErr } = await resolveOwnChild(supabase, id)
  if (!child) return resolveErr!

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const built = buildChildFields(body as Record<string, unknown>, { partial: true })
  if ('error' in built) {
    return NextResponse.json({ error: built.error }, { status: 400 })
  }

  const hasFieldUpdates = Object.keys(built.updates).length > 0
  if (!hasFieldUpdates && built.interestIds === undefined) {
    return NextResponse.json({ error: 'Provide at least one field to update' }, { status: 400 })
  }

  // RLS "child_profiles: owner update" enforces ownership at the DB layer.
  if (hasFieldUpdates) {
    const { error: updateError } = await supabase
      .from('child_profiles')
      .update(built.updates)
      .eq('id', id)
    if (updateError) {
      console.error('[children/[id] PATCH] Update error:', updateError)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }
  }

  // Full-replace interests when provided.
  if (built.interestIds !== undefined) {
    const { error: delErr } = await supabase.from('child_category_interests').delete().eq('child_id', id)
    if (delErr) {
      console.error('[children/[id] PATCH] Interest delete error:', delErr)
      return NextResponse.json({ error: delErr.message }, { status: 500 })
    }
    if (built.interestIds.length) {
      const rows = built.interestIds.map((subcategory_id) => ({ child_id: id, subcategory_id }))
      const { error: insErr } = await supabase.from('child_category_interests').insert(rows)
      if (insErr) {
        if (insErr.code === '23503') {
          return NextResponse.json({ error: 'One or more interest_subcategory_ids do not exist' }, { status: 400 })
        }
        console.error('[children/[id] PATCH] Interest insert error:', insErr)
        return NextResponse.json({ error: insErr.message }, { status: 500 })
      }
    }
  }

  // Return the fresh state.
  const { data: fresh } = await supabase
    .from('child_profiles')
    .select('*, child_category_interests ( subcategory_id )')
    .eq('id', id)
    .single()
  const { child_category_interests, ...rest } = (fresh ?? {}) as {
    child_category_interests?: { subcategory_id: string }[]
  } & Record<string, unknown>
  return NextResponse.json({
    child: { ...rest, interest_subcategory_ids: (child_category_interests ?? []).map((i) => i.subcategory_id) },
  })
}

// ---------------------------------------------------------------------------
// DELETE /api/children/[id]
// child_category_interests cascades via FK. seeker_availability uses a
// polymorphic owner_id (no FK), so its child rows must be removed explicitly —
// and BEFORE the child row, because that delete policy resolves parent_id
// through child_profiles (which would be gone after the child is deleted).
// ---------------------------------------------------------------------------
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { user, response } = await requireAuth(supabase)
  if (!user) return response!

  const { child, response: resolveErr } = await resolveOwnChild(supabase, id)
  if (!child) return resolveErr!

  // 1. Remove the child's availability rows while the child still exists (RLS).
  const { error: availError } = await supabase
    .from('seeker_availability')
    .delete()
    .eq('owner_id', id)
    .eq('owner_type', 'child')
  if (availError) {
    console.error('[children/[id] DELETE] Availability cleanup error:', availError)
    return NextResponse.json({ error: availError.message }, { status: 500 })
  }

  // 2. Delete the child — child_category_interests cascades.
  const { data: deleted, error: deleteError } = await supabase
    .from('child_profiles')
    .delete()
    .eq('id', id)
    .select('id')
    .single()
  if (deleteError) {
    if (deleteError.code === 'PGRST116') {
      return NextResponse.json({ error: 'Child not found' }, { status: 404 })
    }
    console.error('[children/[id] DELETE] Delete error:', deleteError)
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, deleted_id: deleted.id })
}
