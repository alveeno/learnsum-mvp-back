import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const VALID_ROLES = ['parent', 'student', 'tutor'] as const
type UserRole = (typeof VALID_ROLES)[number]

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)

  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { email, password, role } = body as {
    email?: string
    password?: string
    role?: string
  }

  if (!email || !password || !role) {
    return NextResponse.json(
      { error: 'email, password, and role are required' },
      { status: 400 }
    )
  }

  if (!VALID_ROLES.includes(role as UserRole)) {
    return NextResponse.json(
      { error: 'role must be one of: parent, student, tutor' },
      { status: 400 }
    )
  }

  try {
    const supabase = await createClient()

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // role is read by the handle_new_user DB trigger to populate profiles.role
        data: { role },
      },
    })

    if (error) {
      console.error('[signup] Supabase auth error:', {
        message: error.message,
        status: error.status,
        name: error.name,
      })
      return NextResponse.json({ error: error.message }, { status: error.status ?? 400 })
    }

    return NextResponse.json(
      {
        user: data.user,
        // session is null when email confirmation is required
        session: data.session,
      },
      { status: 201 }
    )
  } catch (err) {
    console.error('[signup] Unexpected exception:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
