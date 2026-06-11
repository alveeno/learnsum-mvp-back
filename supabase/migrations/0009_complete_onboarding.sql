-- LearnSum MVP — One-shot onboarding writer (Option A)
-- Migration: 0009_complete_onboarding.sql
-- Reference: plan.md §9 (onboarding), §5 (POST /api/onboarding).
-- Note: local record of objects applied manually via the Supabase SQL editor.
--       Run AFTER 0005–0008. Paste and run the WHOLE file.
--
-- complete_onboarding(p_payload) persists a freshly-signed-up user's onboarding
-- data atomically — a Postgres function runs in a single transaction, so it is
-- all-or-nothing: any failure rolls the whole signup back, leaving a clean slate.
--
-- SECURITY INVOKER (the default): RLS still applies with the caller's auth.uid(),
-- so the function can only write the caller's OWN rows. The endpoint
-- (/api/onboarding) does all slug→id / label→enum mapping and passes an already-
-- RESOLVED payload — this function does inserts only, no mapping.
--
-- Resolved payload shape (only the section matching the caller's role is read):
--   { "profile": { display_name?, full_name?, age?, gender? },
--     "student": { school_level, tutoring_format_pref, tutoring_type_pref,
--                  budget_max_per_hour, preferred_language?, district?,
--                  interest_subcategory_ids: [uuid], availability: {day:[{start,end}]} },
--     "parent":  { searching_for_self, children: [ { name, school_level,
--                  tutoring_format_pref, tutoring_type_pref, budget_max_per_hour,
--                  preferred_languages: [text], preferred_districts: [text],
--                  interest_subcategory_ids: [uuid], availability: {...} } ] },
--     "tutor":   { slug, university, tutoring_format, tutoring_type,
--                  subjects: [ { subcategory_id, years_experience, hourly_rate_min,
--                  hourly_rate_max, achievements, qualifications, exam_results } ],
--                  availability: {...} } }

CREATE OR REPLACE FUNCTION complete_onboarding(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
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
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING errcode = 'P0001';
  END IF;

  SELECT role, onboarding_done INTO v_role, v_done FROM profiles WHERE id = v_uid;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'profile not found' USING errcode = 'P0002';
  END IF;
  IF v_done THEN
    RAISE EXCEPTION 'onboarding already completed' USING errcode = 'P0003';
  END IF;

  -- Optional shared profile fields
  IF v_prof IS NOT NULL THEN
    UPDATE profiles SET
      display_name = COALESCE(v_prof ->> 'display_name', display_name),
      full_name    = COALESCE(v_prof ->> 'full_name', full_name),
      age          = COALESCE((v_prof ->> 'age')::int, age),
      gender       = COALESCE((v_prof ->> 'gender')::gender_type, gender)
    WHERE id = v_uid;
  END IF;

  -- ===================== STUDENT =====================
  IF v_role = 'student' AND v_s IS NOT NULL THEN
    INSERT INTO student_profiles (id, school_level, tutoring_format_pref, tutoring_type_pref, budget_max_per_hour)
    VALUES (v_uid,
            (v_s ->> 'school_level')::school_level,
            (v_s ->> 'tutoring_format_pref')::tutoring_format,
            (v_s ->> 'tutoring_type_pref')::tutoring_type,
            (v_s ->> 'budget_max_per_hour')::int)
    ON CONFLICT (id) DO UPDATE SET
      school_level = EXCLUDED.school_level,
      tutoring_format_pref = EXCLUDED.tutoring_format_pref,
      tutoring_type_pref = EXCLUDED.tutoring_type_pref,
      budget_max_per_hour = EXCLUDED.budget_max_per_hour;

    -- primary language/district go into the existing single profiles columns for now
    UPDATE profiles SET
      preferred_language = COALESCE((v_s ->> 'preferred_language')::preferred_language, preferred_language),
      district           = COALESCE((v_s ->> 'district')::hk_district, district)
    WHERE id = v_uid;

    INSERT INTO user_category_interests (profile_id, subcategory_id)
    SELECT v_uid, x::uuid
    FROM jsonb_array_elements_text(COALESCE(v_s -> 'interest_subcategory_ids', '[]'::jsonb)) AS x
    ON CONFLICT (profile_id, subcategory_id) DO NOTHING;

    INSERT INTO seeker_availability (owner_id, owner_type, day_of_week, start_min, end_min)
    SELECT v_uid, 'student'::seeker_owner_type, d.key::day_of_week,
           (r.value ->> 'start')::int, (r.value ->> 'end')::int
    FROM jsonb_each(COALESCE(v_s -> 'availability', '{}'::jsonb)) AS d(key, value),
         jsonb_array_elements(d.value) AS r(value)
    ON CONFLICT (owner_id, owner_type, day_of_week, start_min, end_min) DO NOTHING;

  -- ===================== PARENT =====================
  ELSIF v_role = 'parent' AND v_p IS NOT NULL THEN
    INSERT INTO parent_profiles (id, searching_for_self)
    VALUES (v_uid, COALESCE((v_p ->> 'searching_for_self')::boolean, false))
    ON CONFLICT (id) DO UPDATE SET searching_for_self = EXCLUDED.searching_for_self;

    FOR v_child IN SELECT jsonb_array_elements(COALESCE(v_p -> 'children', '[]'::jsonb))
    LOOP
      INSERT INTO child_profiles (parent_id, name, school_level, tutoring_format_pref,
                                  tutoring_type_pref, budget_max_per_hour,
                                  preferred_languages, preferred_districts)
      VALUES (v_uid,
              v_child ->> 'name',
              (v_child ->> 'school_level')::school_level,
              (v_child ->> 'tutoring_format_pref')::tutoring_format,
              (v_child ->> 'tutoring_type_pref')::tutoring_type,
              (v_child ->> 'budget_max_per_hour')::int,
              ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_child -> 'preferred_languages', '[]'::jsonb))),
              ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_child -> 'preferred_districts', '[]'::jsonb))))
      RETURNING id INTO v_cid;

      INSERT INTO child_category_interests (child_id, subcategory_id)
      SELECT v_cid, x::uuid
      FROM jsonb_array_elements_text(COALESCE(v_child -> 'interest_subcategory_ids', '[]'::jsonb)) AS x
      ON CONFLICT (child_id, subcategory_id) DO NOTHING;

      INSERT INTO seeker_availability (owner_id, owner_type, day_of_week, start_min, end_min)
      SELECT v_cid, 'child'::seeker_owner_type, d.key::day_of_week,
             (r.value ->> 'start')::int, (r.value ->> 'end')::int
      FROM jsonb_each(COALESCE(v_child -> 'availability', '{}'::jsonb)) AS d(key, value),
           jsonb_array_elements(d.value) AS r(value)
      ON CONFLICT (owner_id, owner_type, day_of_week, start_min, end_min) DO NOTHING;
    END LOOP;

  -- ===================== TUTOR =====================
  ELSIF v_role = 'tutor' AND v_t IS NOT NULL THEN
    INSERT INTO tutor_profiles (id, slug, university, tutoring_format, tutoring_type, is_published)
    VALUES (v_uid,
            v_t ->> 'slug',
            v_t ->> 'university',
            (v_t ->> 'tutoring_format')::tutoring_format,
            (v_t ->> 'tutoring_type')::tutoring_type,
            false)   -- tutors always land unpublished; they publish later
    ON CONFLICT (id) DO UPDATE SET
      slug = EXCLUDED.slug,
      university = EXCLUDED.university,
      tutoring_format = EXCLUDED.tutoring_format,
      tutoring_type = EXCLUDED.tutoring_type;

    FOR v_sub IN SELECT jsonb_array_elements(COALESCE(v_t -> 'subjects', '[]'::jsonb))
    LOOP
      INSERT INTO tutor_subcategories (tutor_id, subcategory_id, years_experience,
                                       hourly_rate_min, hourly_rate_max,
                                       achievements, qualifications, exam_results)
      VALUES (v_uid,
              (v_sub ->> 'subcategory_id')::uuid,
              (v_sub ->> 'years_experience')::int,
              (v_sub ->> 'hourly_rate_min')::int,
              (v_sub ->> 'hourly_rate_max')::int,
              v_sub -> 'achievements',
              v_sub -> 'qualifications',
              v_sub -> 'exam_results');
    END LOOP;

    INSERT INTO tutor_availability (tutor_id, day_of_week, start_min, end_min)
    SELECT v_uid, d.key::day_of_week, (r.value ->> 'start')::int, (r.value ->> 'end')::int
    FROM jsonb_each(COALESCE(v_t -> 'availability', '{}'::jsonb)) AS d(key, value),
         jsonb_array_elements(d.value) AS r(value)
    ON CONFLICT (tutor_id, day_of_week, start_min, end_min) DO NOTHING;
  END IF;

  UPDATE profiles SET onboarding_done = true, updated_at = now() WHERE id = v_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION complete_onboarding(jsonb) TO authenticated;
