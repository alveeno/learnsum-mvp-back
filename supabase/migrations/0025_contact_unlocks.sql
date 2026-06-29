-- LearnSum MVP — Tutor contact unlocks + the seeker read for tutors
-- Migration: 0025_contact_unlocks.sql
-- Apply AFTER 0024. Paste and run the WHOLE file.
--
-- Monetization core. A tutor spends a daily-limited "contact unlock" on a seeker
-- to (a) reveal that seeker's phone and (b) be allowed to reply to them in chat.
-- The daily allowance comes from the tutor's tier (free 0 / premium 1 / deluxe 3
-- — enforced in POST /api/tutor/contact-unlocks). An unlock is PERMANENT per
-- seeker (re-contacting is free forever); only the daily cap resets.
--
--   tutor_contact_unlocks : one row per (tutor, seeker) the tutor has unlocked.
--   get_seeker_for_tutor() : SECURITY DEFINER read of a seeker's profile for a
--                            tutor. Needed because child_profiles /
--                            *_category_interests are owner-only (minors), so a
--                            tutor's RLS client can't read a parent's child.
--                            Scoped to the calling tutor (auth.uid()); the PHONE
--                            is gated behind a tutor_contact_unlocks row.

CREATE TABLE IF NOT EXISTS tutor_contact_unlocks (
  id         uuid        NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4(),
  tutor_id   uuid        NOT NULL REFERENCES profiles ON DELETE CASCADE,
  seeker_id  uuid        NOT NULL REFERENCES profiles ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tutor_id, seeker_id)
);

-- Supports "my unlocks today" (daily cap) and "all my unlocked seekers".
CREATE INDEX IF NOT EXISTS idx_contact_unlocks_tutor
  ON tutor_contact_unlocks (tutor_id, created_at DESC);

ALTER TABLE tutor_contact_unlocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contact_unlocks: owner read"   ON tutor_contact_unlocks;
DROP POLICY IF EXISTS "contact_unlocks: owner insert" ON tutor_contact_unlocks;

-- A tutor reads + creates only their own unlock rows. No update/delete: an
-- unlock is permanent.
CREATE POLICY "contact_unlocks: owner read"
  ON tutor_contact_unlocks FOR SELECT USING (auth.uid() = tutor_id);
CREATE POLICY "contact_unlocks: owner insert"
  ON tutor_contact_unlocks FOR INSERT WITH CHECK (auth.uid() = tutor_id);

-- ---------------------------------------------------------------------------
-- get_seeker_for_tutor(p_seeker_id) → the seeker JSON a tutor sees.
--
-- SECURITY DEFINER because child_profiles + child_category_interests are
-- owner-only (children are minors), so a tutor's normal RLS client cannot read a
-- parent's child. The function still scopes to the calling tutor (auth.uid()),
-- requires the caller to be a tutor, and gates the phone behind an unlock row.
-- Any signed-in tutor may read a seeker's preferences/child — Req: "tutors see
-- the seeker profile in all tiers" — only the phone is unlock-gated.
--
-- Shape matches the app's `Seeker` type (lib/api/seekers.ts).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_seeker_for_tutor(p_seeker_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tutor    uuid := auth.uid();
  v_role     user_role;
  v_unlocked boolean;
  v_child    child_profiles%ROWTYPE;
  v_result   jsonb;
BEGIN
  IF v_tutor IS NULL THEN RAISE EXCEPTION 'not authenticated' USING errcode = 'P0001'; END IF;
  IF (SELECT role FROM profiles WHERE id = v_tutor) <> 'tutor' THEN
    RAISE EXCEPTION 'tutors only' USING errcode = 'P0001';
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = p_seeker_id;
  IF v_role IS NULL OR v_role = 'tutor' THEN RETURN NULL; END IF;

  v_unlocked := EXISTS (
    SELECT 1 FROM tutor_contact_unlocks
    WHERE tutor_id = v_tutor AND seeker_id = p_seeker_id
  );

  IF v_role = 'student' THEN
    SELECT jsonb_build_object(
      'id', pr.id,
      'role', 'student',
      'name', COALESCE(NULLIF(pr.display_name, ''), NULLIF(pr.full_name, ''), 'Student'),
      'avatar_url', pr.avatar_url,
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
      'contact', jsonb_build_object(
        'phone',      CASE WHEN v_unlocked THEN pr.phone ELSE NULL END,
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
      'name', COALESCE(NULLIF(pr.display_name, ''), NULLIF(pr.full_name, ''), 'Parent'),
      'avatar_url', pr.avatar_url,
      'child', CASE WHEN v_child.id IS NOT NULL
        THEN jsonb_build_object('name', v_child.name, 'level', v_child.school_level, 'age', v_child.age)
        ELSE NULL END,
      'subjects', COALESCE(
        (SELECT jsonb_agg(sc.name_en ORDER BY sc.name_en)
           FROM child_category_interests cci
           JOIN subcategories sc ON sc.id = cci.subcategory_id
          WHERE cci.child_id = v_child.id), '[]'::jsonb),
      'format', v_child.tutoring_format_pref,
      'districts', COALESCE(to_jsonb(v_child.preferred_districts), '[]'::jsonb),
      'languages', COALESCE(to_jsonb(v_child.preferred_languages), '[]'::jsonb),
      'availability_note', NULL,
      'contact', jsonb_build_object(
        'phone',      CASE WHEN v_unlocked THEN pr.phone ELSE NULL END,
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
