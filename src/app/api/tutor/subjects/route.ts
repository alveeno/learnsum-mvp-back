import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// /api/tutor/subjects — what the authenticated tutor teaches
// (tutor_subcategories: subcategory + years + min/max rate + bilingual jsonb
// achievements / qualifications / exam_results).
// PUT is a full replace: send the complete desired list ([] clears all).
// ---------------------------------------------------------------------------

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function requireTutor(supabase: Awaited<ReturnType<typeof createClient>>) {
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
  if (profile.role !== 'tutor') {
    return { user: null, response: NextResponse.json({ error: 'Only tutor accounts have subjects' }, { status: 403 }) }
  }
  return { user, response: null }
}

// Parse "years" → non-negative int or null. Accepts a number or a string like "5"/"30+".
function parseYears(v: unknown): { value: number | null } | { error: string } {
  if (v === undefined || v === null) return { value: null }
  if (typeof v === 'number') {
    if (!Number.isInteger(v) || v < 0) return { error: 'years_experience must be a non-negative whole number' }
    return { value: v }
  }
  if (typeof v === 'string') {
    const n = parseInt(v.replace(/[^0-9]/g, ''), 10)
    return Number.isFinite(n) ? { value: n } : { value: null }
  }
  return { error: 'years_experience must be a number or null' }
}

// Optional non-negative int (rate). undefined/null → null.
function parseRate(v: unknown, field: string): { value: number | null } | { error: string } {
  if (v === undefined || v === null) return { value: null }
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    return { error: `${field} must be a non-negative whole number` }
  }
  return { value: v }
}

// jsonb passthrough — must be a plain object or null (the {en,zh} shape).
function parseJsonb(v: unknown, field: string): { value: unknown } | { error: string } {
  if (v === undefined || v === null) return { value: null }
  if (typeof v !== 'object' || Array.isArray(v)) {
    return { error: `${field} must be an object (e.g. { "en": "...", "zh": "..." }) or null` }
  }
  return { value: v }
}

type SubjectRow = {
  subcategory_id: string
  years_experience: number | null
  hourly_rate_min: number | null
  hourly_rate_max: number | null
  achievements: unknown
  qualifications: unknown
  exam_results: unknown
}

// Validate + shape the subjects array, deduped by subcategory_id (last wins).
function buildSubjects(input: unknown): { rows: SubjectRow[] } | { error: string } {
  if (!Array.isArray(input)) {
    return { error: 'subjects must be an array of { subcategory_id, ... }' }
  }
  const byId = new Map<string, SubjectRow>()
  for (const raw of input) {
    if (typeof raw !== 'object' || raw === null) return { error: 'each subject must be an object' }
    const s = raw as Record<string, unknown>

    if (typeof s.subcategory_id !== 'string' || !UUID_REGEX.test(s.subcategory_id)) {
      return { error: 'each subject needs a valid subcategory_id (UUID)' }
    }

    const years = parseYears(s.years_experience)
    if ('error' in years) return { error: years.error }
    const rmin = parseRate(s.hourly_rate_min, 'hourly_rate_min')
    if ('error' in rmin) return { error: rmin.error }
    const rmax = parseRate(s.hourly_rate_max, 'hourly_rate_max')
    if ('error' in rmax) return { error: rmax.error }
    if (rmin.value !== null && rmax.value !== null && rmin.value > rmax.value) {
      return { error: 'hourly_rate_min cannot exceed hourly_rate_max' }
    }
    const ach = parseJsonb(s.achievements, 'achievements')
    if ('error' in ach) return { error: ach.error }
    const qual = parseJsonb(s.qualifications, 'qualifications')
    if ('error' in qual) return { error: qual.error }
    const exam = parseJsonb(s.exam_results, 'exam_results')
    if ('error' in exam) return { error: exam.error }

    byId.set(s.subcategory_id, {
      subcategory_id: s.subcategory_id,
      years_experience: years.value,
      hourly_rate_min: rmin.value,
      hourly_rate_max: rmax.value,
      achievements: ach.value,
      qualifications: qual.value,
      exam_results: exam.value,
    })
  }
  return { rows: [...byId.values()] }
}

// ---------------------------------------------------------------------------
// GET /api/tutor/subjects
// ---------------------------------------------------------------------------
export async function GET() {
  const supabase = await createClient()
  const { user, response } = await requireTutor(supabase)
  if (!user) return response!

  const { data, error } = await supabase
    .from('tutor_subcategories')
    .select(
      `id, subcategory_id, years_experience, hourly_rate_min, hourly_rate_max,
       achievements, qualifications, exam_results,
       subcategories ( id, name_en, name_zh, slug )`
    )
    .eq('tutor_id', user.id)

  if (error) {
    console.error('[tutor/subjects GET] Fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ subjects: data ?? [] })
}

// ---------------------------------------------------------------------------
// PUT /api/tutor/subjects — full replace. Body: { subjects: [...] }.
// ---------------------------------------------------------------------------
export async function PUT(request: Request) {
  const supabase = await createClient()
  const { user, response } = await requireTutor(supabase)
  if (!user) return response!

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const subjects = (body as { subjects?: unknown }).subjects
  if (subjects === undefined) {
    return NextResponse.json({ error: 'subjects is required (use [] to clear)' }, { status: 400 })
  }

  const built = buildSubjects(subjects)
  if ('error' in built) {
    return NextResponse.json({ error: built.error }, { status: 400 })
  }

  // Verify every subcategory_id exists BEFORE the destructive delete, so a bad
  // id can't wipe the tutor's existing subjects (full-replace is delete+insert).
  if (built.rows.length) {
    const ids = built.rows.map((r) => r.subcategory_id)
    const { data: existing, error: checkErr } = await supabase
      .from('subcategories')
      .select('id')
      .in('id', ids)
    if (checkErr) {
      console.error('[tutor/subjects PUT] Subcategory check error:', checkErr)
      return NextResponse.json({ error: checkErr.message }, { status: 500 })
    }
    const found = new Set((existing ?? []).map((r) => r.id))
    const missing = ids.filter((id) => !found.has(id))
    if (missing.length) {
      return NextResponse.json({ error: `Unknown subcategory_id(s): ${missing.join(', ')}` }, { status: 400 })
    }
  }

  // Full replace under RLS (owner delete + owner insert).
  const { error: delErr } = await supabase.from('tutor_subcategories').delete().eq('tutor_id', user.id)
  if (delErr) {
    console.error('[tutor/subjects PUT] Delete error:', delErr)
    return NextResponse.json({ error: delErr.message }, { status: 500 })
  }

  if (built.rows.length) {
    const rows = built.rows.map((r) => ({ tutor_id: user.id, ...r }))
    const { error: insErr } = await supabase.from('tutor_subcategories').insert(rows)
    if (insErr) {
      // 23503 (FK) → invalid subcategory_id, or no tutor_profiles row yet; 42501 → RLS (no profile)
      if (insErr.code === '23503') {
        return NextResponse.json(
          { error: 'Invalid subcategory_id, or create your tutor profile before setting subjects' },
          { status: 400 }
        )
      }
      if (insErr.code === '42501') {
        return NextResponse.json({ error: 'Create your tutor profile before setting subjects' }, { status: 409 })
      }
      console.error('[tutor/subjects PUT] Insert error:', insErr)
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }
  }

  return NextResponse.json({ subjects: built.rows })
}
