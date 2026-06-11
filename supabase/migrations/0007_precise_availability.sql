-- LearnSum MVP — Availability: coarse buckets → precise time ranges
-- Migration: 0007_precise_availability.sql
-- Reference: plan.md §4.3 (precise ranges), CLAUDE.md ("Availability — precise time ranges").
-- Note: local record of objects applied manually via the Supabase SQL editor.
--       Run AFTER 0005 and 0006 (the seeker_availability RLS reads child_profiles).
--       Paste and run the WHOLE file as one block.
--
-- Replaces the morning|afternoon|evening "time_slot" model with precise
-- start_min/end_min minute ranges (0–1440, end > start), multiple ranges per day.
-- This lets the matching RPC compute REAL time-overlap (reworked next migration).
--
-- seeker_availability is rebuilt with owner_id + owner_type ('student' | 'child')
-- so a parent's availability can be stored PER CHILD. owner_id is polymorphic
-- (a student's profile_id OR a child_profiles.id), so it has no FK — orphan rows
-- on account/child deletion are cleaned up by the delete endpoints (TODO).
--
-- Existing bucket rows are test data and are NOT converted — they are cleared.

-- 0. Drop the old bucket-based matching RPC if 0003 was ever applied. The next
--    migration recreates it for precise time-overlap. Safe no-op otherwise.
DROP FUNCTION IF EXISTS match_tutors_for_seeker(integer, integer);

-- ===========================================================================
-- 1. tutor_availability: time_slot → start_min/end_min (preserves existing RLS).
--    Table is emptied first so the NOT NULL range columns can be added cleanly.
--    DROP COLUMN ... CASCADE also drops the old UNIQUE(tutor_id, day, time_slot).
-- ===========================================================================
DELETE FROM tutor_availability;

ALTER TABLE tutor_availability DROP COLUMN time_slot CASCADE;

ALTER TABLE tutor_availability
  ADD COLUMN start_min integer NOT NULL,
  ADD COLUMN end_min   integer NOT NULL;

ALTER TABLE tutor_availability
  ADD CONSTRAINT tutor_availability_range_chk
    CHECK (start_min >= 0 AND end_min <= 1440 AND start_min < end_min);

ALTER TABLE tutor_availability
  ADD CONSTRAINT tutor_availability_unique
    UNIQUE (tutor_id, day_of_week, start_min, end_min);

-- ===========================================================================
-- 2. seeker_availability: rebuild with owner_id + owner_type + precise ranges.
-- ===========================================================================
DROP TABLE IF EXISTS seeker_availability CASCADE;

DO $$ BEGIN
  CREATE TYPE seeker_owner_type AS ENUM ('student', 'child');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE seeker_availability (
  id          uuid              NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id    uuid              NOT NULL,  -- student's profile_id OR child_profiles.id (polymorphic; no FK)
  owner_type  seeker_owner_type NOT NULL,
  day_of_week day_of_week       NOT NULL,
  start_min   integer           NOT NULL,
  end_min     integer           NOT NULL,
  CONSTRAINT seeker_availability_range_chk
    CHECK (start_min >= 0 AND end_min <= 1440 AND start_min < end_min),
  UNIQUE (owner_id, owner_type, day_of_week, start_min, end_min)
);

CREATE INDEX idx_seeker_availability_owner ON seeker_availability (owner_id, owner_type);

-- ===========================================================================
-- 3. RLS — owner-only. A student owns their own rows; a child's rows belong to
--    the parent. Matching reads these via the SECURITY DEFINER RPC, not here.
-- ===========================================================================
ALTER TABLE seeker_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "seeker_availability: owner read"
  ON seeker_availability FOR SELECT
  USING (
    (owner_type = 'student' AND auth.uid() = owner_id)
    OR (owner_type = 'child' AND auth.uid() = (SELECT parent_id FROM child_profiles WHERE id = owner_id))
  );

CREATE POLICY "seeker_availability: owner insert"
  ON seeker_availability FOR INSERT
  WITH CHECK (
    (owner_type = 'student' AND auth.uid() = owner_id)
    OR (owner_type = 'child' AND auth.uid() = (SELECT parent_id FROM child_profiles WHERE id = owner_id))
  );

CREATE POLICY "seeker_availability: owner delete"
  ON seeker_availability FOR DELETE
  USING (
    (owner_type = 'student' AND auth.uid() = owner_id)
    OR (owner_type = 'child' AND auth.uid() = (SELECT parent_id FROM child_profiles WHERE id = owner_id))
  );

-- ===========================================================================
-- 4. Remove the now-unused time_slot enum (no column references it anymore).
-- ===========================================================================
DROP TYPE IF EXISTS time_slot;
