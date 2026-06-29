-- LearnSum MVP — Child age
-- Migration: 0028_child_age.sql
-- Apply AFTER 0027. Paste and run the WHOLE file.
--
-- The parent onboarding (ParentNumChild) collects each child's age (optional).
-- The app already sends it (seekerOnboardingPayload.ts), but the backend had no
-- column and dropped it. Adds child_profiles.age and extends complete_onboarding
-- so the child INSERT writes it.
--
-- The function body below is the CURRENT (0023) definition VERBATIM apart from
-- the single `age` column added to the child INSERT — do NOT base it on an
-- older migration.

ALTER TABLE child_profiles
  ADD COLUMN IF NOT EXISTS age integer;

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

  -- Optional shared profile fields (incl. avatar_url / bio / phone)
  IF v_prof IS NOT NULL THEN
    UPDATE profiles SET
      display_name = COALESCE(v_prof ->> 'display_name', display_name),
      full_name    = COALESCE(v_prof ->> 'full_name', full_name),
      age          = COALESCE((v_prof ->> 'age')::int, age),
      gender       = COALESCE((v_prof ->> 'gender')::gender_type, gender),
      avatar_url   = COALESCE(v_prof ->> 'avatar_url', avatar_url),
      bio          = COALESCE(v_prof ->> 'bio', bio),
      phone        = COALESCE(v_prof ->> 'phone', phone)
    WHERE id = v_uid;
  END IF;

  IF v_role = 'student' AND v_s IS NOT NULL THEN
    INSERT INTO student_profiles (id, school_level, tutoring_format_pref, tutoring_type_pref,
                                  budget_max_per_hour, preferred_languages, preferred_districts, education)
    VALUES (v_uid,
            (v_s ->> 'school_level')::school_level,
            (v_s ->> 'tutoring_format_pref')::tutoring_format,
            (v_s ->> 'tutoring_type_pref')::tutoring_type,
            (v_s ->> 'budget_max_per_hour')::int,
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_s -> 'preferred_languages', '[]'::jsonb))),
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_s -> 'preferred_districts', '[]'::jsonb))),
            v_s -> 'education')
    ON CONFLICT (id) DO UPDATE SET
      school_level = EXCLUDED.school_level,
      tutoring_format_pref = EXCLUDED.tutoring_format_pref,
      tutoring_type_pref = EXCLUDED.tutoring_type_pref,
      budget_max_per_hour = EXCLUDED.budget_max_per_hour,
      preferred_languages = EXCLUDED.preferred_languages,
      preferred_districts = EXCLUDED.preferred_districts,
      education = EXCLUDED.education;

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
                                  budget_max_per_hour, preferred_languages, preferred_districts, age)
      VALUES (v_uid, v_child ->> 'name', (v_child ->> 'school_level')::school_level,
              (v_child ->> 'tutoring_format_pref')::tutoring_format, (v_child ->> 'tutoring_type_pref')::tutoring_type,
              (v_child ->> 'budget_max_per_hour')::int,
              ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_child -> 'preferred_languages', '[]'::jsonb))),
              ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_child -> 'preferred_districts', '[]'::jsonb))),
              (v_child ->> 'age')::int)
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
    INSERT INTO tutor_profiles (id, slug, university, tutoring_format, tutoring_type,
                                teaching_levels, education, current_studies, is_published)
    VALUES (v_uid, v_t ->> 'slug', v_t ->> 'university',
            (v_t ->> 'tutoring_format')::tutoring_format, (v_t ->> 'tutoring_type')::tutoring_type,
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_t -> 'teaching_levels', '[]'::jsonb)))::school_level[],
            v_t -> 'education',
            v_t -> 'current_studies',
            false)
    ON CONFLICT (id) DO UPDATE SET
      slug = EXCLUDED.slug, university = EXCLUDED.university,
      tutoring_format = EXCLUDED.tutoring_format, tutoring_type = EXCLUDED.tutoring_type,
      teaching_levels = EXCLUDED.teaching_levels,
      education = EXCLUDED.education,
      current_studies = EXCLUDED.current_studies;

    FOR v_sub IN SELECT jsonb_array_elements(COALESCE(v_t -> 'subjects', '[]'::jsonb))
    LOOP
      INSERT INTO tutor_subcategories (tutor_id, subcategory_id, years_experience, hourly_rate_min,
                                       hourly_rate_max, achievements, qualifications, exam_results, experience,
                                       format, districts, levels)
      VALUES (v_uid, (v_sub ->> 'subcategory_id')::uuid, (v_sub ->> 'years_experience')::int,
              (v_sub ->> 'hourly_rate_min')::int, (v_sub ->> 'hourly_rate_max')::int,
              v_sub -> 'achievements', v_sub -> 'qualifications', v_sub -> 'exam_results', v_sub -> 'experience',
              (v_sub ->> 'format')::tutoring_format,
              ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_sub -> 'districts', '[]'::jsonb))),
              ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_sub -> 'levels', '[]'::jsonb)))::school_level[]);
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
