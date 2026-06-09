-- LearnSum MVP — Seeker availability + tutor matching
-- Migration: 0003_seeker_availability_and_matching.sql
-- Reference: plan.md §4 (matching), CLAUDE.md (two-sided matching)
-- Note: like 0002_rls.sql, this is a local record of objects applied manually
--       via the Supabase dashboard. Do not re-run against a live project.

-- ===========================================================================
-- 1. seeker_availability
-- Mirrors tutor_availability, but keyed on profiles (works for both student
-- and parent roles). Normalized one row per (day, slot) for cheap overlap
-- scoring in SQL. Reuses the existing day_of_week / time_slot enums.
-- ===========================================================================
CREATE TABLE seeker_availability (
  id          uuid        NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id  uuid        NOT NULL REFERENCES profiles ON DELETE CASCADE,
  day_of_week day_of_week NOT NULL,
  time_slot   time_slot   NOT NULL,
  UNIQUE (profile_id, day_of_week, time_slot)
);

CREATE INDEX seeker_availability_profile_idx ON seeker_availability (profile_id);

-- ---------------------------------------------------------------------------
-- RLS — owner-only (personal scheduling data).
-- Mirrors the user_category_interests pattern. The matching function below is
-- SECURITY DEFINER, so it can read these rows without a public-read policy.
-- ---------------------------------------------------------------------------
ALTER TABLE seeker_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "seeker_availability: owner read"
  ON seeker_availability FOR SELECT
  USING (auth.uid() = profile_id);

CREATE POLICY "seeker_availability: owner insert"
  ON seeker_availability FOR INSERT
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "seeker_availability: owner delete"
  ON seeker_availability FOR DELETE
  USING (auth.uid() = profile_id);

-- ===========================================================================
-- 2. match_tutors_for_seeker(p_page, p_page_size)
-- Returns published tutors ranked by a weighted similarity score against the
-- calling seeker's (student/parent) preferences. SECURITY DEFINER so it can
-- read tutor + seeker preference rows regardless of RLS; identifies the caller
-- via auth.uid() (never a spoofable argument).
--
-- Scoring — each dimension normalized to [0,1], then a weighted average over
-- only the *applicable* dimensions (a dimension with no data on either side is
-- dropped and the remaining weights are renormalized, so missing data never
-- zeroes a tutor out). Final score is scaled to [0,100].
--
--   Category overlap ............ 40   (matched subcats / seeker's interests)
--   Availability overlap ........ 15   (matched day+slot pairs / seeker's slots)
--   District .................... 15   (1 if same district; dropped for
--                                       online-only tutors — district is moot)
--   Preferred language .......... 15   (1 if equal)
--   Format / type / budget ...... 15   (avg of the applicable sub-signals)
--
-- Weights are the five integer literals below — tune them in one place.
-- ===========================================================================
CREATE OR REPLACE FUNCTION match_tutors_for_seeker(
  p_page      integer DEFAULT 1,
  p_page_size integer DEFAULT 20
)
RETURNS TABLE (
  tutor_id    uuid,
  score       numeric,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  -- Caller's preference scalars (student OR parent detail row)
  seeker AS (
    SELECT
      p.id,
      p.district                                              AS seeker_district,
      p.preferred_language                                    AS seeker_lang,
      COALESCE(sp.tutoring_format_pref, pp.tutoring_format_pref) AS fmt_pref,
      COALESCE(sp.tutoring_type_pref,   pp.tutoring_type_pref)   AS type_pref,
      COALESCE(sp.budget_max_per_hour,  pp.budget_max_per_hour)  AS budget,
      (SELECT count(*) FROM user_category_interests WHERE profile_id = p.id) AS interest_count,
      (SELECT count(*) FROM seeker_availability     WHERE profile_id = p.id) AS slot_count
    FROM profiles p
    LEFT JOIN student_profiles sp ON sp.id = p.id
    LEFT JOIN parent_profiles  pp ON pp.id = p.id
    WHERE p.id = auth.uid()
  ),
  -- Published tutors + their profile attributes
  cand AS (
    SELECT
      tp.id                AS tutor_id,
      tp.tutoring_format,
      tp.tutoring_type,
      pr.district          AS tutor_district,
      pr.preferred_language AS tutor_lang
    FROM tutor_profiles tp
    JOIN profiles pr ON pr.id = tp.id
    WHERE tp.is_published = true
  ),
  -- Lowest advertised rate per tutor (for budget compatibility)
  tutor_rate AS (
    SELECT tutor_id, MIN(hourly_rate_min) AS min_rate
    FROM tutor_subcategories
    GROUP BY tutor_id
  ),
  -- # of the seeker's interested subcategories each tutor covers
  cat_overlap AS (
    SELECT ts.tutor_id, COUNT(DISTINCT ts.subcategory_id) AS matched
    FROM tutor_subcategories ts
    JOIN user_category_interests si
      ON si.subcategory_id = ts.subcategory_id
     AND si.profile_id = auth.uid()
    GROUP BY ts.tutor_id
  ),
  -- # of (day, slot) pairs each tutor shares with the seeker
  avail_overlap AS (
    SELECT ta.tutor_id, COUNT(*) AS matched
    FROM tutor_availability ta
    JOIN seeker_availability ss
      ON ss.day_of_week = ta.day_of_week
     AND ss.time_slot   = ta.time_slot
     AND ss.profile_id  = auth.uid()
    GROUP BY ta.tutor_id
  ),
  -- Per-dimension applicability flags + raw [0,1] scores
  scored AS (
    SELECT
      c.tutor_id,

      -- Category
      (s.interest_count > 0) AS cat_app,
      CASE WHEN s.interest_count > 0
        THEN COALESCE(co.matched, 0)::numeric / s.interest_count
        ELSE 0 END AS cat_score,

      -- Availability
      (s.slot_count > 0) AS avail_app,
      CASE WHEN s.slot_count > 0
        THEN COALESCE(ao.matched, 0)::numeric / s.slot_count
        ELSE 0 END AS avail_score,

      -- District (dropped for online-only tutors, or if seeker has no district)
      (s.seeker_district IS NOT NULL
        AND c.tutoring_format IS DISTINCT FROM 'online'::tutoring_format) AS dist_app,
      CASE WHEN c.tutor_district = s.seeker_district THEN 1 ELSE 0 END AS dist_score,

      -- Language
      (s.seeker_lang IS NOT NULL AND c.tutor_lang IS NOT NULL) AS lang_app,
      CASE WHEN c.tutor_lang = s.seeker_lang THEN 1 ELSE 0 END AS lang_score,

      -- Format / type / budget composite — count of applicable sub-signals (n)
      -- and how many of those are satisfied (k). 'both' on either side is
      -- always compatible for format/type.
      ( (s.fmt_pref  IS NOT NULL)::int
      + (s.type_pref IS NOT NULL)::int
      + (s.budget IS NOT NULL AND tr.min_rate IS NOT NULL)::int ) AS ftb_n,
      -- COALESCE guards a NULL tutor enum (unset format/type) from nulling the sum
      ( COALESCE(s.fmt_pref IS NOT NULL AND
          (s.fmt_pref = 'both' OR c.tutoring_format = 'both' OR s.fmt_pref = c.tutoring_format), false)::int
      + COALESCE(s.type_pref IS NOT NULL AND
          (s.type_pref = 'both' OR c.tutoring_type = 'both' OR s.type_pref = c.tutoring_type), false)::int
      + (s.budget IS NOT NULL AND tr.min_rate IS NOT NULL AND tr.min_rate <= s.budget)::int ) AS ftb_k

    FROM cand c
    CROSS JOIN seeker s
    LEFT JOIN cat_overlap   co ON co.tutor_id = c.tutor_id
    LEFT JOIN avail_overlap ao ON ao.tutor_id = c.tutor_id
    LEFT JOIN tutor_rate    tr ON tr.tutor_id = c.tutor_id
  ),
  weighted AS (
    SELECT
      tutor_id,
      -- numerator: applicable weighted scores
      ( 40 * cat_app::int   * cat_score
      + 15 * avail_app::int * avail_score
      + 15 * dist_app::int  * dist_score
      + 15 * lang_app::int  * lang_score
      -- COALESCE(...,0) avoids 0 * NULL when no ftb sub-signal applies
      + 15 * COALESCE(ftb_k::numeric / NULLIF(ftb_n, 0), 0) ) AS num,
      -- denominator: weights of applicable dimensions only (renormalization)
      ( 40 * cat_app::int
      + 15 * avail_app::int
      + 15 * dist_app::int
      + 15 * lang_app::int
      + 15 * (ftb_n > 0)::int ) AS den
    FROM scored
  )
  SELECT
    tutor_id,
    ROUND(100 * num / NULLIF(den, 0), 2) AS score,
    count(*) OVER () AS total_count
  FROM weighted
  ORDER BY score DESC NULLS LAST, tutor_id
  LIMIT  GREATEST(p_page_size, 1)
  OFFSET GREATEST(p_page - 1, 0) * GREATEST(p_page_size, 1);
$$;

-- Only authenticated seekers run matching; auth.uid() is NULL for anon.
GRANT EXECUTE ON FUNCTION match_tutors_for_seeker(integer, integer) TO authenticated;
