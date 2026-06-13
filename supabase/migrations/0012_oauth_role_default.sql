-- LearnSum MVP — OAuth-tolerant new-user trigger
-- Migration: 0012_oauth_role_default.sql
-- Reference: plan.md §5 (social login), CLAUDE.md (Onboarding & auth).
-- Note: local record of objects applied manually via the Supabase SQL editor.
--       Run AFTER 0011. Paste and run the WHOLE file.
--
-- handle_new_user() previously inserted profiles.role straight from
-- raw_user_meta_data->>'role'. Email signup supplies that (POST /api/auth/signup
-- validates it), but OAuth signups (Google / Microsoft / Apple) carry NO role —
-- so the NOT NULL profiles.role insert crashed and the entire social signup
-- failed. This makes the trigger tolerant: a missing/unrecognized role defaults
-- to 'student' (a neutral seeker placeholder). The user's REAL chosen role is
-- written by GET /api/auth/callback right after sign-in (they pick their role
-- during onboarding, before tapping a social button), while onboarding_done is
-- still false. Email signup is unchanged (its role is always present + valid).

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role user_role;
BEGIN
  -- Tolerate a missing OR unrecognized provider-supplied role.
  BEGIN
    v_role := NULLIF(NEW.raw_user_meta_data ->> 'role', '')::user_role;
  EXCEPTION WHEN others THEN
    v_role := NULL;
  END;

  INSERT INTO public.profiles (id, role)
  VALUES (NEW.id, COALESCE(v_role, 'student'));

  RETURN NEW;
END;
$$;

-- The existing on_auth_user_created trigger already calls this function;
-- no trigger change needed.
