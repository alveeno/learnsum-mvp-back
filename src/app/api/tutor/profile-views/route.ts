import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const DETAIL_LIMIT = 30

const LEVEL_LABEL: Record<string, string> = {
  kindergarten: 'Kindergarten',
  primary: 'Primary',
  middle: 'Junior Secondary',
  high: 'Senior Secondary',
  university: 'University',
  adult: 'Adult',
}

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

type SeekerJson = {
  name?: string | null
  role?: string
  level?: string | null
  child?: { level?: string | null } | null
  subjects?: string[] | null
  avatar_url?: string | null
}

// ---------------------------------------------------------------------------
// GET /api/tutor/profile-views → { tier, locked, detailed, count, viewers }
// Tier-gated "who viewed your profile":
//   • free    → locked (upgrade prompt); no rows.
//   • premium → count + an anonymized list (role + time, no name/age/level).
//   • deluxe  → full details, but only for viewers whose profile is public
//               (private viewers fall back to anonymized).
// ---------------------------------------------------------------------------
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { data: tutor } = await supabase
    .from('tutor_profiles')
    .select('tier')
    .eq('id', user.id)
    .maybeSingle()
  const tier = (tutor?.tier as 'free' | 'premium' | 'deluxe' | undefined) ?? 'free'

  const { data: views, error } = await supabase
    .from('profile_views')
    .select('viewer_id, created_at, profiles ( display_name, full_name, avatar_url, role )')
    .eq('tutor_id', user.id)
    .order('created_at', { ascending: false })
    .limit(DETAIL_LIMIT)

  if (error) {
    console.error('[profile-views GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Only seekers belong in "who viewed you".
  const rows = ((views ?? []) as unknown as ViewRow[]).filter(
    (v) => v.profiles && (v.profiles.role === 'student' || v.profiles.role === 'parent')
  )
  const count = rows.length

  // Free: locked, no rows.
  if (tier === 'free') {
    return NextResponse.json({ tier, locked: true, detailed: false, count, viewers: [] })
  }

  // Premium: anonymized list (no name/age/level).
  if (tier === 'premium') {
    const viewers = rows.map((v) => {
      const role = v.profiles!.role as 'student' | 'parent'
      return {
        id: '',
        name: role === 'parent' ? 'A parent' : 'A student',
        role,
        note: 'Viewed your profile',
        ago: ago(v.created_at),
        avatar_url: null,
      }
    })
    return NextResponse.json({ tier, locked: false, detailed: false, count, viewers })
  }

  // Deluxe: full details for public viewers (via the gated seeker RPC), else anonymized.
  const viewers = await Promise.all(
    rows.map(async (v) => {
      const role = v.profiles!.role as 'student' | 'parent'
      const { data: seeker } = await supabase.rpc('get_seeker_for_tutor', { p_seeker_id: v.viewer_id })
      const s = seeker as SeekerJson | null
      if (!s) {
        // Private viewer — show anonymized.
        return {
          id: '',
          name: role === 'parent' ? 'A parent' : 'A student',
          role,
          note: 'Viewed your profile',
          ago: ago(v.created_at),
          avatar_url: null,
        }
      }
      const level = s.role === 'parent' ? s.child?.level : s.level
      const subject = s.subjects?.[0]
      const note = [subject, level ? LEVEL_LABEL[level] ?? level : null].filter(Boolean).join(' · ') || 'Viewed your profile'
      return {
        id: v.viewer_id,
        name: s.name || (role === 'parent' ? 'Parent' : 'Student'),
        role,
        note,
        ago: ago(v.created_at),
        avatar_url: s.avatar_url ?? null,
      }
    })
  )

  return NextResponse.json({ tier, locked: false, detailed: true, count, viewers })
}
