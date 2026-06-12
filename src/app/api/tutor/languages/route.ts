import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// /api/tutor/languages — the authenticated tutor's teaching languages
// (tutor_languages: language + proficiency 1..4, display-only).
// PUT is a full replace: send the complete desired list ([] clears all).
// ---------------------------------------------------------------------------

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
    return { user: null, response: NextResponse.json({ error: 'Only tutor accounts have teaching languages' }, { status: 403 }) }
  }
  return { user, response: null }
}

type LangRow = { language: string; proficiency: number | null }

// Normalize the input to a deduped list of { language, proficiency }.
// Accepts an array of { language, proficiency? } or an object { english: 4, ... }.
// Returns { error } on a malformed shape.
function normalizeLanguages(input: unknown): { rows: LangRow[] } | { error: string } {
  const out: LangRow[] = []
  const seen = new Set<string>()

  const add = (lang: unknown, prof: unknown): string | null => {
    if (typeof lang !== 'string' || !lang.trim()) return 'each language must be a non-empty string'
    let proficiency: number | null = null
    if (prof !== undefined && prof !== null) {
      if (typeof prof !== 'number' || !Number.isInteger(prof) || prof < 1 || prof > 4) {
        return 'proficiency must be an integer 1..4 (or null)'
      }
      proficiency = prof
    }
    const key = lang.trim().toLowerCase()
    if (seen.has(key)) return null // last-wins dedupe: drop earlier, keep later
    seen.add(key)
    out.push({ language: key, proficiency })
    return null
  }

  if (Array.isArray(input)) {
    // Walk in reverse so the LAST occurrence of a duplicate language wins.
    for (let i = input.length - 1; i >= 0; i--) {
      const item = input[i]
      if (typeof item !== 'object' || item === null) return { error: 'each language entry must be an object { language, proficiency? }' }
      const err = add((item as Record<string, unknown>).language, (item as Record<string, unknown>).proficiency)
      if (err) return { error: err }
    }
    out.reverse()
  } else if (input && typeof input === 'object') {
    for (const [lang, prof] of Object.entries(input as Record<string, unknown>)) {
      const err = add(lang, prof)
      if (err) return { error: err }
    }
  } else {
    return { error: 'languages must be an array of { language, proficiency? } or an object { language: proficiency }' }
  }

  return { rows: out }
}

// ---------------------------------------------------------------------------
// GET /api/tutor/languages
// ---------------------------------------------------------------------------
export async function GET() {
  const supabase = await createClient()
  const { user, response } = await requireTutor(supabase)
  if (!user) return response!

  const { data, error } = await supabase
    .from('tutor_languages')
    .select('language, proficiency')
    .eq('tutor_id', user.id)
    .order('language', { ascending: true })

  if (error) {
    console.error('[tutor/languages GET] Fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ languages: data ?? [] })
}

// ---------------------------------------------------------------------------
// PUT /api/tutor/languages — full replace. Body: { languages: [...] | {...} }.
// ---------------------------------------------------------------------------
export async function PUT(request: Request) {
  const supabase = await createClient()
  const { user, response } = await requireTutor(supabase)
  if (!user) return response!

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const languages = (body as { languages?: unknown }).languages
  if (languages === undefined) {
    return NextResponse.json({ error: 'languages is required (use [] to clear)' }, { status: 400 })
  }

  const normalized = normalizeLanguages(languages)
  if ('error' in normalized) {
    return NextResponse.json({ error: normalized.error }, { status: 400 })
  }

  // Full replace under RLS (owner delete + owner insert).
  const { error: delErr } = await supabase.from('tutor_languages').delete().eq('tutor_id', user.id)
  if (delErr) {
    console.error('[tutor/languages PUT] Delete error:', delErr)
    return NextResponse.json({ error: delErr.message }, { status: 500 })
  }

  if (normalized.rows.length) {
    const rows = normalized.rows.map((r) => ({ tutor_id: user.id, ...r }))
    const { error: insErr } = await supabase.from('tutor_languages').insert(rows)
    if (insErr) {
      // 23503 (FK) / 42501 (RLS) → no tutor_profiles row yet
      if (insErr.code === '23503' || insErr.code === '42501') {
        return NextResponse.json({ error: 'Create your tutor profile before setting languages' }, { status: 409 })
      }
      console.error('[tutor/languages PUT] Insert error:', insErr)
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }
  }

  return NextResponse.json({ languages: normalized.rows })
}
