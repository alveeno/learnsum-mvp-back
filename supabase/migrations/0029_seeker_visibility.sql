-- LearnSum MVP — Seeker visibility/privacy + the seeker reads tutors use
-- Migration: 0029_seeker_visibility.sql
-- Apply AFTER 0028. Paste and run the WHOLE file.
--
-- Two seeker (student/parent) privacy toggles, default ON, on `profiles`:
--   • is_discoverable     — appears in the new seeker search; visible to anyone.
--                           When OFF the seeker is only visible to a tutor they
--                           have MESSAGED (consent by action).
--   • share_personal_info — include name/age/education/school/phone. When OFF a
--                           tutor sees only a minimal card (subjects, no name);
--                           the phone is never shown.
--
-- Plus two SECURITY DEFINER reads (needed because child_profiles + the interest
-- tables are owner-only / minors):
--   • get_seeker_for_tutor(p_seeker_id) — one seeker's profile for a tutor, gated
--     by the rules above (the phone additionally requires a contact unlock).
--   • search_seekers(...)               — browse/search PUBLIC seekers as cards.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_discoverable     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS share_personal_info boolean NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- get_seeker_for_tutor(p_seeker_id) → the seeker JSON a tutor sees, or NULL if
-- they're not allowed to see it.
--   Visible when:  seeker is_discoverable  OR  the seeker has messaged this tutor.
--   PII (name/age/level/child) only when share_personal_info; phone additionally
--   requires a tutor_contact_unlocks row.
-- Shape matches the app's `Seeker` type (+ `share_info`, student `level`/`age`).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_seeker_for_tutor(p_seeker_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tutor    uuid := auth.uid();
  v_role     user_role;
  v_pub      boolean;
  v_share    boolean;
  v_unlocked boolean;
  v_messaged boolean;
  v_child    child_profiles%ROWTYPE;
  v_result   jsonb;
BEGIN
  IF v_tutor IS NULL THEN RAISE EXCEPTION 'not authenticated' USING errcode = 'P0001'; END IF;
  IF (SELECT role FROM profiles WHERE id = v_tutor) <> 'tutor' THEN
    RAISE EXCEPTION 'tutors only' USING errcode = 'P0001';
  END IF;

  SELECT role, is_discoverable, share_personal_info
    INTO v_role, v_pub, v_share
    FROM profiles WHERE id = p_seeker_id;
  IF v_role IS NULL OR v_role = 'tutor' THEN RETURN NULL; END IF;

  -- Has this seeker messaged this tutor? (consent by action)
  v_messaged := EXISTS (
    SELECT 1 FROM conversations c
      JOIN messages m ON m.conversation_id = c.id
     WHERE ((c.participant_a = v_tutor AND c.participant_b = p_seeker_id)
         OR (c.participant_a = p_seeker_id AND c.participant_b = v_tutor))
       AND m.sender_id = p_seeker_id
  );

  -- A private seeker is only visible to a tutor they've messaged.
  IF NOT v_pub AND NOT v_messaged THEN RETURN NULL; END IF;

  v_unlocked := EXISTS (
    SELECT 1 FROM tutor_contact_unlocks WHERE tutor_id = v_tutor AND seeker_id = p_seeker_id
  );

  IF v_role = 'student' THEN
    SELECT jsonb_build_object(
      'id', pr.id,
      'role', 'student',
      'name', CASE WHEN v_share
        THEN COALESCE(NULLIF(pr.display_name, ''), NULLIF(pr.full_name, ''), 'Student') ELSE 'Student' END,
      'avatar_url', CASE WHEN v_share THEN pr.avatar_url ELSE NULL END,
      'level', CASE WHEN v_share THEN sp.school_level ELSE NULL END,
      'age',   CASE WHEN v_share THEN pr.age ELSE NULL END,
      'child', NULL,
      'subjects', COALESCE(
        (SELECT jsonb_agg(sc.name_en ORDER BY sc.name_en)
           FROM user_category_interests uci
           JOIN subcategories sc ON sc.id = uci.subcategory_id
          WHERE uci.profile_id = pr.id), '[]'::jsonb),
      'format', sp.tutoring_format_pref,
      'districts', COALESCE(to_jsonb(sp.preferred_districts), '[]'::jsonb),
      'languages', COALESCE(to_jsonb(sp.preferred_languages), '[]'::jsonb),
      'availability_note', NULL,
      'share_info', v_share,
      'contact', jsonb_build_object(
        'phone',      CASE WHEN v_share AND v_unlocked THEN pr.phone ELSE NULL END,
        'whatsapp',   NULL,
        'wechat',     NULL,
        'account_id', pr.id
      )
    ) INTO v_result
    FROM profiles pr LEFT JOIN student_profiles sp ON sp.id = pr.id
    WHERE pr.id = p_seeker_id;
  ELSE
    SELECT * INTO v_child FROM child_profiles
      WHERE parent_id = p_seeker_id ORDER BY created_at ASC LIMIT 1;
    SELECT jsonb_build_object(
      'id', pr.id,
      'role', 'parent',
      'name', CASE WHEN v_share
        THEN COALESCE(NULLIF(pr.display_name, ''), NULLIF(pr.full_name, ''), 'Parent') ELSE 'Parent' END,
      'avatar_url', CASE WHEN v_share THEN pr.avatar_url ELSE NULL END,
      'level', NULL,
      'age', NULL,
      'child', CASE WHEN v_child.id IS NOT NULL THEN jsonb_build_object(
          'name',  CASE WHEN v_share THEN v_child.name ELSE 'Child' END,
          'level', CASE WHEN v_share THEN v_child.school_level ELSE NULL END,
          'age',   CASE WHEN v_share THEN v_child.age ELSE NULL END
        ) ELSE NULL END,
      'subjects', COALESCE(
        (SELECT jsonb_agg(sc.name_en ORDER BY sc.name_en)
           FROM child_category_interests cci
           JOIN subcategories sc ON sc.id = cci.subcategory_id
          WHERE cci.child_id = v_child.id), '[]'::jsonb),
      'format', v_child.tutoring_format_pref,
      'districts', COALESCE(to_jsonb(v_child.preferred_districts), '[]'::jsonb),
      'languages', COALESCE(to_jsonb(v_child.preferred_languages), '[]'::jsonb),
      'availability_note', NULL,
      'share_info', v_share,
      'contact', jsonb_build_object(
        'phone',      CASE WHEN v_share AND v_unlocked THEN pr.phone ELSE NULL END,
        'whatsapp',   NULL,
        'wechat',     NULL,
        'account_id', pr.id
      )
    ) INTO v_result
    FROM profiles pr WHERE pr.id = p_seeker_id;
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_seeker_for_tutor(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- search_seekers(...) → a JSON array of PUBLIC seeker cards (is_discoverable),
-- newest first. Any signed-in user may search. Each card respects the seeker's
-- share_personal_info (name/level hidden, generic label kept). Filters: name
-- text (q), subject (subcategory uuid), level (school_level), district (slug).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search_seekers(
  p_q           text DEFAULT NULL,
  p_subcategory uuid DEFAULT NULL,
  p_level       text DEFAULT NULL,
  p_district    text DEFAULT NULL,
  p_limit       int  DEFAULT 40
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING errcode = 'P0001'; END IF;

  WITH cards AS (
    -- Students
    SELECT
      pr.id,
      'student'::text AS role,
      CASE WHEN pr.share_personal_info
        THEN COALESCE(NULLIF(pr.display_name, ''), NULLIF(pr.full_name, ''), 'Student') ELSE 'Student' END AS name,
      CASE WHEN pr.share_personal_info THEN pr.avatar_url ELSE NULL END AS avatar_url,
      CASE WHEN pr.share_personal_info THEN sp.school_level::text ELSE NULL END AS level,
      COALESCE((SELECT jsonb_agg(sc.name_en ORDER BY sc.name_en)
                  FROM user_category_interests uci JOIN subcategories sc ON sc.id = uci.subcategory_id
                 WHERE uci.profile_id = pr.id), '[]'::jsonb) AS subjects,
      COALESCE(to_jsonb(sp.preferred_districts), '[]'::jsonb) AS districts,
      pr.share_personal_info AS share_info,
      pr.created_at
    FROM profiles pr JOIN student_profiles sp ON sp.id = pr.id
    WHERE pr.role = 'student' AND pr.is_discoverable
      AND (p_level IS NULL OR sp.school_level::text = p_level)
      AND (p_district IS NULL OR p_district = ANY(sp.preferred_districts))
      AND (p_subcategory IS NULL OR EXISTS (
            SELECT 1 FROM user_category_interests uci
             WHERE uci.profile_id = pr.id AND uci.subcategory_id = p_subcategory))
      AND (p_q IS NULL OR (pr.share_personal_info
            AND (pr.display_name ILIKE '%' || p_q || '%' OR pr.full_name ILIKE '%' || p_q || '%')))

    UNION ALL

    -- Parents (carded by their first child)
    SELECT
      pr.id,
      'parent'::text AS role,
      CASE WHEN pr.share_personal_info
        THEN COALESCE(NULLIF(pr.display_name, ''), NULLIF(pr.full_name, ''), 'Parent') ELSE 'Parent' END AS name,
      CASE WHEN pr.share_personal_info THEN pr.avatar_url ELSE NULL END AS avatar_url,
      CASE WHEN pr.share_personal_info THEN ch.school_level::text ELSE NULL END AS level,
      COALESCE((SELECT jsonb_agg(sc.name_en ORDER BY sc.name_en)
                  FROM child_category_interests cci JOIN subcategories sc ON sc.id = cci.subcategory_id
                 WHERE cci.child_id = ch.id), '[]'::jsonb) AS subjects,
      COALESCE(to_jsonb(ch.preferred_districts), '[]'::jsonb) AS districts,
      pr.share_personal_info AS share_info,
      pr.created_at
    FROM profiles pr
    JOIN LATERAL (
      SELECT * FROM child_profiles WHERE parent_id = pr.id ORDER BY created_at ASC LIMIT 1
    ) ch ON true
    WHERE pr.role = 'parent' AND pr.is_discoverable
      AND (p_level IS NULL OR ch.school_level::text = p_level)
      AND (p_district IS NULL OR p_district = ANY(ch.preferred_districts))
      AND (p_subcategory IS NULL OR EXISTS (
            SELECT 1 FROM child_category_interests cci
             WHERE cci.child_id = ch.id AND cci.subcategory_id = p_subcategory))
      AND (p_q IS NULL OR (pr.share_personal_info
            AND (pr.display_name ILIKE '%' || p_q || '%' OR pr.full_name ILIKE '%' || p_q || '%')))
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(c) - 'created_at' ORDER BY c.created_at DESC), '[]'::jsonb)
    INTO v_result
  FROM (SELECT * FROM cards ORDER BY created_at DESC LIMIT GREATEST(p_limit, 1)) c;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION search_seekers(text, uuid, text, text, int) TO authenticated;
