-- LearnSum MVP — Parent children (per-child seeker model)
-- Migration: 0006_child_profiles.sql
-- Reference: plan.md §4.1 (child_profiles) + §4.2 (child_category_interests),
--            CLAUDE.md ("Parent children (NEW)" + §4.11 RLS).
-- Note: local record of objects applied manually via the Supabase SQL editor.
--       Run AFTER 0005 so children can use all six school_level values
--       (kindergarten/primary/middle/high/university/adult).
--
-- A parent does NOT hold tutoring preferences directly — each child does. Each
-- child_profiles row is its own seeker (own interests, own preferences), and
-- matching runs per child (the matching RPC rework will read these rows).
--
-- Privacy (decided): child profiles are OWNER-ONLY (the parent). They are NOT
-- publicly readable like student_profiles, because children are minors and the
-- "tutors browse seekers" feature is v2/unbuilt. The matching RPC is
-- SECURITY DEFINER, so it still reads these rows for ranking regardless of RLS —
-- children get matched to tutors without their details being publicly exposed.
--
-- Reuses existing enums: school_level (0001 + 0005), tutoring_format,
-- tutoring_type. preferred_languages / preferred_districts are text[] (mirrors
-- the student_profiles plan). Max-6-children is enforced at the app layer, not here.

-- ===========================================================================
-- 1. child_profiles — one row per child of a parent account (a seeker)
-- ===========================================================================
CREATE TABLE child_profiles (
  id                   uuid            NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_id            uuid            NOT NULL REFERENCES profiles ON DELETE CASCADE,
  name                 text            NOT NULL,
  school_level         school_level,
  tutoring_format_pref tutoring_format,
  tutoring_type_pref   tutoring_type,
  budget_max_per_hour  integer,
  preferred_languages  text[],
  preferred_districts  text[],
  created_at           timestamptz     NOT NULL DEFAULT now()
);

CREATE INDEX idx_child_profiles_parent ON child_profiles (parent_id);

-- ===========================================================================
-- 2. child_category_interests — subjects each child is interested in (drives
--    per-child matching). Mirrors user_category_interests, keyed on the child.
-- ===========================================================================
CREATE TABLE child_category_interests (
  id             uuid NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4(),
  child_id       uuid NOT NULL REFERENCES child_profiles ON DELETE CASCADE,
  subcategory_id uuid NOT NULL REFERENCES subcategories ON DELETE CASCADE,
  UNIQUE (child_id, subcategory_id)
);

-- UNIQUE(child_id, subcategory_id) already indexes child_id-leading lookups;
-- add a subcategory_id index for the matching join.
CREATE INDEX idx_child_category_interests_subcat ON child_category_interests (subcategory_id);

-- ===========================================================================
-- 3. RLS — owner-only (the parent). No public read (children are minors).
--    Matching reads these via the SECURITY DEFINER RPC, not via these policies.
-- ===========================================================================
ALTER TABLE child_profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE child_category_interests ENABLE ROW LEVEL SECURITY;

-- child_profiles — parent owns the row (auth.uid() = parent_id)
CREATE POLICY "child_profiles: owner read"
  ON child_profiles FOR SELECT
  USING (auth.uid() = parent_id);

CREATE POLICY "child_profiles: owner insert"
  ON child_profiles FOR INSERT
  WITH CHECK (auth.uid() = parent_id);

CREATE POLICY "child_profiles: owner update"
  ON child_profiles FOR UPDATE
  USING (auth.uid() = parent_id);

CREATE POLICY "child_profiles: owner delete"
  ON child_profiles FOR DELETE
  USING (auth.uid() = parent_id);

-- child_category_interests — owned via the child's parent (insert/delete only,
-- like user_category_interests: you add or remove an interest row, never update it)
CREATE POLICY "child_category_interests: owner read"
  ON child_category_interests FOR SELECT
  USING (auth.uid() = (SELECT parent_id FROM child_profiles WHERE id = child_id));

CREATE POLICY "child_category_interests: owner insert"
  ON child_category_interests FOR INSERT
  WITH CHECK (auth.uid() = (SELECT parent_id FROM child_profiles WHERE id = child_id));

CREATE POLICY "child_category_interests: owner delete"
  ON child_category_interests FOR DELETE
  USING (auth.uid() = (SELECT parent_id FROM child_profiles WHERE id = child_id));
