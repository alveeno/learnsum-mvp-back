import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const VALID_DISTRICTS = [
  'CentralWestern', 'WanChai', 'Eastern', 'Southern',
  'YauTsimMong', 'ShamshuiPo', 'KowloonCity', 'WongTaiSin', 'KwunTong',
  'KwaiTsing', 'TsuenWan', 'TuenMun', 'YuenLong', 'North', 'TaiPo',
  'SaiKung', 'ShaTin', 'Islands',
] as const

const VALID_LANGUAGES = ['english', 'cantonese', 'mandarin'] as const

type HkDistrict = (typeof VALID_DISTRICTS)[number]
type PreferredLanguage = (typeof VALID_LANGUAGES)[number]

export async function PATCH(request: Request) {
  const supabase = await createClient()

  // Validate session — getUser() verifies the JWT with Supabase Auth, not just the cookie
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)

  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { display_name, district, preferred_language } = body as {
    display_name?: string
    district?: string
    preferred_language?: string
  }

  // Nothing to update
  if (display_name === undefined && district === undefined && preferred_language === undefined) {
    return NextResponse.json(
      { error: 'Provide at least one field: display_name, district, preferred_language' },
      { status: 400 }
    )
  }

  // Trim and validate display_name if provided
  const trimmedDisplayName = display_name?.trim()
  if (display_name !== undefined && !trimmedDisplayName) {
    return NextResponse.json({ error: 'display_name cannot be empty' }, { status: 400 })
  }

  // Validate enum values if provided
  if (district !== undefined && !VALID_DISTRICTS.includes(district as HkDistrict)) {
    return NextResponse.json(
      { error: `district must be one of: ${VALID_DISTRICTS.join(', ')}` },
      { status: 400 }
    )
  }

  if (
    preferred_language !== undefined &&
    !VALID_LANGUAGES.includes(preferred_language as PreferredLanguage)
  ) {
    return NextResponse.json(
      { error: `preferred_language must be one of: ${VALID_LANGUAGES.join(', ')}` },
      { status: 400 }
    )
  }

  // Build update payload — only include fields that were sent
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (display_name !== undefined) updates.display_name = trimmedDisplayName
  if (district !== undefined) updates.district = district
  if (preferred_language !== undefined) updates.preferred_language = preferred_language

  // RLS policy "profiles: owner update" (USING auth.uid() = id) enforces
  // that this update only affects the authenticated user's own row.
  const { data: profile, error: updateError } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', user.id)
    .select()
    .single()

  if (updateError) {
    console.error('[profiles/me] Update error:', updateError)
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ profile })
}
