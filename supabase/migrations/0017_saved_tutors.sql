-- LearnSum MVP — Saved / bookmarked tutors
-- Migration: 0017_saved_tutors.sql
-- Reference: BACKEND_GAP_ANALYSIS.md H3.
-- Note: local record of objects applied manually via the Supabase SQL editor.
--       Run AFTER 0016. Paste and run the WHOLE file.
--
-- Backs the seeker "Saved" tab (previously in-memory, session-only on the
-- device). One row per (user, tutor) bookmark. Any authenticated user
-- (student / parent / tutor) may bookmark a published tutor. Owner-only RLS —
-- your saved list is private to you and nobody else can read it.

CREATE TABLE IF NOT EXISTS saved_tutors (
  id          uuid        NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id  uuid        NOT NULL REFERENCES profiles       ON DELETE CASCADE,
  tutor_id    uuid        NOT NULL REFERENCES tutor_profiles ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, tutor_id)
);

-- Index supports "my saved tutors, newest first".
CREATE INDEX IF NOT EXISTS idx_saved_tutors_profile ON saved_tutors (profile_id, created_at DESC);

ALTER TABLE saved_tutors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saved_tutors: owner read"   ON saved_tutors;
DROP POLICY IF EXISTS "saved_tutors: owner insert" ON saved_tutors;
DROP POLICY IF EXISTS "saved_tutors: owner delete" ON saved_tutors;

CREATE POLICY "saved_tutors: owner read"   ON saved_tutors FOR SELECT USING (auth.uid() = profile_id);
CREATE POLICY "saved_tutors: owner insert" ON saved_tutors FOR INSERT WITH CHECK (auth.uid() = profile_id);
CREATE POLICY "saved_tutors: owner delete" ON saved_tutors FOR DELETE USING (auth.uid() = profile_id);
