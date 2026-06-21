import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// GET /api/auth/me
// Returns { user, profile, detail } where `detail` is the caller's role-specific
// data, shaped so an edit screen can pre-fill current values:
//   student → { student_profile, interest_subcategory_ids }
//   parent  → { parent_profile, children: [{ ...child, interest_subcategory_ids }] }
//   tutor   → { tutor_profile, subjects, languages }
// ---------------------------------------------------------------------------
export async function GET() {
  const supabase = await createClient()

  // getUser() validates the JWT with Supabase Auth server — never trust the cookie alone
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }

  let detail: Record<string, unknown> | null = null

  if (profile.role === 'student') {
    const { data: studentProfile } = await supabase
      .from('student_profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle()
    const { data: interests } = await supabase
      .from('user_category_interests')
      .select('subcategory_id')
      .eq('profile_id', user.id)
    detail = {
      student_profile: studentProfile,
      interest_subcategory_ids: (interests ?? []).map((r) => r.subcategory_id),
    }
  } else if (profile.role === 'parent') {
    const { data: parentProfile } = await supabase
      .from('parent_profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle()
    // child_profiles RLS is owner-only, so this returns only this parent's children.
    const { data: children } = await supabase
      .from('child_profiles')
      .select('*, child_category_interests ( subcategory_id )')
      .eq('parent_id', user.id)
      .order('created_at', { ascending: true })
    detail = {
      parent_profile: parentProfile,
      children: (children ?? []).map((c) => {
        const { child_category_interests, ...rest } = c as {
          child_category_interests?: { subcategory_id: string }[]
        } & Record<string, unknown>
        return {
          ...rest,
          interest_subcategory_ids: (child_category_interests ?? []).map((i) => i.subcategory_id),
        }
      }),
    }
  } else if (profile.role === 'tutor') {
    // tutor_profiles RLS lets the owner read their own (even unpublished) row.
    const { data: tutorProfile } = await supabase
      .from('tutor_profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle()
    const { data: subjects } = await supabase
      .from('tutor_subcategories')
      .select(
        `id, subcategory_id, years_experience, hourly_rate_min, hourly_rate_max,
         achievements, qualifications, exam_results, experience, format, districts,
         subcategories ( id, name_en, name_zh, slug, categories ( id, name_en, name_zh, slug ) )`
      )
      .eq('tutor_id', user.id)
    const { data: languages } = await supabase
      .from('tutor_languages')
      .select('language, proficiency')
      .eq('tutor_id', user.id)
    detail = {
      tutor_profile: tutorProfile,
      subjects: subjects ?? [],
      languages: languages ?? [],
    }
  }

  return NextResponse.json({ user, profile, detail })
}
