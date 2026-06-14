import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const E164_REGEX = /^\+[1-9]\d{1,14}$/
// OTP from Supabase is a 6-digit numeric code
const OTP_REGEX = /^\d{6}$/

const VALID_ROLES = new Set(['parent', 'student', 'tutor'])

// ---------------------------------------------------------------------------
// POST /api/auth/phone/verify
// Body: { phone: string, token: string, role?: "parent" | "student" | "tutor" }
//
// Verifies the OTP and returns a live session. Also:
//   - Returns is_new_user: true when onboarding_done is false (so the
//     frontend knows to navigate to the onboarding flow, not the home screen).
//   - For new accounts: assigns `role` to profiles.role if provided (
//     belt-and-suspenders over the handle_new_user trigger, same pattern as
//     the OAuth callback).
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { phone, token, role } = body as {
    phone?: unknown
    token?: unknown
    role?: unknown
  }

  if (typeof phone !== 'string' || !E164_REGEX.test(phone)) {
    return NextResponse.json(
      { error: 'phone must be a valid E.164 number (e.g. +85291234567)' },
      { status: 400 }
    )
  }

  if (typeof token !== 'string' || !OTP_REGEX.test(token)) {
    return NextResponse.json(
      { error: 'token must be a 6-digit code' },
      { status: 400 }
    )
  }

  const supabase = await createClient()

  const { data, error } = await supabase.auth.verifyOtp({
    phone,
    token,
    type: 'sms',
  })

  if (error || !data.user) {
    return NextResponse.json(
      { error: error?.message ?? 'Invalid or expired code' },
      { status: 401 }
    )
  }

  // Read the profile to determine new vs returning user.
  const { data: profile } = await supabase
    .from('profiles')
    .select('onboarding_done, role')
    .eq('id', data.user.id)
    .single()

  const is_new_user = !profile?.onboarding_done

  // For new accounts: override role if the caller supplied a valid one.
  // A returning user's role is never touched — a crafted request cannot flip it.
  if (is_new_user && typeof role === 'string' && VALID_ROLES.has(role)) {
    const { error: roleError } = await supabase
      .from('profiles')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('id', data.user.id)
    if (roleError) {
      console.error('[auth/phone verify] role assignment error:', roleError)
    }
  }

  return NextResponse.json({
    user: data.user,
    session: data.session,
    is_new_user,
  })
}
