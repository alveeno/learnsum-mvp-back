import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// Basic email shape check — full RFC validation belongs at the UI layer
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const supabase = await createClient()

  // Resolve tutor — only published tutors accept inquiries from the public.
  // RLS on tutor_profiles (is_published = true OR auth.uid() = id) handles this
  // automatically for unauthenticated callers.
  const isUuid = UUID_REGEX.test(slug)
  const { data: tutor, error: tutorError } = await supabase
    .from('tutor_profiles')
    .select('id')
    .eq(isUuid ? 'id' : 'slug', slug)
    .single()

  if (tutorError) {
    if (tutorError.code === 'PGRST116') {
      return NextResponse.json({ error: 'Tutor not found' }, { status: 404 })
    }
    console.error('[inquiries POST] Tutor lookup error:', tutorError)
    return NextResponse.json({ error: tutorError.message }, { status: 500 })
  }

  // Parse body
  const body = await request.json().catch(() => null)

  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { sender_name, sender_email, sender_phone, message, preferred_schedule } =
    body as {
      sender_name?: string
      sender_email?: string
      sender_phone?: string
      message?: string
      preferred_schedule?: string
    }

  // Required field validation
  if (!sender_name?.trim()) {
    return NextResponse.json({ error: 'sender_name is required' }, { status: 400 })
  }

  if (!sender_email?.trim()) {
    return NextResponse.json({ error: 'sender_email is required' }, { status: 400 })
  }

  if (!EMAIL_REGEX.test(sender_email.trim())) {
    return NextResponse.json({ error: 'sender_email is not a valid email address' }, { status: 400 })
  }

  if (!message?.trim()) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 })
  }

  // Optionally capture the logged-in user's profile id.
  // Auth is not required — getUser() failure is silently ignored.
  let senderProfileId: string | null = null
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    senderProfileId = user.id
  }

  // Insert — RLS "inquiries: public insert" (WITH CHECK true) permits this
  // for both authenticated and unauthenticated callers.
  // Note: no .select() here — the SELECT policy only permits the tutor to read
  // their own inquiries, so chaining .select() would fail for public callers.
  const { error: insertError } = await supabase
    .from('inquiries')
    .insert({
      tutor_id: tutor.id,
      sender_profile_id: senderProfileId,
      sender_name: sender_name.trim(),
      sender_email: sender_email.trim(),
      sender_phone: sender_phone?.trim() ?? null,
      message: message.trim(),
      preferred_schedule: preferred_schedule?.trim() ?? null,
    })

  if (insertError) {
    console.error('[inquiries POST] Insert error:', insertError)
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true }, { status: 201 })
}
