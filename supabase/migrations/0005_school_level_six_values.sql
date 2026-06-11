-- LearnSum MVP — Education levels: 4 → 6 (clean rebuild)
-- Migration: 0005_school_level_six_values.sql
-- Reference: plan.md §4.1, CLAUDE.md (6-value school_level)
-- Note: local record of objects applied manually via the Supabase SQL editor.
--       Paste and run the WHOLE file as one block — the steps depend on each
--       other (new type → swap column → drop old type → rename). All DDL here is
--       transactional in Postgres, so it applies atomically or not at all.
--
-- Rebuilds the school_level enum to EXACTLY the six values the app collects,
-- in logical school order, dropping the legacy 'secondary' value entirely.
-- Frontend offers: kindergarten | primary | middle | high | university | adult.
--
-- 'secondary' is superseded by 'middle' (junior) + 'high' (senior). Any existing
-- 'secondary' record (test data only) is mapped to 'middle' — change the CASE in
-- step 2 to 'high' if you prefer the senior band.
--
-- Safe because nothing else depends on the type: it is used only by
-- student_profiles.school_level (the matching RPC does not reference it, and
-- child_profiles does not exist yet — when added it will use the renamed type).

-- 1. New enum: exactly the six values, in ascending school order.
CREATE TYPE school_level_new AS ENUM (
  'kindergarten', 'primary', 'middle', 'high', 'university', 'adult'
);

-- 2. Move student_profiles.school_level onto the new type, converting values.
--    NULLs are preserved; legacy 'secondary' → 'middle'.
ALTER TABLE student_profiles
  ALTER COLUMN school_level TYPE school_level_new
  USING (
    CASE school_level::text
      WHEN 'secondary' THEN 'middle'
      ELSE school_level::text
    END
  )::school_level_new;

-- 3. Retire the old type and promote the new one into its name.
DROP TYPE school_level;
ALTER TYPE school_level_new RENAME TO school_level;
