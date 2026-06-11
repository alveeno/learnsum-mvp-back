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
const VALID_GENDERS = new Set(['male', 'female', 'other', 'prefer_not_to_say'])
// profiles.preferred_language is still the original 3-value enum (single primary).
const PRIMARY_LANGS = new Set(['english', 'cantonese', 'mandarin'])

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
    if (typeof rawProfile.display_name === 'string') profilePayload.display_name = rawProfile.display_name.trim()
    if (typeof rawProfile.full_name === 'string') profilePayload.full_name = rawProfile.full_name.trim()
    const age = optInt(rawProfile.age)
    if (age !== null) profilePayload.age = age
    if (typeof rawProfile.gender === 'string' && VALID_GENDERS.has(rawProfile.gender)) profilePayload.gender = rawProfile.gender
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

    const langs = mapLanguages(s.languages)
    const districts = mapDistricts(s.districts, skipped)

    resolved.student = {
      ...buildSeekerPrefs(s),
      // primary language/district into the single profiles columns (multi-value pending a later migration)
      preferred_language: langs.find((l) => PRIMARY_LANGS.has(l)) ?? null,
      district: districts[0] ?? null,
      interest_subcategory_ids: mapSubjects(s.interests, slugToId, skipped),
      availability: (s.availability as Avail) ?? {},
    }
    if (langs.some((l) => !PRIMARY_LANGS.has(l)) || districts.length > 1) {
      skipped.not_persisted_yet.push('student: only one primary language + district stored (multi-value lists pending a later migration)')
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
        return {
          subcategory_id: id,
          years_experience: parseYears(sub.years),
          hourly_rate_min: pay,
          hourly_rate_max: pay,
          achievements: achievements.length ? { en: achievements.join('; '), zh: '' } : null,
          qualifications: sub.qualifications ?? null,
          exam_results: sub.exam_results ?? null,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    resolved.tutor = {
      slug: t.slug.trim().toLowerCase(),
      university: typeof t.university === 'string' ? t.university.trim() : null,
      tutoring_format: VALID_FORMATS.has(t.format as string) ? t.format : null,
      tutoring_type: VALID_TYPES.has(t.type as string) ? t.type : null,
      subjects,
      availability: (t.availability as Avail) ?? {},
    }
    // These tutor fields have no DB home yet — report rather than silently drop.
    skipped.not_persisted_yet.push('tutor teaching levels, per-language proficiency, and the "relevant experience" list (pending tutor_languages + experience-column migrations)')
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
