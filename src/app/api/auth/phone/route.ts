import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// E.164 format: + followed by 1-15 digits, first digit non-zero
const E164_REGEX = /^\+[1-9]\d{1,14}$/

const VALID_ROLES = new Set(['parent', 'student', 'tutor'])

// ---------------------------------------------------------------------------
// POST /api/auth/phone/send-otp
// Body: { phone: string, role?: "parent" | "student" | "tutor" }
//
// Sends an SMS one-time code to `phone`. Always returns 200 — intentionally
// does not reveal whether the number already has an account (prevents
// enumeration). `role` is forwarded to the handle_new_user DB trigger so it
// lands on the profile if this turns out to be a new signup.
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { phone, role } = body as { phone?: unknown; role?: unknown }

  if (typeof phone !== 'string' || !E164_REGEX.test(phone)) {
    return NextResponse.json(
      { error: 'phone must be a valid E.164 number (e.g. +85291234567)' },
      { status: 400 }
    )
  }

  const supabase = await createClient()

  const { error } = await supabase.auth.signInWithOtp({
    phone,
    options: {
      // role ends up in raw_user_meta_data → picked up by handle_new_user trigger.
      // Harmless for returning users (trigger is INSERT-only).
      ...(typeof role === 'string' && VALID_ROLES.has(role)
        ? { data: { role } }
        : {}),
    },
  })

  if (error) {
    // Surface provider errors (e.g. invalid number, SMS provider down) but
    // not "user not found" style — those don't apply to signInWithOtp.
    console.error('[auth/phone send-otp]', error)
    return NextResponse.json({ error: error.message }, { status: error.status ?? 400 })
  }

  // Return 200 regardless — caller cannot distinguish new vs existing account.
  return NextResponse.json({ ok: true })
}
