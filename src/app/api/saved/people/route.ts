import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type SavedRow = {
  person_id: string
  created_at: string
  profiles: {
    display_name: string | null
    full_name: string | null
    avatar_url: string | null
    role: string
  } | null
}

type TutorMetaRow = {
  id: string
  slug: string
  tutor_subcategories: { subcategories: { name_en: string } | null }[] | null
}

// ---------------------------------------------------------------------------
// GET /api/saved/people → { saved: SavedPerson[] }
// The tutor's mixed bookmarks (other tutors AND seekers). For a saved tutor the
// returned `id` is their slug (so the app opens the tutor profile); for a seeker
// it's their profile id (→ /api/seekers/[id]).
// ---------------------------------------------------------------------------
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { data: saved, error } = await supabase
    .from('saved_people')
    .select('person_id, created_at, profiles ( display_name, full_name, avatar_url, role )')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[saved/people GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (saved ?? []) as unknown as SavedRow[]

  // Resolve slugs + a subject subtitle for the saved tutors (one extra query).
  const tutorIds = rows.filter((r) => r.profiles?.role === 'tutor').map((r) => r.person_id)
  const tutorMeta = new Map<string, { slug: string; subtitle: string }>()
  if (tutorIds.length > 0) {
    const { data: tutors } = await supabase
      .from('tutor_profiles')
      .select('id, slug, tutor_subcategories ( subcategories ( name_en ) )')
      .in('id', tutorIds)
    for (const t of (tutors ?? []) as unknown as TutorMetaRow[]) {
      const firstSubject = t.tutor_subcategories?.[0]?.subcategories?.name_en
      tutorMeta.set(t.id, { slug: t.slug, subtitle: firstSubject ?? 'Tutor' })
    }
  }

  const people = rows
    .filter((r) => r.profiles)
    .map((r) => {
      const p = r.profiles!
      if (p.role === 'tutor') {
        const meta = tutorMeta.get(r.person_id)
        return {
          id: meta?.slug ?? r.person_id,
          kind: 'tutor' as const,
          name: p.display_name || p.full_name || 'Tutor',
          subtitle: meta?.subtitle ?? 'Tutor',
          avatar_url: p.avatar_url,
        }
      }
      const kind = p.role === 'parent' ? ('parent' as const) : ('student' as const)
      return {
        id: r.person_id,
        kind,
        name: p.display_name || p.full_name || (kind === 'parent' ? 'Parent' : 'Student'),
        subtitle: kind === 'parent' ? 'Parent' : 'Student',
        avatar_url: p.avatar_url,
      }
    })

  return NextResponse.json({ saved: people })
}

// ---------------------------------------------------------------------------
// POST /api/saved/people  { id, kind }
// Bookmark a person. `id` is a tutor slug (or uuid) when kind='tutor', else the
// seeker's profile uuid. Idempotent.
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { id?: string; kind?: string } | null
  const id = body?.id?.trim()
  const kind = body?.kind
  if (!id || (kind !== 'tutor' && kind !== 'parent' && kind !== 'student')) {
    return NextResponse.json({ error: 'id and a valid kind (tutor|parent|student) are required' }, { status: 400 })
  }

  // Resolve to a profile id. Tutors may come in as a slug.
  let personId = id
  if (!UUID_REGEX.test(id)) {
    if (kind !== 'tutor') {
      return NextResponse.json({ error: 'id must be a uuid for seekers' }, { status: 400 })
    }
    const { data: tutor } = await supabase
      .from('tutor_profiles')
      .select('id')
      .eq('slug', id.toLowerCase())
      .maybeSingle()
    if (!tutor) return NextResponse.json({ error: 'Person not found' }, { status: 404 })
    personId = tutor.id
  }

  const { error: insertErr } = await supabase
    .from('saved_people')
    .insert({ owner_id: user.id, person_id: personId })

  if (insertErr) {
    if (insertErr.code === '23505') return NextResponse.json({ saved: true }) // already saved
    if (insertErr.code === '23514') {
      return NextResponse.json({ error: "You can't save yourself" }, { status: 400 })
    }
    if (insertErr.code === '23503') return NextResponse.json({ error: 'Person not found' }, { status: 404 })
    console.error('[saved/people POST]', insertErr)
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  return NextResponse.json({ saved: true }, { status: 201 })
}
