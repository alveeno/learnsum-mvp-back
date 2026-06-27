import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// GET /api/conversations
// Returns all conversations for the authenticated user, newest activity first.
// RLS policy "conversations: participant read" filters rows automatically —
// only conversations where auth.uid() = participant_a OR participant_b are returned.
// ---------------------------------------------------------------------------
export async function GET() {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { data: conversations, error } = await supabase
    .from('conversations')
    .select('id, participant_a, participant_b, last_message_at, created_at')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[conversations GET] Fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!conversations || conversations.length === 0) {
    return NextResponse.json({ conversations: [] })
  }

  // Fetch the other participant's profile for each conversation.
  // participant_a and participant_b both FK to profiles — PostgREST can't
  // auto-join them unambiguously when two FKs point at the same table,
  // so we resolve it with a second query and merge in JS.
  const otherIds = [
    ...new Set(
      conversations.map((c) =>
        c.participant_a === user.id ? c.participant_b : c.participant_a
      )
    ),
  ]

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url')
    .in('id', otherIds)

  if (profilesError) {
    console.error('[conversations GET] Profiles fetch error:', profilesError)
    return NextResponse.json({ error: profilesError.message }, { status: 500 })
  }

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]))

  // Unread counts — messages the OTHER participant sent that the caller hasn't
  // read yet. One query across all the caller's conversations, tallied in JS.
  // RLS "messages: participant read" already scopes this to the caller's threads.
  const conversationIds = conversations.map((c) => c.id)
  const { data: unread, error: unreadError } = await supabase
    .from('messages')
    .select('conversation_id')
    .in('conversation_id', conversationIds)
    .neq('sender_id', user.id)
    .eq('is_read', false)

  if (unreadError) {
    console.error('[conversations GET] Unread count error:', unreadError)
    return NextResponse.json({ error: unreadError.message }, { status: 500 })
  }

  const unreadCount = new Map<string, number>()
  for (const m of unread ?? []) {
    unreadCount.set(m.conversation_id, (unreadCount.get(m.conversation_id) ?? 0) + 1)
  }

  const result = conversations.map((c) => {
    const otherId = c.participant_a === user.id ? c.participant_b : c.participant_a
    return {
      ...c,
      other_participant: profileMap.get(otherId) ?? null,
      unread_count: unreadCount.get(c.id) ?? 0,
    }
  })

  return NextResponse.json({ conversations: result })
}

// ---------------------------------------------------------------------------
// POST /api/conversations
// Starts a conversation between the authenticated user and another profile.
// Enforces canonical ordering: the lexicographically smaller UUID goes in
// participant_a — this matches the CHECK constraint on the table and prevents
// duplicate (Alice, Bob) / (Bob, Alice) rows.
//
// If the conversation already exists it is returned rather than errored.
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  const supabase = await createClient()

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

  const { participant_id } = body as { participant_id?: string }

  if (!participant_id) {
    return NextResponse.json({ error: 'participant_id is required' }, { status: 400 })
  }

  if (!UUID_REGEX.test(participant_id)) {
    return NextResponse.json({ error: 'participant_id must be a valid UUID' }, { status: 400 })
  }

  if (participant_id === user.id) {
    return NextResponse.json(
      { error: 'Cannot start a conversation with yourself' },
      { status: 400 }
    )
  }

  // Verify the target profile exists (profiles is publicly readable)
  const { data: targetProfile, error: profileError } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', participant_id)
    .single()

  if (profileError || !targetProfile) {
    return NextResponse.json({ error: 'Participant not found' }, { status: 404 })
  }

  // Canonical ordering: lexicographically smaller UUID in participant_a.
  // String comparison on UUIDs is valid — they use only hex digits and hyphens.
  // This matches the table's CHECK (participant_a < participant_b) constraint.
  const [participant_a, participant_b] = [user.id, participant_id].sort()

  // Check if conversation already exists before inserting
  const { data: existing } = await supabase
    .from('conversations')
    .select('*')
    .eq('participant_a', participant_a)
    .eq('participant_b', participant_b)
    .single()

  if (existing) {
    return NextResponse.json({ conversation: existing, created: false })
  }

  // Insert new conversation
  const { data: conversation, error: insertError } = await supabase
    .from('conversations')
    .insert({ participant_a, participant_b })
    .select()
    .single()

  if (insertError) {
    // 23505 = unique_violation — a concurrent request created the same conversation
    if (insertError.code === '23505') {
      const { data: raceConversation } = await supabase
        .from('conversations')
        .select('*')
        .eq('participant_a', participant_a)
        .eq('participant_b', participant_b)
        .single()

      return NextResponse.json({ conversation: raceConversation, created: false })
    }
    console.error('[conversations POST] Insert error:', insertError)
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({ conversation, created: true }, { status: 201 })
}
