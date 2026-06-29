-- LearnSum MVP — Tutor saved people (mixed bookmarks)
-- Migration: 0027_saved_people.sql
-- Apply AFTER 0026. Paste and run the WHOLE file.
--
-- Backs the tutor "Saved" tab, a MIXED list of other tutors AND seekers
-- (parents/students) a tutor bookmarked. Distinct from the seeker-side
-- `saved_tutors` (0017, seeker-saves-tutor only). One row per (owner, person);
-- owner-only RLS — your saved list is private to you.

CREATE TABLE IF NOT EXISTS saved_people (
  id         uuid        NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id   uuid        NOT NULL REFERENCES profiles ON DELETE CASCADE,
  person_id  uuid        NOT NULL REFERENCES profiles ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, person_id),
  CHECK (owner_id <> person_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_people_owner ON saved_people (owner_id, created_at DESC);

ALTER TABLE saved_people ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saved_people: owner read"   ON saved_people;
DROP POLICY IF EXISTS "saved_people: owner insert" ON saved_people;
DROP POLICY IF EXISTS "saved_people: owner delete" ON saved_people;

CREATE POLICY "saved_people: owner read"   ON saved_people FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "saved_people: owner insert" ON saved_people FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "saved_people: owner delete" ON saved_people FOR DELETE USING (auth.uid() = owner_id);
