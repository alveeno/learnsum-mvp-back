-- LearnSum MVP — Self-service account deletion
-- Migration: 0013_delete_own_account.sql
-- Reference: plan.md §5 (DELETE /api/profiles/me), CLAUDE.md (Profile editing & account deletion).
-- Note: local record of objects applied manually via the Supabase SQL editor.
--       Run AFTER 0012. Paste and run the WHOLE file. (CREATE OR REPLACE — safe to re-run.)
--
-- There is no service-role key in this project, so a user cannot be removed from
-- auth.users through the client. This SECURITY DEFINER function runs with the
-- definer's (admin) rights but only ever acts on the CALLER — auth.uid() is read
-- from the request JWT, so a user can only delete their own account.
--
-- Deleting the auth.users row cascades to everything that references the user:
-- profiles (FK ON DELETE CASCADE) → student/parent/tutor profiles, child_profiles,
-- user_category_interests, saved_filter_preferences, posts (→ post_media/likes/
-- comments), tutor_subcategories, tutor_availability, tutor_languages,
-- conversations/messages, push_tokens, notifications; inquiries.sender is SET NULL.
-- seeker_availability has no cascading FK (owner_id is polymorphic) and is cleaned
-- up here. The user's Storage files (media bucket) are removed by the API endpoint
-- via the Storage API, because Postgres forbids a direct DELETE on storage.objects.

CREATE OR REPLACE FUNCTION public.delete_own_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING errcode = 'P0001';
  END IF;

  -- seeker_availability has no FK (owner_id is polymorphic). Remove the caller's
  -- own rows and their children's rows while child_profiles still exist.
  DELETE FROM seeker_availability
   WHERE (owner_type = 'student' AND owner_id = v_uid)
      OR (owner_type = 'child'
          AND owner_id IN (SELECT id FROM child_profiles WHERE parent_id = v_uid));

  -- Remove the auth user; FK ON DELETE CASCADE clears all the rest in one shot.
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_own_account() TO authenticated;
