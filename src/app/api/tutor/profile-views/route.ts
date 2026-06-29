import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Relative "time ago" label, e.g. "now" / "5m" / "2h" / "3d".
function ago(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diffMs / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

type ViewRow = {
  viewer_id: string
  created_at: string
  profiles: {
    display_name: string | null
    full_name: string | null
    avatar_url: string | null
    role: string
  } | null
}

// ---------------------------------------------------------------------------
// GET /api/tutor/profile-views → { viewers }
// The parents/students who viewed the signed-in tutor's profile, most recent
// first. Only seekers shape into the list (tutor↔tutor views are dropped). The
// `id` is the seeker's profile id → tap opens GET /api/seekers/[id].
// ---------------------------------------------------------------------------
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { data: views, error } = await supabase
    .from('profile_views')
    .select('viewer_id, created_at, profiles ( display_name, full_name, avatar_url, role )')
    .eq('tutor_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('[profile-views GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // PostgREST infers the to-one embed as an array — read it as a single object.
  const rows = (views ?? []) as unknown as ViewRow[]
  const viewers = rows
    .filter((v) => v.profiles && (v.profiles.role === 'student' || v.profiles.role === 'parent'))
    .map((v) => {
      const p = v.profiles!
      const role = p.role as 'student' | 'parent'
      return {
        id: v.viewer_id,
        name: p.display_name || p.full_name || (role === 'parent' ? 'Parent' : 'Student'),
        role,
        note: role === 'parent' ? 'Parent looking for a tutor' : 'Student looking for a tutor',
        ago: ago(v.created_at),
        avatar_url: p.avatar_url,
      }
    })

  return NextResponse.json({ viewers })
}
