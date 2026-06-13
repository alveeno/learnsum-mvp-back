import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// PATCH /api/profiles/me
// Role-routed editing of the caller's own data:
//   • common `profiles` fields (any role): display_name, full_name, age,
//     gender, avatar_url, district, preferred_language
//   • role block (student / parent) for the role's preference detail table
// Tutors edit their profile via PATCH /api/tutors/[slug] and their subjects /
// teaching languages via the tutor subjects/languages endpoints — a `student`
// or `parent` block on a tutor account is rejected.
//
// List semantics are full-replace (send the complete desired set; [] clears).
// Canonical input forms: interests = subcategory UUIDs, districts = the 18
// hk_district enum codes, languages = lowercase tokens.
// ---------------------------------------------------------------------------

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const VALID_DISTRICTS = new Set([
  'CentralWestern', 'WanChai', 'Eastern', 'Southern',
  'YauTsimMong', 'ShamshuiPo', 'KowloonCity', 'WongTaiSin', 'KwunTong',
  'KwaiTsing', 'TsuenWan', 'TuenMun', 'YuenLong', 'North', 'TaiPo',
  'SaiKung', 'ShaTin', 'Islands',
])
// profiles.preferred_language is the legacy 3-value enum (vestigial but kept).
const VALID_PREFERRED_LANGUAGE = new Set(['english', 'cantonese', 'mandarin'])
const VALID_LEVELS = new Set(['kindergarten', 'primary', 'middle', 'high', 'university', 'adult'])
const VALID_FORMATS = new Set(['online', 'in_person', 'both'])
const VALID_TYPES = new Set(['individual', 'group', 'both'])
const VALID_GENDERS = new Set(['male', 'female', 'other', 'prefer_not_to_say'])

// Normalize a language list to unique lowercase tokens (expanded set is open-ended).
function normLanguages(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return [
    ...new Set(
      input
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean)
    ),
  ]
}

export async function PATCH(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { data: me, error: meError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (meError || !me) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }
  const role = me.role as 'student' | 'parent' | 'tutor'

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // -------------------------------------------------------------------------
  // 1. Common `profiles` fields (any role)
  // -------------------------------------------------------------------------
  const {
    display_name, full_name, age, gender, avatar_url, district, preferred_language,
  } = body as {
    display_name?: string | null
    full_name?: string | null
    age?: number | null
    gender?: string | null
    avatar_url?: string | null
    district?: string | null
    preferred_language?: string | null
  }

  const profileUpdates: Record<string, unknown> = {}

  if (display_name !== undefined) {
    const t = display_name?.trim()
    if (!t) return NextResponse.json({ error: 'display_name cannot be empty' }, { status: 400 })
    profileUpdates.display_name = t
  }
  if (full_name !== undefined) profileUpdates.full_name = full_name?.trim() || null
  if (avatar_url !== undefined) profileUpdates.avatar_url = avatar_url?.trim() || null
  if (age !== undefined) {
    if (age === null) profileUpdates.age = null
    else if (!Number.isInteger(age) || age < 1 || age > 120) {
      return NextResponse.json({ error: 'age must be a whole number between 1 and 120' }, { status: 400 })
    } else profileUpdates.age = age
  }
  if (gender !== undefined) {
    if (gender !== null && !VALID_GENDERS.has(gender)) {
      return NextResponse.json({ error: `gender must be one of: ${[...VALID_GENDERS].join(', ')}` }, { status: 400 })
    }
    profileUpdates.gender = gender
  }
  if (district !== undefined) {
    if (district !== null && !VALID_DISTRICTS.has(district)) {
      return NextResponse.json({ error: `district must be one of: ${[...VALID_DISTRICTS].join(', ')}` }, { status: 400 })
    }
    profileUpdates.district = district
  }
  if (preferred_language !== undefined) {
    if (preferred_language !== null && !VALID_PREFERRED_LANGUAGE.has(preferred_language)) {
      return NextResponse.json({ error: `preferred_language must be one of: ${[...VALID_PREFERRED_LANGUAGE].join(', ')}` }, { status: 400 })
    }
    profileUpdates.preferred_language = preferred_language
  }

  // -------------------------------------------------------------------------
  // 2. Role-specific block
  // -------------------------------------------------------------------------
  const studentBlock = (body as { student?: Record<string, unknown> }).student
  const parentBlock = (body as { parent?: Record<string, unknown> }).parent

  if (studentBlock !== undefined && role !== 'student') {
    return NextResponse.json({ error: 'student preferences can only be set on a student account' }, { status: 400 })
  }
  if (parentBlock !== undefined && role !== 'parent') {
    return NextResponse.json({ error: 'parent preferences can only be set on a parent account' }, { status: 400 })
  }

  // Validate + build the student detail update, and capture interests for replace.
  const studentUpdates: Record<string, unknown> = {}
  let newInterestIds: string[] | undefined
  if (role === 'student' && studentBlock) {
    const s = studentBlock
    if (s.school_level !== undefined) {
      if (s.school_level !== null && !VALID_LEVELS.has(s.school_level as string)) {
        return NextResponse.json({ error: `school_level must be one of: ${[...VALID_LEVELS].join(', ')}` }, { status: 400 })
      }
      studentUpdates.school_level = s.school_level
    }
    if (s.tutoring_format_pref !== undefined) {
      if (s.tutoring_format_pref !== null && !VALID_FORMATS.has(s.tutoring_format_pref as string)) {
        return NextResponse.json({ error: `tutoring_format_pref must be one of: ${[...VALID_FORMATS].join(', ')}` }, { status: 400 })
      }
      studentUpdates.tutoring_format_pref = s.tutoring_format_pref
    }
    if (s.tutoring_type_pref !== undefined) {
      if (s.tutoring_type_pref !== null && !VALID_TYPES.has(s.tutoring_type_pref as string)) {
        return NextResponse.json({ error: `tutoring_type_pref must be one of: ${[...VALID_TYPES].join(', ')}` }, { status: 400 })
      }
      studentUpdates.tutoring_type_pref = s.tutoring_type_pref
    }
    if (s.budget_max_per_hour !== undefined) {
      const b = s.budget_max_per_hour
      if (b === null) studentUpdates.budget_max_per_hour = null
      else if (!Number.isInteger(b) || (b as number) < 0) {
        return NextResponse.json({ error: 'budget_max_per_hour must be a non-negative whole number' }, { status: 400 })
      } else studentUpdates.budget_max_per_hour = b
    }
    if (s.preferred_languages !== undefined) {
      studentUpdates.preferred_languages = normLanguages(s.preferred_languages)
    }
    if (s.preferred_districts !== undefined) {
      if (!Array.isArray(s.preferred_districts)) {
        return NextResponse.json({ error: 'preferred_districts must be an array of district codes' }, { status: 400 })
      }
      const bad = (s.preferred_districts as unknown[]).filter((d) => typeof d !== 'string' || !VALID_DISTRICTS.has(d))
      if (bad.length) {
        return NextResponse.json({ error: `preferred_districts has invalid codes: ${bad.join(', ')}` }, { status: 400 })
      }
      studentUpdates.preferred_districts = [...new Set(s.preferred_districts as string[])]
    }
    if (s.interest_subcategory_ids !== undefined) {
      if (!Array.isArray(s.interest_subcategory_ids)) {
        return NextResponse.json({ error: 'interest_subcategory_ids must be an array of subcategory UUIDs' }, { status: 400 })
      }
      const bad = (s.interest_subcategory_ids as unknown[]).filter((id) => typeof id !== 'string' || !UUID_REGEX.test(id))
      if (bad.length) {
        return NextResponse.json({ error: 'interest_subcategory_ids must all be valid UUIDs' }, { status: 400 })
      }
      newInterestIds = [...new Set(s.interest_subcategory_ids as string[])]
    }
  }

  const parentUpdates: Record<string, unknown> = {}
  if (role === 'parent' && parentBlock) {
    if (parentBlock.searching_for_self !== undefined) {
      if (typeof parentBlock.searching_for_self !== 'boolean') {
        return NextResponse.json({ error: 'searching_for_self must be true or false' }, { status: 400 })
      }
      parentUpdates.searching_for_self = parentBlock.searching_for_self
    }
  }

  const nothingToDo =
    Object.keys(profileUpdates).length === 0 &&
    Object.keys(studentUpdates).length === 0 &&
    Object.keys(parentUpdates).length === 0 &&
    newInterestIds === undefined
  if (nothingToDo) {
    return NextResponse.json({ error: 'Provide at least one field to update' }, { status: 400 })
  }

  // -------------------------------------------------------------------------
  // 3. Apply. RLS restricts every write to the caller's own rows.
  // -------------------------------------------------------------------------
  let profile = null
  if (Object.keys(profileUpdates).length > 0) {
    profileUpdates.updated_at = new Date().toISOString()
    const { data, error } = await supabase
      .from('profiles')
      .update(profileUpdates)
      .eq('id', user.id)
      .select()
      .single()
    if (error) {
      console.error('[profiles/me PATCH] profiles update error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    profile = data
  }

  let detail = null
  if (Object.keys(studentUpdates).length > 0) {
    const { data, error } = await supabase
      .from('student_profiles')
      .upsert({ id: user.id, ...studentUpdates }, { onConflict: 'id' })
      .select()
      .single()
    if (error) {
      console.error('[profiles/me PATCH] student_profiles upsert error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    detail = data
  }
  if (Object.keys(parentUpdates).length > 0) {
    const { data, error } = await supabase
      .from('parent_profiles')
      .upsert({ id: user.id, ...parentUpdates }, { onConflict: 'id' })
      .select()
      .single()
    if (error) {
      console.error('[profiles/me PATCH] parent_profiles upsert error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    detail = data
  }

  // Full-replace the student's subject interests.
  if (newInterestIds !== undefined) {
    const { error: delErr } = await supabase
      .from('user_category_interests')
      .delete()
      .eq('profile_id', user.id)
    if (delErr) {
      console.error('[profiles/me PATCH] interests delete error:', delErr)
      return NextResponse.json({ error: delErr.message }, { status: 500 })
    }
    if (newInterestIds.length) {
      const rows = newInterestIds.map((subcategory_id) => ({ profile_id: user.id, subcategory_id }))
      const { error: insErr } = await supabase.from('user_category_interests').insert(rows)
      if (insErr) {
        // 23503 = FK violation → one or more subcategory ids don't exist
        if (insErr.code === '23503') {
          return NextResponse.json({ error: 'One or more interest_subcategory_ids do not exist' }, { status: 400 })
        }
        console.error('[profiles/me PATCH] interests insert error:', insErr)
        return NextResponse.json({ error: insErr.message }, { status: 500 })
      }
    }
  }

  return NextResponse.json({
    ok: true,
    profile,
    detail,
    ...(newInterestIds !== undefined ? { interest_subcategory_ids: newInterestIds } : {}),
  })
}

// ---------------------------------------------------------------------------
// DELETE /api/profiles/me — permanently delete the caller's own account.
// First purges the user's Storage files via the Storage API (Postgres forbids a
// direct DELETE on storage.objects), then runs the SECURITY DEFINER
// delete_own_account() function (migration 0013), which removes the auth user
// (cascading all their data) + the non-cascading seeker_availability rows.
// Finally clears the session cookies.
// ---------------------------------------------------------------------------
export async function DELETE() {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Best-effort: remove the user's uploaded media (owner-delete RLS lets them
  // remove their own {user.id}/... files). Errors here don't block deletion.
  for (const folder of ['avatars', 'posts'] as const) {
    const { data: files } = await supabase.storage.from('media').list(`${user.id}/${folder}`, { limit: 1000 })
    const paths = (files ?? []).map((f) => `${user.id}/${folder}/${f.name}`)
    if (paths.length) {
      await supabase.storage.from('media').remove(paths)
    }
  }

  const { error: rpcError } = await supabase.rpc('delete_own_account')
  if (rpcError) {
    // PGRST202 = function not found in schema cache → migration not applied
    if (rpcError.code === 'PGRST202') {
      return NextResponse.json(
        { error: 'Account deletion not installed — apply migration 0013' },
        { status: 503 }
      )
    }
    console.error('[profiles/me DELETE] rpc error:', rpcError)
    return NextResponse.json({ error: rpcError.message }, { status: 500 })
  }

  // The user no longer exists; clear the auth cookies (best-effort).
  await supabase.auth.signOut().catch(() => {})

  return NextResponse.json({ ok: true })
}
