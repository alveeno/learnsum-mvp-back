-- LearnSum MVP — Language refinement (multi-language model)
-- Migration: 0010_language_refinement.sql
-- Reference: plan.md §4.1 / §4.2a, CLAUDE.md (tutor_languages, expanded language set).
-- Note: local record of objects applied manually via the Supabase SQL editor.
--       Run AFTER 0005–0009. Paste and run the WHOLE file.
--
-- Completes the language/district data model so it is consistent across roles:
--   • student_profiles gains preferred_languages / preferred_districts text[]
--     (matching children, which already had them).
--   • NEW tutor_languages(tutor_id, language, proficiency 1..4) — a tutor can list
--     multiple teaching languages. proficiency is DISPLAY-ONLY (not used in matching;
--     matching just needs "does the tutor share a language").
--   • match_tutors_for_seeker is updated to read these (set-overlap on language;
--     student districts from the new list), falling back to the old single
--     profiles columns for rows created before this migration.
--   • complete_onboarding is updated to write the student lists + tutor_languages.
--
-- The old single profiles.preferred_language stays (now vestigial for matching) —
-- left in place to avoid a destructive enum drop; profiles.district is still the
-- tutor's home district used for district matching.

-- ===========================================================================
-- 1. Schema: student lists + tutor_languages
-- ===========================================================================
ALTER TABLE student_profiles
  ADD COLUMN IF NOT EXISTS preferred_languages text[],
  ADD COLUMN IF NOT EXISTS preferred_districts text[];

CREATE TABLE IF NOT EXISTS tutor_languages (
  id          uuid    NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4(),
  tutor_id    uuid    NOT NULL REFERENCES tutor_profiles ON DELETE CASCADE,
  language    text    NOT NULL,
  proficiency integer,  -- 1..4 (Beginner..Fluent); display only
  CONSTRAINT tutor_languages_prof_chk CHECK (proficiency IS NULL OR proficiency BETWEEN 1 AND 4),
  UNIQUE (tutor_id, language)
);
CREATE INDEX IF NOT EXISTS idx_tutor_languages_tutor ON tutor_languages (tutor_id);

ALTER TABLE tutor_languages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tutor_languages: public read"   ON tutor_languages;
DROP POLICY IF EXISTS "tutor_languages: owner insert"  ON tutor_languages;
DROP POLICY IF EXISTS "tutor_languages: owner update"  ON tutor_languages;
DROP POLICY IF EXISTS "tutor_languages: owner delete"  ON tutor_languages;

CREATE POLICY "tutor_languages: public read"  ON tutor_languages FOR SELECT USING (true);
CREATE POLICY "tutor_languages: owner insert" ON tutor_languages FOR INSERT WITH CHECK (auth.uid() = tutor_id);
CREATE POLICY "tutor_languages: owner update" ON tutor_languages FOR UPDATE USING (auth.uid() = tutor_id);
CREATE POLICY "tutor_languages: owner delete" ON tutor_languages FOR DELETE USING (auth.uid() = tutor_id);

-- ===========================================================================
-- 2. match_tutors_for_seeker — use the multi-language model (see 0008 for the
--    full scoring rationale; only the language/district SOURCES change here).
-- ===========================================================================
CREATE OR REPLACE FUNCTION match_tutors_for_seeker(
  p_child_id  uuid    DEFAULT NULL,
  p_page      integer DEFAULT 1,
  p_page_size integer DEFAULT 20
)
RETURNS TABLE (tutor_id uuid, score numeric, total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH
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
      -- preferred languages: student → student_profiles list (fallback to single), child → its list
      CASE WHEN p_child_id IS NULL
           THEN COALESCE(
                  NULLIF((SELECT preferred_languages FROM student_profiles WHERE id = auth.uid()), '{}'),
                  (SELECT CASE WHEN preferred_language IS NULL THEN '{}'::text[] ELSE ARRAY[preferred_language::text] END FROM profiles WHERE id = auth.uid()),
                  '{}'::text[])
           ELSE (SELECT COALESCE(preferred_languages, '{}'::text[]) FROM child_profiles WHERE id = p_child_id AND parent_id = auth.uid())
      END AS pref_langs,
      -- preferred districts: student → student_profiles list (fallback to single), child → its list
      CASE WHEN p_child_id IS NULL
           THEN COALESCE(
                  NULLIF((SELECT preferred_districts FROM student_profiles WHERE id = auth.uid()), '{}'),
                  (SELECT CASE WHEN district IS NULL THEN '{}'::text[] ELSE ARRAY[district::text] END FROM profiles WHERE id = auth.uid()),
                  '{}'::text[])
           ELSE (SELECT COALESCE(preferred_districts, '{}'::text[]) FROM child_profiles WHERE id = p_child_id AND parent_id = auth.uid())
      END AS pref_districts
  ),
  seeker_interests AS (
    SELECT subcategory_id FROM user_category_interests
      WHERE p_child_id IS NULL AND profile_id = auth.uid()
    UNION
    SELECT cci.subcategory_id FROM child_category_interests cci
      JOIN child_profiles cp ON cp.id = cci.child_id AND cp.parent_id = auth.uid()
      WHERE p_child_id IS NOT NULL AND cci.child_id = p_child_id
  ),
  seeker_avail AS (
    SELECT sa.day_of_week, sa.start_min, sa.end_min
    FROM seeker_availability sa, seeker s
    WHERE s.owner_id IS NOT NULL AND sa.owner_id = s.owner_id AND sa.owner_type = s.owner_type
  ),
  seeker_stats AS (
    SELECT (SELECT count(*) FROM seeker_interests) AS interest_count,
           (SELECT COALESCE(sum(end_min - start_min), 0) FROM seeker_avail) AS avail_total_min
  ),
  cand AS (
    SELECT tp.id AS tutor_id, tp.tutoring_format, tp.tutoring_type, pr.district AS tutor_district
    FROM tutor_profiles tp JOIN profiles pr ON pr.id = tp.id
    WHERE tp.is_published = true
  ),
  tutor_lang_set AS (
    SELECT tutor_id, array_agg(language) AS langs FROM tutor_languages GROUP BY tutor_id
  ),
  tutor_rate AS (
    SELECT tutor_id, MIN(hourly_rate_min) AS min_rate FROM tutor_subcategories GROUP BY tutor_id
  ),
  cat_overlap AS (
    SELECT ts.tutor_id, COUNT(DISTINCT ts.subcategory_id) AS matched
    FROM tutor_subcategories ts JOIN seeker_interests si ON si.subcategory_id = ts.subcategory_id
    GROUP BY ts.tutor_id
  ),
  avail_overlap AS (
    SELECT ta.tutor_id,
           SUM(GREATEST(0, LEAST(ta.end_min, sa.end_min) - GREATEST(ta.start_min, sa.start_min))) AS overlap_min
    FROM tutor_availability ta JOIN seeker_avail sa ON sa.day_of_week = ta.day_of_week
    GROUP BY ta.tutor_id
  ),
  scored AS (
    SELECT
      c.tutor_id,
      (st.interest_count > 0) AS cat_app,
      CASE WHEN st.interest_count > 0 THEN COALESCE(co.matched, 0)::numeric / st.interest_count ELSE 0 END AS cat_score,
      (st.avail_total_min > 0) AS avail_app,
      CASE WHEN st.avail_total_min > 0 THEN LEAST(1, COALESCE(ao.overlap_min, 0)::numeric / st.avail_total_min) ELSE 0 END AS avail_score,
      (s.budget IS NOT NULL AND tr.min_rate IS NOT NULL) AS price_app,
      CASE WHEN s.budget IS NOT NULL AND tr.min_rate IS NOT NULL THEN
        CASE WHEN tr.min_rate <= s.budget THEN 1
             ELSE GREATEST(0, 1 - (tr.min_rate - s.budget)::numeric / NULLIF(s.budget, 0)) END
        ELSE 0 END AS price_score,
      -- Language: overlap between seeker's preferred languages and the tutor's languages
      (array_length(s.pref_langs, 1) IS NOT NULL AND tls.langs IS NOT NULL) AS lang_app,
      CASE WHEN s.pref_langs && tls.langs THEN 1 ELSE 0 END AS lang_score,
      -- District: tutor's home district within the seeker's list (dropped for online-only)
      (array_length(s.pref_districts, 1) IS NOT NULL AND c.tutor_district IS NOT NULL
        AND c.tutoring_format IS DISTINCT FROM 'online'::tutoring_format) AS dist_app,
      CASE WHEN c.tutor_district::text = ANY (s.pref_districts) THEN 1 ELSE 0 END AS dist_score,
      ( (s.fmt_pref IS NOT NULL)::int + (s.type_pref IS NOT NULL)::int ) AS ft_n,
      ( COALESCE(s.fmt_pref IS NOT NULL AND
          (s.fmt_pref = 'both' OR c.tutoring_format = 'both' OR s.fmt_pref = c.tutoring_format), false)::int
      + COALESCE(s.type_pref IS NOT NULL AND
          (s.type_pref = 'both' OR c.tutoring_type = 'both' OR s.type_pref = c.tutoring_type), false)::int ) AS ft_k
    FROM cand c
    CROSS JOIN seeker s
    CROSS JOIN seeker_stats st
    LEFT JOIN cat_overlap    co  ON co.tutor_id  = c.tutor_id
    LEFT JOIN avail_overlap  ao  ON ao.tutor_id  = c.tutor_id
    LEFT JOIN tutor_rate     tr  ON tr.tutor_id  = c.tutor_id
    LEFT JOIN tutor_lang_set tls ON tls.tutor_id = c.tutor_id
  ),
  weighted AS (
    SELECT tutor_id,
      ( 40 * cat_app::int   * cat_score
      + 25 * avail_app::int * avail_score
      + 15 * price_app::int * price_score
      + 10 * lang_app::int  * lang_score
      +  7 * dist_app::int  * dist_score
      +  3 * COALESCE(ft_k::numeric / NULLIF(ft_n, 0), 0) ) AS num,
      ( 40 * cat_app::int + 25 * avail_app::int + 15 * price_app::int
      + 10 * lang_app::int + 7 * dist_app::int + 3 * (ft_n > 0)::int ) AS den
    FROM scored
  )
  SELECT tutor_id, ROUND(100 * num / NULLIF(den, 0), 2) AS score, count(*) OVER () AS total_count
  FROM weighted
  ORDER BY score DESC NULLS LAST, tutor_id
  LIMIT GREATEST(p_page_size, 1) OFFSET GREATEST(p_page - 1, 0) * GREATEST(p_page_size, 1);
$$;

GRANT EXECUTE ON FUNCTION match_tutors_for_seeker(uuid, integer, integer) TO authenticated;

-- ===========================================================================
-- 3. complete_onboarding — write student language/district LISTS + tutor_languages.
--    (Only the student + tutor branches change vs 0009.)
-- ===========================================================================
CREATE OR REPLACE FUNCTION complete_onboarding(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_role  user_role;
  v_done  boolean;
  v_prof  jsonb := p_payload -> 'profile';
  v_s     jsonb := p_payload -> 'student';
  v_p     jsonb := p_payload -> 'parent';
  v_t     jsonb := p_payload -> 'tutor';
  v_child jsonb;
  v_cid   uuid;
  v_sub   jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING errcode = 'P0001'; END IF;
  SELECT role, onboarding_done INTO v_role, v_done FROM profiles WHERE id = v_uid;
  IF v_role IS NULL THEN RAISE EXCEPTION 'profile not found' USING errcode = 'P0002'; END IF;
  IF v_done THEN RAISE EXCEPTION 'onboarding already completed' USING errcode = 'P0003'; END IF;

  IF v_prof IS NOT NULL THEN
    UPDATE profiles SET
      display_name = COALESCE(v_prof ->> 'display_name', display_name),
      full_name    = COALESCE(v_prof ->> 'full_name', full_name),
      age          = COALESCE((v_prof ->> 'age')::int, age),
      gender       = COALESCE((v_prof ->> 'gender')::gender_type, gender)
    WHERE id = v_uid;
  END IF;

  IF v_role = 'student' AND v_s IS NOT NULL THEN
    INSERT INTO student_profiles (id, school_level, tutoring_format_pref, tutoring_type_pref,
                                  budget_max_per_hour, preferred_languages, preferred_districts)
    VALUES (v_uid,
            (v_s ->> 'school_level')::school_level,
            (v_s ->> 'tutoring_format_pref')::tutoring_format,
            (v_s ->> 'tutoring_type_pref')::tutoring_type,
            (v_s ->> 'budget_max_per_hour')::int,
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_s -> 'preferred_languages', '[]'::jsonb))),
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_s -> 'preferred_districts', '[]'::jsonb))))
    ON CONFLICT (id) DO UPDATE SET
      school_level = EXCLUDED.school_level,
      tutoring_format_pref = EXCLUDED.tutoring_format_pref,
      tutoring_type_pref = EXCLUDED.tutoring_type_pref,
      budget_max_per_hour = EXCLUDED.budget_max_per_hour,
      preferred_languages = EXCLUDED.preferred_languages,
      preferred_districts = EXCLUDED.preferred_districts;

    INSERT INTO user_category_interests (profile_id, subcategory_id)
    SELECT v_uid, x::uuid FROM jsonb_array_elements_text(COALESCE(v_s -> 'interest_subcategory_ids', '[]'::jsonb)) AS x
    ON CONFLICT (profile_id, subcategory_id) DO NOTHING;

    INSERT INTO seeker_availability (owner_id, owner_type, day_of_week, start_min, end_min)
    SELECT v_uid, 'student'::seeker_owner_type, d.key::day_of_week, (r.value ->> 'start')::int, (r.value ->> 'end')::int
    FROM jsonb_each(COALESCE(v_s -> 'availability', '{}'::jsonb)) AS d(key, value), jsonb_array_elements(d.value) AS r(value)
    ON CONFLICT (owner_id, owner_type, day_of_week, start_min, end_min) DO NOTHING;

  ELSIF v_role = 'parent' AND v_p IS NOT NULL THEN
    INSERT INTO parent_profiles (id, searching_for_self)
    VALUES (v_uid, COALESCE((v_p ->> 'searching_for_self')::boolean, false))
    ON CONFLICT (id) DO UPDATE SET searching_for_self = EXCLUDED.searching_for_self;

    FOR v_child IN SELECT jsonb_array_elements(COALESCE(v_p -> 'children', '[]'::jsonb))
    LOOP
      INSERT INTO child_profiles (parent_id, name, school_level, tutoring_format_pref, tutoring_type_pref,
                                  budget_max_per_hour, preferred_languages, preferred_districts)
      VALUES (v_uid, v_child ->> 'name', (v_child ->> 'school_level')::school_level,
              (v_child ->> 'tutoring_format_pref')::tutoring_format, (v_child ->> 'tutoring_type_pref')::tutoring_type,
              (v_child ->> 'budget_max_per_hour')::int,
              ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_child -> 'preferred_languages', '[]'::jsonb))),
              ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_child -> 'preferred_districts', '[]'::jsonb))))
      RETURNING id INTO v_cid;

      INSERT INTO child_category_interests (child_id, subcategory_id)
      SELECT v_cid, x::uuid FROM jsonb_array_elements_text(COALESCE(v_child -> 'interest_subcategory_ids', '[]'::jsonb)) AS x
      ON CONFLICT (child_id, subcategory_id) DO NOTHING;

      INSERT INTO seeker_availability (owner_id, owner_type, day_of_week, start_min, end_min)
      SELECT v_cid, 'child'::seeker_owner_type, d.key::day_of_week, (r.value ->> 'start')::int, (r.value ->> 'end')::int
      FROM jsonb_each(COALESCE(v_child -> 'availability', '{}'::jsonb)) AS d(key, value), jsonb_array_elements(d.value) AS r(value)
      ON CONFLICT (owner_id, owner_type, day_of_week, start_min, end_min) DO NOTHING;
    END LOOP;

  ELSIF v_role = 'tutor' AND v_t IS NOT NULL THEN
    INSERT INTO tutor_profiles (id, slug, university, tutoring_format, tutoring_type, is_published)
    VALUES (v_uid, v_t ->> 'slug', v_t ->> 'university',
            (v_t ->> 'tutoring_format')::tutoring_format, (v_t ->> 'tutoring_type')::tutoring_type, false)
    ON CONFLICT (id) DO UPDATE SET
      slug = EXCLUDED.slug, university = EXCLUDED.university,
      tutoring_format = EXCLUDED.tutoring_format, tutoring_type = EXCLUDED.tutoring_type;

    FOR v_sub IN SELECT jsonb_array_elements(COALESCE(v_t -> 'subjects', '[]'::jsonb))
    LOOP
      INSERT INTO tutor_subcategories (tutor_id, subcategory_id, years_experience, hourly_rate_min,
                                       hourly_rate_max, achievements, qualifications, exam_results)
      VALUES (v_uid, (v_sub ->> 'subcategory_id')::uuid, (v_sub ->> 'years_experience')::int,
              (v_sub ->> 'hourly_rate_min')::int, (v_sub ->> 'hourly_rate_max')::int,
              v_sub -> 'achievements', v_sub -> 'qualifications', v_sub -> 'exam_results');
    END LOOP;

    INSERT INTO tutor_languages (tutor_id, language, proficiency)
    SELECT v_uid, (l ->> 'language'), (l ->> 'proficiency')::int
    FROM jsonb_array_elements(COALESCE(v_t -> 'languages', '[]'::jsonb)) AS l
    WHERE COALESCE(l ->> 'language', '') <> ''
    ON CONFLICT (tutor_id, language) DO UPDATE SET proficiency = EXCLUDED.proficiency;

    INSERT INTO tutor_availability (tutor_id, day_of_week, start_min, end_min)
    SELECT v_uid, d.key::day_of_week, (r.value ->> 'start')::int, (r.value ->> 'end')::int
    FROM jsonb_each(COALESCE(v_t -> 'availability', '{}'::jsonb)) AS d(key, value), jsonb_array_elements(d.value) AS r(value)
    ON CONFLICT (tutor_id, day_of_week, start_min, end_min) DO NOTHING;
  END IF;

  UPDATE profiles SET onboarding_done = true, updated_at = now() WHERE id = v_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION complete_onboarding(jsonb) TO authenticated;
