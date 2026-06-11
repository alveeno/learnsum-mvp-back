-- LearnSum MVP — Reworked matching RPC (precise overlap, price, per-child)
-- Migration: 0008_matching_rpc_rework.sql
-- Reference: plan.md §6 (matching), CLAUDE.md (two-sided matching).
-- Note: local record of objects applied manually via the Supabase SQL editor.
--       Run AFTER 0005–0007. Paste and run the WHOLE file.
--
-- match_tutors_for_seeker(p_child_id, p_page, p_page_size) ranks every published
-- tutor for the calling seeker. SECURITY DEFINER so it can read seeker + tutor
-- preference rows regardless of RLS; the caller is identified via auth.uid()
-- (never a spoofable argument), and a child is only matchable by its own parent.
--
--   p_child_id NULL  → match the calling STUDENT (auth.uid()).
--   p_child_id set   → match that CHILD, but only if auth.uid() is its parent;
--                      otherwise the seeker resolves to no data and the caller
--                      simply gets a generic (unranked) tutor list.
--
-- Scoring: each dimension normalized to [0,1], then a weighted average over only
-- the APPLICABLE dimensions (a dimension with no data on either side is dropped
-- and the remaining weights renormalize — missing data never zeroes a tutor out,
-- and the feed is never empty). Final score scaled to [0,100].
--
--   Weights (operator-tunable — the integer literals below, in plan §6 order):
--     Subject / category .......... 40   matched interests / seeker's interests
--     Availability (time overlap) . 25   overlapping minutes / seeker's minutes
--     Price ....................... 15   1 within budget; partial when slightly over
--     Preferred language .......... 10   1 if a shared language
--     District .................... 7    1 if same; dropped for online-only tutors
--     Format / type (tie-breaker) . 3    soft format+type compatibility
--
-- Language/district use whatever data exists today (children carry lists; tutors
-- and students carry a single value) and degrade gracefully — they will pick up
-- the richer tutor_languages model automatically once that migration lands.

CREATE OR REPLACE FUNCTION match_tutors_for_seeker(
  p_child_id  uuid    DEFAULT NULL,
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
  -- Seeker scalars (guarded). owner_id is NULL unless the caller legitimately
  -- owns the seeker, so an unauthorized child_id yields no seeker data.
  seeker AS (
    SELECT
      CASE WHEN p_child_id IS NULL THEN auth.uid()
           ELSE (SELECT id FROM child_profiles WHERE id = p_child_id AND parent_id = auth.uid())
      END AS owner_id,
      (CASE WHEN p_child_id IS NULL THEN 'student' ELSE 'child' END)::seeker_owner_type AS owner_type,
      CASE WHEN p_child_id IS NULL
           THEN (SELECT budget_max_per_hour FROM student_profiles WHERE id = auth.uid())
           ELSE (SELECT budget_max_per_hour FROM child_profiles WHERE id = p_child_id AND parent_id = auth.uid())
      END AS budget,
      CASE WHEN p_child_id IS NULL
           THEN (SELECT tutoring_format_pref FROM student_profiles WHERE id = auth.uid())
           ELSE (SELECT tutoring_format_pref FROM child_profiles WHERE id = p_child_id AND parent_id = auth.uid())
      END AS fmt_pref,
      CASE WHEN p_child_id IS NULL
           THEN (SELECT tutoring_type_pref FROM student_profiles WHERE id = auth.uid())
           ELSE (SELECT tutoring_type_pref FROM child_profiles WHERE id = p_child_id AND parent_id = auth.uid())
      END AS type_pref,
      -- preferred languages as text[]: student = single profiles.preferred_language; child = its list
      CASE WHEN p_child_id IS NULL
           THEN (SELECT CASE WHEN preferred_language IS NULL THEN '{}'::text[]
                             ELSE ARRAY[preferred_language::text] END
                 FROM profiles WHERE id = auth.uid())
           ELSE (SELECT COALESCE(preferred_languages, '{}'::text[])
                 FROM child_profiles WHERE id = p_child_id AND parent_id = auth.uid())
      END AS pref_langs,
      -- preferred districts as text[] (enum string values)
      CASE WHEN p_child_id IS NULL
           THEN (SELECT CASE WHEN district IS NULL THEN '{}'::text[]
                             ELSE ARRAY[district::text] END
                 FROM profiles WHERE id = auth.uid())
           ELSE (SELECT COALESCE(preferred_districts, '{}'::text[])
                 FROM child_profiles WHERE id = p_child_id AND parent_id = auth.uid())
      END AS pref_districts
  ),

  -- Seeker interested subcategories (student OR the resolved child).
  seeker_interests AS (
    SELECT subcategory_id FROM user_category_interests
      WHERE p_child_id IS NULL AND profile_id = auth.uid()
    UNION
    SELECT cci.subcategory_id FROM child_category_interests cci
      JOIN child_profiles cp ON cp.id = cci.child_id AND cp.parent_id = auth.uid()
      WHERE p_child_id IS NOT NULL AND cci.child_id = p_child_id
  ),

  -- Seeker availability ranges (resolved owner).
  seeker_avail AS (
    SELECT sa.day_of_week, sa.start_min, sa.end_min
    FROM seeker_availability sa, seeker s
    WHERE s.owner_id IS NOT NULL
      AND sa.owner_id = s.owner_id
      AND sa.owner_type = s.owner_type
  ),

  seeker_stats AS (
    SELECT
      (SELECT count(*) FROM seeker_interests)                          AS interest_count,
      (SELECT COALESCE(sum(end_min - start_min), 0) FROM seeker_avail) AS avail_total_min
  ),

  -- Published tutors + attributes.
  cand AS (
    SELECT tp.id AS tutor_id, tp.tutoring_format, tp.tutoring_type,
           pr.district AS tutor_district, pr.preferred_language AS tutor_lang
    FROM tutor_profiles tp
    JOIN profiles pr ON pr.id = tp.id
    WHERE tp.is_published = true
  ),
  tutor_rate AS (
    SELECT tutor_id, MIN(hourly_rate_min) AS min_rate
    FROM tutor_subcategories GROUP BY tutor_id
  ),
  -- # of the seeker's interested subcategories each tutor covers.
  cat_overlap AS (
    SELECT ts.tutor_id, COUNT(DISTINCT ts.subcategory_id) AS matched
    FROM tutor_subcategories ts
    JOIN seeker_interests si ON si.subcategory_id = ts.subcategory_id
    GROUP BY ts.tutor_id
  ),
  -- Real overlapping minutes per tutor (sum of per-day range intersections).
  avail_overlap AS (
    SELECT ta.tutor_id,
           SUM(GREATEST(0, LEAST(ta.end_min, sa.end_min) - GREATEST(ta.start_min, sa.start_min))) AS overlap_min
    FROM tutor_availability ta
    JOIN seeker_avail sa ON sa.day_of_week = ta.day_of_week
    GROUP BY ta.tutor_id
  ),

  -- Per-dimension applicability flags + raw [0,1] scores.
  scored AS (
    SELECT
      c.tutor_id,

      -- Category
      (st.interest_count > 0) AS cat_app,
      CASE WHEN st.interest_count > 0
        THEN COALESCE(co.matched, 0)::numeric / st.interest_count ELSE 0 END AS cat_score,

      -- Availability (real time-overlap, capped at 1)
      (st.avail_total_min > 0) AS avail_app,
      CASE WHEN st.avail_total_min > 0
        THEN LEAST(1, COALESCE(ao.overlap_min, 0)::numeric / st.avail_total_min) ELSE 0 END AS avail_score,

      -- Price (soft: full credit within budget; partial when slightly over)
      (s.budget IS NOT NULL AND tr.min_rate IS NOT NULL) AS price_app,
      CASE WHEN s.budget IS NOT NULL AND tr.min_rate IS NOT NULL THEN
        CASE WHEN tr.min_rate <= s.budget THEN 1
             ELSE GREATEST(0, 1 - (tr.min_rate - s.budget)::numeric / NULLIF(s.budget, 0)) END
        ELSE 0 END AS price_score,

      -- Language (shared preferred language)
      (array_length(s.pref_langs, 1) IS NOT NULL AND c.tutor_lang IS NOT NULL) AS lang_app,
      CASE WHEN c.tutor_lang::text = ANY (s.pref_langs) THEN 1 ELSE 0 END AS lang_score,

      -- District (dropped for online-only tutors)
      (array_length(s.pref_districts, 1) IS NOT NULL AND c.tutor_district IS NOT NULL
        AND c.tutoring_format IS DISTINCT FROM 'online'::tutoring_format) AS dist_app,
      CASE WHEN c.tutor_district::text = ANY (s.pref_districts) THEN 1 ELSE 0 END AS dist_score,

      -- Format / type tie-breaker — n applicable sub-signals, k satisfied.
      -- 'both' on either side is always compatible.
      ( (s.fmt_pref IS NOT NULL)::int + (s.type_pref IS NOT NULL)::int ) AS ft_n,
      ( COALESCE(s.fmt_pref IS NOT NULL AND
          (s.fmt_pref = 'both' OR c.tutoring_format = 'both' OR s.fmt_pref = c.tutoring_format), false)::int
      + COALESCE(s.type_pref IS NOT NULL AND
          (s.type_pref = 'both' OR c.tutoring_type = 'both' OR s.type_pref = c.tutoring_type), false)::int ) AS ft_k

    FROM cand c
    CROSS JOIN seeker s
    CROSS JOIN seeker_stats st
    LEFT JOIN cat_overlap   co ON co.tutor_id = c.tutor_id
    LEFT JOIN avail_overlap ao ON ao.tutor_id = c.tutor_id
    LEFT JOIN tutor_rate    tr ON tr.tutor_id = c.tutor_id
  ),

  weighted AS (
    SELECT
      tutor_id,
      -- numerator: applicable weighted scores
      ( 40 * cat_app::int   * cat_score
      + 25 * avail_app::int * avail_score
      + 15 * price_app::int * price_score
      + 10 * lang_app::int  * lang_score
      +  7 * dist_app::int  * dist_score
      +  3 * COALESCE(ft_k::numeric / NULLIF(ft_n, 0), 0) ) AS num,
      -- denominator: weights of applicable dimensions only (renormalization)
      ( 40 * cat_app::int
      + 25 * avail_app::int
      + 15 * price_app::int
      + 10 * lang_app::int
      +  7 * dist_app::int
      +  3 * (ft_n > 0)::int ) AS den
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
GRANT EXECUTE ON FUNCTION match_tutors_for_seeker(uuid, integer, integer) TO authenticated;
