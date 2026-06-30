-- LearnSum MVP — Seeker WeChat ID on the shared profile
-- Migration: 0031_profile_wechat.sql
-- Note: local record of objects applied manually via the Supabase SQL editor.
--       Run AFTER 0030. Paste and run the WHOLE file.
--
-- The Expo app added an "Account information" section to every user type's
-- profile/account screen. It shows an EDITABLE WeChat ID. Tutors already store a
-- WeChat ID on tutor_profiles.wechat_id (migration 0004) and edit it via
-- PATCH /api/tutors/[slug]. Students/parents had no place to store one — they
-- have no tutor row and PATCH /api/profiles/me had no wechat field.
--
-- What changes:
--   • profiles : + wechat_id text (shared column; usable by any role)
--
-- The matching route change — PATCH /api/profiles/me accepts `wechat_id` — lives
-- in the app code, not this migration. GET /api/auth/me needs no change: it does
-- select('*') on profiles, so the new column is returned automatically.
--
-- Scope note: this is the seeker's OWN self-view/edit only. The seeker WeChat is
-- NOT exposed to tutors — get_seeker_for_tutor (migration 0029) still returns
-- 'wechat' -> NULL in the contact JSON. Exposing it would be a separate change.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS wechat_id text;
