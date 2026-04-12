-- LearnSum MVP — Row Level Security Policies
-- Migration: 0002_rls.sql
-- Reference: plan.md §4.9
-- Note: this file is a local record of policies applied manually via the
--       Supabase dashboard. Do not re-run against a live project.

-- ---------------------------------------------------------------------------
-- Enable RLS on all tables
-- ---------------------------------------------------------------------------
ALTER TABLE profiles                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories               ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcategories            ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_category_interests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_subcategories      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_availability       ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_media               ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_likes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_comments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE inquiries                ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_tokens              ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications            ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_filter_preferences ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- profiles
-- Public SELECT (needed for tutor browse and inquiry display).
-- Owner-only writes (the trigger in 0001 inserts the row; app updates it).
-- ---------------------------------------------------------------------------
CREATE POLICY "profiles: public read"
  ON profiles FOR SELECT
  USING (true);

CREATE POLICY "profiles: owner insert"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles: owner update"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- tutor_profiles
-- Public SELECT only for published rows; owner can always see their own.
-- Owner-only INSERT / UPDATE / DELETE.
-- ---------------------------------------------------------------------------
CREATE POLICY "tutor_profiles: public read published"
  ON tutor_profiles FOR SELECT
  USING (is_published = true OR auth.uid() = id);

CREATE POLICY "tutor_profiles: owner insert"
  ON tutor_profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "tutor_profiles: owner update"
  ON tutor_profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "tutor_profiles: owner delete"
  ON tutor_profiles FOR DELETE
  USING (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- student_profiles + parent_profiles
-- All rows are publicly readable (tutors browse these in v2).
-- Owner-only writes.
-- ---------------------------------------------------------------------------
CREATE POLICY "student_profiles: public read"
  ON student_profiles FOR SELECT
  USING (true);

CREATE POLICY "student_profiles: owner insert"
  ON student_profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "student_profiles: owner update"
  ON student_profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "student_profiles: owner delete"
  ON student_profiles FOR DELETE
  USING (auth.uid() = id);

CREATE POLICY "parent_profiles: public read"
  ON parent_profiles FOR SELECT
  USING (true);

CREATE POLICY "parent_profiles: owner insert"
  ON parent_profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "parent_profiles: owner update"
  ON parent_profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "parent_profiles: owner delete"
  ON parent_profiles FOR DELETE
  USING (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- categories + subcategories
-- Pre-seeded reference data — public read, no user writes.
-- ---------------------------------------------------------------------------
CREATE POLICY "categories: public read"
  ON categories FOR SELECT
  USING (true);

CREATE POLICY "subcategories: public read"
  ON subcategories FOR SELECT
  USING (true);

-- ---------------------------------------------------------------------------
-- user_category_interests — owner only
-- ---------------------------------------------------------------------------
CREATE POLICY "user_category_interests: owner read"
  ON user_category_interests FOR SELECT
  USING (auth.uid() = profile_id);

CREATE POLICY "user_category_interests: owner insert"
  ON user_category_interests FOR INSERT
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "user_category_interests: owner delete"
  ON user_category_interests FOR DELETE
  USING (auth.uid() = profile_id);

-- ---------------------------------------------------------------------------
-- tutor_subcategories — public read; owner write
-- ---------------------------------------------------------------------------
CREATE POLICY "tutor_subcategories: public read"
  ON tutor_subcategories FOR SELECT
  USING (true);

CREATE POLICY "tutor_subcategories: owner insert"
  ON tutor_subcategories FOR INSERT
  WITH CHECK (
    auth.uid() = (SELECT id FROM tutor_profiles WHERE id = tutor_id)
  );

CREATE POLICY "tutor_subcategories: owner update"
  ON tutor_subcategories FOR UPDATE
  USING (
    auth.uid() = (SELECT id FROM tutor_profiles WHERE id = tutor_id)
  );

CREATE POLICY "tutor_subcategories: owner delete"
  ON tutor_subcategories FOR DELETE
  USING (
    auth.uid() = (SELECT id FROM tutor_profiles WHERE id = tutor_id)
  );

-- ---------------------------------------------------------------------------
-- tutor_availability — public read; owner write
-- ---------------------------------------------------------------------------
CREATE POLICY "tutor_availability: public read"
  ON tutor_availability FOR SELECT
  USING (true);

CREATE POLICY "tutor_availability: owner insert"
  ON tutor_availability FOR INSERT
  WITH CHECK (
    auth.uid() = (SELECT id FROM tutor_profiles WHERE id = tutor_id)
  );

CREATE POLICY "tutor_availability: owner update"
  ON tutor_availability FOR UPDATE
  USING (
    auth.uid() = (SELECT id FROM tutor_profiles WHERE id = tutor_id)
  );

CREATE POLICY "tutor_availability: owner delete"
  ON tutor_availability FOR DELETE
  USING (
    auth.uid() = (SELECT id FROM tutor_profiles WHERE id = tutor_id)
  );

-- ---------------------------------------------------------------------------
-- posts — all rows SELECT; owner write
-- ---------------------------------------------------------------------------
CREATE POLICY "posts: public read"
  ON posts FOR SELECT
  USING (true);

CREATE POLICY "posts: owner insert"
  ON posts FOR INSERT
  WITH CHECK (
    auth.uid() = (SELECT id FROM tutor_profiles WHERE id = tutor_id)
  );

CREATE POLICY "posts: owner update"
  ON posts FOR UPDATE
  USING (
    auth.uid() = (SELECT id FROM tutor_profiles WHERE id = tutor_id)
  );

CREATE POLICY "posts: owner delete"
  ON posts FOR DELETE
  USING (
    auth.uid() = (SELECT id FROM tutor_profiles WHERE id = tutor_id)
  );

-- ---------------------------------------------------------------------------
-- post_media — all rows SELECT; owner write (via post ownership)
-- ---------------------------------------------------------------------------
CREATE POLICY "post_media: public read"
  ON post_media FOR SELECT
  USING (true);

CREATE POLICY "post_media: owner insert"
  ON post_media FOR INSERT
  WITH CHECK (
    auth.uid() = (
      SELECT tp.id
      FROM tutor_profiles tp
      JOIN posts p ON p.tutor_id = tp.id
      WHERE p.id = post_id
    )
  );

CREATE POLICY "post_media: owner delete"
  ON post_media FOR DELETE
  USING (
    auth.uid() = (
      SELECT tp.id
      FROM tutor_profiles tp
      JOIN posts p ON p.tutor_id = tp.id
      WHERE p.id = post_id
    )
  );

-- ---------------------------------------------------------------------------
-- post_likes — schema only (UI deferred to v2)
-- Auth users can manage their own likes.
-- ---------------------------------------------------------------------------
CREATE POLICY "post_likes: public read"
  ON post_likes FOR SELECT
  USING (true);

CREATE POLICY "post_likes: owner insert"
  ON post_likes FOR INSERT
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "post_likes: owner delete"
  ON post_likes FOR DELETE
  USING (auth.uid() = profile_id);

-- ---------------------------------------------------------------------------
-- post_comments — schema only (UI deferred to v2)
-- Soft-deleted rows are hidden from public SELECT.
-- ---------------------------------------------------------------------------
CREATE POLICY "post_comments: public read"
  ON post_comments FOR SELECT
  USING (deleted_at IS NULL);

CREATE POLICY "post_comments: owner insert"
  ON post_comments FOR INSERT
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "post_comments: owner update (soft delete)"
  ON post_comments FOR UPDATE
  USING (auth.uid() = profile_id);

-- ---------------------------------------------------------------------------
-- inquiries
-- Anyone (including unauthenticated) can INSERT.
-- Only the addressed tutor can SELECT or UPDATE status.
-- ---------------------------------------------------------------------------
CREATE POLICY "inquiries: public insert"
  ON inquiries FOR INSERT
  WITH CHECK (true);

CREATE POLICY "inquiries: tutor read own"
  ON inquiries FOR SELECT
  USING (
    auth.uid() = (SELECT id FROM tutor_profiles WHERE id = tutor_id)
  );

CREATE POLICY "inquiries: tutor update status"
  ON inquiries FOR UPDATE
  USING (
    auth.uid() = (SELECT id FROM tutor_profiles WHERE id = tutor_id)
  );

-- ---------------------------------------------------------------------------
-- conversations — participants only
-- ---------------------------------------------------------------------------
CREATE POLICY "conversations: participant read"
  ON conversations FOR SELECT
  USING (auth.uid() = participant_a OR auth.uid() = participant_b);

CREATE POLICY "conversations: participant insert"
  ON conversations FOR INSERT
  WITH CHECK (auth.uid() = participant_a OR auth.uid() = participant_b);

CREATE POLICY "conversations: participant update"
  ON conversations FOR UPDATE
  USING (auth.uid() = participant_a OR auth.uid() = participant_b);

-- ---------------------------------------------------------------------------
-- messages — participants only
-- ---------------------------------------------------------------------------
CREATE POLICY "messages: participant read"
  ON messages FOR SELECT
  USING (
    auth.uid() IN (
      SELECT participant_a FROM conversations WHERE id = conversation_id
      UNION ALL
      SELECT participant_b FROM conversations WHERE id = conversation_id
    )
  );

CREATE POLICY "messages: participant insert"
  ON messages FOR INSERT
  WITH CHECK (
    auth.uid() = sender_id
    AND auth.uid() IN (
      SELECT participant_a FROM conversations WHERE id = conversation_id
      UNION ALL
      SELECT participant_b FROM conversations WHERE id = conversation_id
    )
  );

-- ---------------------------------------------------------------------------
-- notifications — recipient only; no user INSERT (system / trigger managed)
-- ---------------------------------------------------------------------------
CREATE POLICY "notifications: recipient read"
  ON notifications FOR SELECT
  USING (auth.uid() = recipient_id);

CREATE POLICY "notifications: recipient update (mark read)"
  ON notifications FOR UPDATE
  USING (auth.uid() = recipient_id);

-- ---------------------------------------------------------------------------
-- push_tokens — owner only
-- ---------------------------------------------------------------------------
CREATE POLICY "push_tokens: owner read"
  ON push_tokens FOR SELECT
  USING (auth.uid() = profile_id);

CREATE POLICY "push_tokens: owner insert"
  ON push_tokens FOR INSERT
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "push_tokens: owner delete"
  ON push_tokens FOR DELETE
  USING (auth.uid() = profile_id);

-- ---------------------------------------------------------------------------
-- saved_filter_preferences — owner only
-- ---------------------------------------------------------------------------
CREATE POLICY "saved_filter_preferences: owner read"
  ON saved_filter_preferences FOR SELECT
  USING (auth.uid() = profile_id);

CREATE POLICY "saved_filter_preferences: owner insert"
  ON saved_filter_preferences FOR INSERT
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "saved_filter_preferences: owner update"
  ON saved_filter_preferences FOR UPDATE
  USING (auth.uid() = profile_id);

CREATE POLICY "saved_filter_preferences: owner delete"
  ON saved_filter_preferences FOR DELETE
  USING (auth.uid() = profile_id);
