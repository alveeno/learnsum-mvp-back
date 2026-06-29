-- LearnSum MVP — Tutor subscription tier
-- Migration: 0024_tutor_tier.sql
-- Apply AFTER 0023. Paste and run the WHOLE file.
--
-- Adds a subscription tier to each tutor: free / premium / deluxe. The tier
-- drives the daily contact-unlock allowance (free 0 / premium 1 / deluxe 3 —
-- enforced in 0025 + the routes) and whether the tutor's WhatsApp/WeChat are
-- shown to seekers (decided in the app from GET /api/tutors/[slug].tier).
--
-- No real payments yet — the app sets this via PATCH /api/tutor/tier (the
-- temporary tier switcher on the Profile tab). text + CHECK (not an enum) so the
-- tier set stays easy to extend.
--
-- GET /api/auth/me returns tutor_profiles via select('*'), so `tier` surfaces in
-- detail.tutor_profile automatically — no route change needed there.

ALTER TABLE tutor_profiles
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'free'
    CHECK (tier IN ('free', 'premium', 'deluxe'));
