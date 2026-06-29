-- LearnSum MVP — Profile views ("who viewed your profile")
-- Migration: 0026_profile_views.sql
-- Apply AFTER 0025. Paste and run the WHOLE file.
--
-- Records that a viewer opened a tutor's profile, backing the tutor Analytics
-- "who viewed your profile" list. One row per (tutor, viewer) — re-viewing bumps
-- created_at (so the list is "most recent viewers first"). The tutor reads their
-- own viewers; any signed-in user records a view of a published tutor.

CREATE TABLE IF NOT EXISTS profile_views (
  id         uuid        NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4(),
  tutor_id   uuid        NOT NULL REFERENCES tutor_profiles ON DELETE CASCADE,
  viewer_id  uuid        NOT NULL REFERENCES profiles       ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tutor_id, viewer_id)
);

CREATE INDEX IF NOT EXISTS idx_profile_views_tutor ON profile_views (tutor_id, created_at DESC);

ALTER TABLE profile_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profile_views: tutor read"    ON profile_views;
DROP POLICY IF EXISTS "profile_views: viewer insert" ON profile_views;
DROP POLICY IF EXISTS "profile_views: viewer update" ON profile_views;

-- The tutor whose profile it is reads the viewers (tutor_id = their profile id).
CREATE POLICY "profile_views: tutor read"
  ON profile_views FOR SELECT USING (auth.uid() = tutor_id);
-- Any signed-in user records their own view (viewer_id = themselves).
CREATE POLICY "profile_views: viewer insert"
  ON profile_views FOR INSERT WITH CHECK (auth.uid() = viewer_id);
-- A re-view upserts (bumps created_at) — the viewer may update their own row.
CREATE POLICY "profile_views: viewer update"
  ON profile_views FOR UPDATE USING (auth.uid() = viewer_id);
