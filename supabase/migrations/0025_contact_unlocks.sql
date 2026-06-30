-- LearnSum MVP — Tutor contact unlocks
-- Migration: 0025_contact_unlocks.sql
-- Apply AFTER 0024. Paste and run the WHOLE file.
--
-- Monetization core. A tutor spends a daily-limited "contact unlock" on a seeker
-- to (a) reveal that seeker's phone and (b) be allowed to reply to them in chat.
-- The daily allowance comes from the tutor's tier (free 0 / premium 1 / deluxe 3
-- — enforced in POST /api/tutor/contact-unlocks). An unlock is PERMANENT per
-- seeker (re-contacting is free forever); only the daily cap resets.
--
-- (The seeker-read RPC that uses this table lives in 0029, after the seeker
-- privacy columns it also depends on.)

CREATE TABLE IF NOT EXISTS tutor_contact_unlocks (
  id         uuid        NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4(),
  tutor_id   uuid        NOT NULL REFERENCES profiles ON DELETE CASCADE,
  seeker_id  uuid        NOT NULL REFERENCES profiles ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tutor_id, seeker_id)
);

-- Supports "my unlocks today" (daily cap) and "all my unlocked seekers".
CREATE INDEX IF NOT EXISTS idx_contact_unlocks_tutor
  ON tutor_contact_unlocks (tutor_id, created_at DESC);

ALTER TABLE tutor_contact_unlocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contact_unlocks: owner read"   ON tutor_contact_unlocks;
DROP POLICY IF EXISTS "contact_unlocks: owner insert" ON tutor_contact_unlocks;

-- A tutor reads + creates only their own unlock rows. No update/delete: an
-- unlock is permanent.
CREATE POLICY "contact_unlocks: owner read"
  ON tutor_contact_unlocks FOR SELECT USING (auth.uid() = tutor_id);
CREATE POLICY "contact_unlocks: owner insert"
  ON tutor_contact_unlocks FOR INSERT WITH CHECK (auth.uid() = tutor_id);
