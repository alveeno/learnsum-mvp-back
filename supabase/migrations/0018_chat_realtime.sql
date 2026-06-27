-- LearnSum MVP — Turn on in-app chat (Realtime + read receipts)
-- Migration: 0018_chat_realtime.sql
-- Reference: BACKEND_GAP_ANALYSIS.md B2.
-- Note: local record of objects applied manually via the Supabase SQL editor.
--       Run AFTER 0017. Paste and run the WHOLE file.
--
-- The conversations / messages tables + endpoints already exist (0001 / 0002 +
-- the /api/conversations* routes). Two things were missing to make chat actually
-- live rather than dormant:
--   1. Realtime — add the tables to the `supabase_realtime` publication so the
--      app can subscribe to new messages as they arrive (RLS still applies to
--      the stream, so only participants receive a conversation's messages).
--   2. Read receipts — the messages table had SELECT + INSERT policies but no
--      UPDATE policy, so `is_read` could never be flipped. This adds an UPDATE
--      policy scoped to conversation participants.

-- ---------------------------------------------------------------------------
-- 1. Realtime publication.
--    `supabase_realtime` is created by Supabase on every project. ADD TABLE
--    errors if the table is already a member, so guard each add.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Let a conversation participant mark messages read.
--    USING = the caller is a participant of the message's conversation. The
--    endpoint (PATCH /api/conversations/[id]/messages) only ever flips is_read
--    on messages it did NOT send (sender_id <> auth.uid()).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "messages: participant update (mark read)" ON messages;
CREATE POLICY "messages: participant update (mark read)"
  ON messages FOR UPDATE
  USING (
    auth.uid() IN (
      SELECT participant_a FROM conversations WHERE id = conversation_id
      UNION ALL
      SELECT participant_b FROM conversations WHERE id = conversation_id
    )
  );
