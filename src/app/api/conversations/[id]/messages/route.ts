import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const PAGE_SIZE = 20
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// Shared: resolve conversation and verify the caller is a participant.
// Returns the conversation row, or a NextResponse error to return early.
// RLS "conversations: participant read" filters automatically — if the caller
// isn't a participant (or the conversation doesn't exist), we get PGRST116.
// We return 404 in both cases to avoid leaking whether the conversation exists.
// ---------------------------------------------------------------------------
async function resolveConversation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  conversationId: string,
  userId: string
) {
  const { data: conversation, error } = await supabase
    .from('conversations')
    .select('id, participant_a, participant_b')
    .eq('id', conversationId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return {
        conversation: null,
        response: NextResponse.json(
          { error: 'Conversation not found' },
          { status: 404 }
        ),
      }
    }
    console.error('[messages] Conversation lookup error:', error)
    return {
      conversation: null,
      response: NextResponse.json({ error: error.message }, { status: 500 }),
    }
  }

  // Explicit participant check — belt-and-suspenders on top of RLS
  const isParticipant =
    conversation.participant_a === userId || conversation.participant_b === userId

  if (!isParticipant) {
    return {
      conversation: null,
      response: NextResponse.json({ error: 'Conversation not found' }, { status: 404 }),
    }
  }

  return { conversation, response: null }
}

// ---------------------------------------------------------------------------
// GET /api/conversations/[id]/messages?page=N
// Returns paginated messages newest-first (page 1 = most recent).
// Clients should reverse the array for chronological display and paginate
// backward (?page=2, ?page=3 …) to load older history.
// ---------------------------------------------------------------------------
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { id: conversationId } = params
  const { searchParams } = new URL(request.url)

  if (!UUID_REGEX.test(conversationId)) {
    return NextResponse.json({ error: 'Invalid conversation id' }, { status: 400 })
  }

  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { conversation, response } = await resolveConversation(
    supabase,
    conversationId,
    user.id
  )
  if (!conversation) return response!

  const rawPage = parseInt(searchParams.get('page') ?? '1', 10)
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1
  const offset = (page - 1) * PAGE_SIZE

  const { data: messages, error, count } = await supabase
    .from('messages')
    .select(
      `
      id,
      conversation_id,
      sender_id,
      content,
      is_read,
      created_at
    `,
      { count: 'exact' }
    )
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  if (error) {
    if (error.code === 'PGRST103') {
      return NextResponse.json({
        messages: [],
        pagination: { page, page_size: PAGE_SIZE, total: 0, has_more: false },
      })
    }
    console.error('[messages GET] Fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    messages: messages ?? [],
    pagination: {
      page,
      page_size: PAGE_SIZE,
      total: count ?? 0,
      has_more: offset + PAGE_SIZE < (count ?? 0),
    },
  })
}

// ---------------------------------------------------------------------------
// POST /api/conversations/[id]/messages
// Sends a message from the authenticated user into the conversation.
// After insert, updates conversations.last_message_at so the GET /conversations
// list sorts correctly.
// ---------------------------------------------------------------------------
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { id: conversationId } = params

  if (!UUID_REGEX.test(conversationId)) {
    return NextResponse.json({ error: 'Invalid conversation id' }, { status: 400 })
  }

  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { conversation, response } = await resolveConversation(
    supabase,
    conversationId,
    user.id
  )
  if (!conversation) return response!

  const body = await request.json().catch(() => null)

  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { content } = body as { content?: string }

  if (!content?.trim()) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 })
  }

  // Insert message — RLS "messages: participant insert" enforces
  // auth.uid() = sender_id AND caller is a conversation participant.
  // No .select() after insert: the messages SELECT RLS requires a subquery join
  // on conversations, which may fail depending on Supabase plan limits.
  // We return the inserted data from the insert payload instead.
  const now = new Date().toISOString()

  const { error: insertError } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    sender_id: user.id,
    content: content.trim(),
  })

  if (insertError) {
    console.error('[messages POST] Insert error:', insertError)
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // Update last_message_at on the conversation so the list sorts correctly.
  // RLS "conversations: participant update" permits this since we are a participant.
  const { error: updateError } = await supabase
    .from('conversations')
    .update({ last_message_at: now })
    .eq('id', conversationId)

  if (updateError) {
    // Non-fatal — message was sent; the sort order just won't update immediately.
    console.warn('[messages POST] last_message_at update failed:', updateError)
  }

  return NextResponse.json(
    {
      message: {
        conversation_id: conversationId,
        sender_id: user.id,
        content: content.trim(),
        is_read: false,
        created_at: now,
      },
    },
    { status: 201 }
  )
}
