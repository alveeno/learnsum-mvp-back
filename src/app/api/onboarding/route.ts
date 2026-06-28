import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// POST /api/onboarding  — Option A one-shot write (auth-gated, runs right after
// signup). Accepts the frontend's collected onboarding data (with its own
// slugs/labels), maps it to backend IDs/enums, and persists everything for the
// caller's role atomically via the complete_onboarding() SQL function.
// ---------------------------------------------------------------------------

const VALID_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const VALID_LEVELS = new Set(['kindergarten', 'primary', 'middle', 'high', 'university', 'adult'])
const VALID_FORMATS = new Set(['online', 'in_person', 'both'])
const VALID_TYPES = new Set(['individual', 'group', 'both'])
// Frontend gender values → backend gender_type enum. The tutor "About you"
// screen offers male/female/lgbtq/na; map lgbtq→lgbt (added in migration 0014)
// and na→prefer_not_to_say. Backend values pass through unchanged.
const GENDER_ALIASES: Record<string, string> = {
  male: 'male',
  female: 'female',
  other: 'other',
  prefer_not_to_say: 'prefer_not_to_say',
  lgbtq: 'lgbt',
  lgbt: 'lgbt',
  na: 'prefer_not_to_say',
}
function normalizeGender(v: unknown): string | null {
  if (typeof v !== 'string') return null
  return GENDER_ALIASES[v.trim().toLowerCase()] ?? null
}

// HK district label → enum code (frontend sends "<region>:<Label>").
const DISTRICT_LABEL_TO_ENUM: Record<string, string> = {
  'Central & Western': 'CentralWestern', 'Wan Chai': 'WanChai', Eastern: 'Eastern', Southern: 'Southern',
  'Yau Tsim Mong': 'YauTsimMong', 'Sham Shui Po': 'ShamshuiPo', 'Kowloon City': 'KowloonCity',
  'Wong Tai Sin': 'WongTaiSin', 'Kwun Tong': 'KwunTong', 'Kwai Tsing': 'KwaiTsing', 'Tsuen Wan': 'TsuenWan',
  'Tuen Mun': 'TuenMun', 'Yuen Long': 'YuenLong', North: 'North', 'Tai Po': 'TaiPo', 'Sai Kung': 'SaiKung',
  'Sha Tin': 'ShaTin', Islands: 'Islands',
}

type Range = { start: number; end: number }
type Avail = Record<string, Range[]>
type Skipped = { unknown_subjects: string[]; unknown_districts: string[]; not_persisted_yet: string[] }

// Validate { [day]: [{start,end}] } minute ranges; returns error or null.
function validateAvail(value: unknown, where: string): string | null {
  if (value === undefined) return null
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return `${where} availability must be an object of { "mon": [{ "start", "end" }] }`
  }
  for (const [day, ranges] of Object.entries(value as Record<string, unknown>)) {
    if (!VALID_DAYS.includes(day)) return `${where} availability has invalid day "${day}"`
    if (!Array.isArray(ranges)) return `${where} availability["${day}"] must be an array`
    for (const r of ranges) {
      const rr = r as { start?: unknown; end?: unknown }
      if (!Number.isInteger(rr.start) || !Number.isInteger(rr.end)) return `${where} availability["${day}"] needs integer start/end`
      if ((rr.start as number) < 0 || (rr.end as number) > 1440 || (rr.start as number) >= (rr.end as number)) {
        return `${where} availability["${day}"] needs 0 ≤ start < end ≤ 1440`
      }
    }
  }
  return null
}

// Map district labels ("hk:Central & Western") → enum codes; collect unknowns.
function mapDistricts(input: unknown, skipped: Skipped): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  for (const raw of input) {
    if (typeof raw !== 'string') continue
    const label = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : raw
    const code = DISTRICT_LABEL_TO_ENUM[label.trim()]
    if (code) out.push(code)
    else skipped.unknown_districts.push(raw)
  }
  return [...new Set(out)]
}

// Normalize a language list (ids + extra labels) to lowercase canonical tokens.
function mapLanguages(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out = input
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
  return [...new Set(out)]
}

// Tutor teaching languages: accept { "english": 4, ... } (id→proficiency 1..4) or a string[].
function mapTutorLanguages(input: unknown): Array<{ language: string; proficiency: number | null }> {
  const out: Array<{ language: string; proficiency: number | null }> = []
  const seen = new Set<string>()
  const add = (lang: string, prof: number | null) => {
    const l = lang.trim().toLowerCase()
    if (!l || seen.has(l)) return
    seen.add(l)
    out.push({ language: l, proficiency: prof })
  }
  if (Array.isArray(input)) {
    for (const x of input) if (typeof x === 'string') add(x, null)
  } else if (input && typeof input === 'object') {
    for (const [lang, lvl] of Object.entries(input as Record<string, unknown>)) {
      add(lang, typeof lvl === 'number' && lvl >= 1 && lvl <= 4 ? Math.trunc(lvl) : null)
    }
  }
  return out
}

// Map subject slugs → subcategory UUIDs; collect unknown/custom slugs.
function mapSubjects(input: unknown, slugToId: Map<string, string>, skipped: Skipped): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  for (const slug of input) {
    if (typeof slug !== 'string') continue
    const id = slugToId.get(slug)
    if (id) out.push(id)
    else skipped.unknown_subjects.push(slug)
  }
  return [...new Set(out)]
}

function parseYears(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string') {
    const n = parseInt(v.replace(/[^0-9]/g, ''), 10)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function optInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null
}

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, onboarding_done')
    .eq('id', user.id)
    .single()
  if (profileError || !profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }
  if (profile.onboarding_done) {
    return NextResponse.json({ error: 'Onboarding already completed' }, { status: 409 })
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Subject slug → UUID lookup (subcategories are public reference data).
  const { data: subs, error: subErr } = await supabase.from('subcategories').select('id, slug')
  if (subErr) {
    return NextResponse.json({ error: subErr.message }, { status: 500 })
  }
  const slugToId = new Map((subs ?? []).map((s) => [s.slug, s.id]))

  const skipped: Skipped = { unknown_subjects: [], unknown_districts: [], not_persisted_yet: [] }
  const role = profile.role as 'student' | 'parent' | 'tutor'

  // Optional shared profile fields.
  const rawProfile = (body as { profile?: Record<string, unknown> }).profile
  const profilePayload: Record<string, unknown> = {}
  if (rawProfile) {
    // A5 — Name: accept a single full_name, or combine first_name + last_name
    // (the tutor "About you" screen collects first + last separately).
    const first = typeof rawProfile.first_name === 'string' ? rawProfile.first_name.trim() : ''
    const last = typeof rawProfile.last_name === 'string' ? rawProfile.last_name.trim() : ''
    if (typeof rawProfile.full_name === 'string' && rawProfile.full_name.trim()) {
      profilePayload.full_name = rawProfile.full_name.trim()
    } else if (first || last) {
      profilePayload.full_name = `${first} ${last}`.trim()
    }
    if (typeof rawProfile.display_name === 'string' && rawProfile.display_name.trim()) {
      profilePayload.display_name = rawProfile.display_name.trim()
    } else if (first) {
      profilePayload.display_name = first
    }
    const age = optInt(rawProfile.age)
    if (age !== null) profilePayload.age = age
    const gender = normalizeGender(rawProfile.gender) // A4: lgbtq→lgbt, na→prefer_not_to_say
    if (gender) profilePayload.gender = gender
    // Seeker "About you" (SeekerAbout) also sends a photo / bio / phone. The RPC
    // (migration 0022) writes these onto the shared profiles row.
    if (typeof rawProfile.avatar_url === 'string' && rawProfile.avatar_url.trim()) {
      profilePayload.avatar_url = rawProfile.avatar_url.trim()
    }
    if (typeof rawProfile.bio === 'string') profilePayload.bio = rawProfile.bio.trim() || null
    if (typeof rawProfile.phone === 'string') profilePayload.phone = rawProfile.phone.trim() || null
  }

  const resolved: Record<string, unknown> = { profile: profilePayload }

  // Builds a seeker section shared by student + each child.
  const buildSeekerPrefs = (src: Record<string, unknown>) => ({
    school_level: VALID_LEVELS.has(src.school_level as string) ? src.school_level : null,
    tutoring_format_pref: VALID_FORMATS.has(src.format as string) ? src.format : null,
    tutoring_type_pref: VALID_TYPES.has(src.type as string) ? src.type : null,
    budget_max_per_hour: optInt(src.budget),
  })

  if (role === 'student') {
    const s = (body as { student?: Record<string, unknown> }).student
    if (!s) return NextResponse.json({ error: 'student section is required for this account' }, { status: 400 })

    const availErr = validateAvail(s.availability, 'student')
    if (availErr) return NextResponse.json({ error: availErr }, { status: 400 })

    resolved.student = {
      ...buildSeekerPrefs(s),
      preferred_languages: mapLanguages(s.languages),
      preferred_districts: mapDistricts(s.districts, skipped),
      interest_subcategory_ids: mapSubjects(s.interests, slugToId, skipped),
      availability: (s.availability as Avail) ?? {},
      // Full per-level school history (SeekerAbout) → student_profiles.education
      // (jsonb; persisted by the complete_onboarding RPC, migration 0023).
      education: s.education && typeof s.education === 'object' && !Array.isArray(s.education) ? s.education : null,
    }
  } else if (role === 'parent') {
    const p = (body as { parent?: Record<string, unknown> }).parent
    if (!p) return NextResponse.json({ error: 'parent section is required for this account' }, { status: 400 })

    const rawChildren = Array.isArray(p.children) ? (p.children as Record<string, unknown>[]) : []
    if (rawChildren.length === 0) return NextResponse.json({ error: 'at least one child is required' }, { status: 400 })
    if (rawChildren.length > 6) return NextResponse.json({ error: 'a parent can have at most 6 children' }, { status: 400 })

    // Validate every child's availability up front so we can return a clean 400.
    for (let i = 0; i < rawChildren.length; i++) {
      const availErr = validateAvail(rawChildren[i].availability, `child[${i}]`)
      if (availErr) return NextResponse.json({ error: availErr }, { status: 400 })
    }

    const children = rawChildren.map((c, i) => ({
      name: typeof c.name === 'string' ? c.name.trim() : `Child ${i + 1}`,
      ...buildSeekerPrefs(c),
      preferred_languages: mapLanguages(c.languages),
      preferred_districts: mapDistricts(c.districts, skipped),
      interest_subcategory_ids: mapSubjects(c.interests, slugToId, skipped),
      availability: (c.availability as Avail) ?? {},
    }))

    resolved.parent = { searching_for_self: p.searching_for_self === true, children }
  } else if (role === 'tutor') {
    const t = (body as { tutor?: Record<string, unknown> }).tutor
    if (!t) return NextResponse.json({ error: 'tutor section is required for this account' }, { status: 400 })
    if (typeof t.slug !== 'string' || !t.slug.trim()) {
      return NextResponse.json({ error: 'tutor.slug is required' }, { status: 400 })
    }

    const availErr = validateAvail(t.availability, 'tutor')
    if (availErr) return NextResponse.json({ error: availErr }, { status: 400 })

    const rawSubjects = Array.isArray(t.subjects) ? (t.subjects as Record<string, unknown>[]) : []
    const subjects = rawSubjects
      .map((sub) => {
        const id = slugToId.get(sub.subcategory as string)
        if (!id) {
          skipped.unknown_subjects.push(String(sub.subcategory))
          return null
        }
        const pay = optInt(sub.pay)
        const achievements = Array.isArray(sub.achievements) ? (sub.achievements as unknown[]).filter((x) => typeof x === 'string') : []
        // A2 — per-subject "relevant experience" list (stored as jsonb).
        const experience = Array.isArray(sub.experiences)
          ? sub.experiences
          : Array.isArray(sub.experience)
            ? sub.experience
            : null
        // 0016 — per-subject lesson format + districts (the app collects these
        // per subject). Districts only apply to in_person / both; map labels →
        // enum codes the same way as seekers'.
        const format = VALID_FORMATS.has(sub.format as string) ? (sub.format as string) : null
        const districts = format === 'online' ? [] : mapDistricts(sub.districts, skipped)
        // 0020 — per-subject teaching levels (which age groups for THIS subject).
        // The app's level keys already match the school_level enum; keep valid ones.
        const levels = Array.isArray(sub.levels)
          ? [...new Set((sub.levels as unknown[]).filter((x): x is string => typeof x === 'string' && VALID_LEVELS.has(x)))]
          : []
        return {
          subcategory_id: id,
          years_experience: parseYears(sub.years),
          hourly_rate_min: pay,
          hourly_rate_max: pay,
          achievements: achievements.length ? { en: achievements.join('; '), zh: '' } : null,
          qualifications: sub.qualifications ?? null,
          exam_results: sub.exam_results ?? null,
          experience,
          format,
          districts,
          levels,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    // A1 — teaching levels (keep only valid 6-value levels).
    const teaching_levels = Array.isArray(t.levels)
      ? [...new Set((t.levels as unknown[]).filter((x): x is string => typeof x === 'string' && VALID_LEVELS.has(x)))]
      : []
    // A3 — education history (object keyed by level) + current studies (array).
    const education = t.education && typeof t.education === 'object' && !Array.isArray(t.education) ? t.education : null
    const current_studies = Array.isArray(t.current_studies) ? t.current_studies : null

    resolved.tutor = {
      slug: t.slug.trim().toLowerCase(),
      university: typeof t.university === 'string' ? t.university.trim() : null,
      tutoring_format: VALID_FORMATS.has(t.format as string) ? t.format : null,
      tutoring_type: VALID_TYPES.has(t.type as string) ? t.type : null,
      teaching_levels,
      education,
      current_studies,
      subjects,
      languages: mapTutorLanguages(t.languages),
      availability: (t.availability as Avail) ?? {},
    }
  }

  const { error: rpcError } = await supabase.rpc('complete_onboarding', { p_payload: resolved })

  if (rpcError) {
    // Custom errcodes raised by the function + slug uniqueness.
    if (rpcError.code === 'P0003') return NextResponse.json({ error: 'Onboarding already completed' }, { status: 409 })
    if (rpcError.code === '23505') return NextResponse.json({ error: 'That tutor URL (slug) is already taken' }, { status: 409 })
    if (rpcError.code === 'PGRST202') {
      return NextResponse.json({ error: 'Onboarding writer not installed — apply migration 0009' }, { status: 503 })
    }
    console.error('[onboarding] RPC error:', rpcError)
    return NextResponse.json({ error: rpcError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, role, skipped }, { status: 201 })
}
