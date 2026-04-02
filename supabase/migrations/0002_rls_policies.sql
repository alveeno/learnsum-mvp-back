-- LearnSum MVP — Row Level Security Policies
-- Migration: 0002_rls_policies.sql

-- ---------------------------------------------------------------------------
-- Enable RLS on all tables
-- ---------------------------------------------------------------------------
ALTER TABLE profiles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories                ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcategories             ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_category_interests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_subcategories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_availability        ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_media                ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_likes                ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_comments             ENABLE ROW LEVEL SECURITY;
ALTER TABLE inquiries                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations             ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_tokens               ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications             ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_filter_preferences  ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- profiles
-- Authenticated users can read all profiles (needed for resolving names in
-- conversations, browsing, etc). Users can only write their own row.
-- ---------------------------------------------------------------------------
CREATE POLICY "profiles: authenticated read all"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "profiles: owner insert"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles: owner update"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- student_profiles & parent_profiles
-- Tutors need to browse these — public to authenticated users.
-- Only owner can write.
-- ---------------------------------------------------------------------------
CREATE POLICY "student_profiles: authenticated read all"
  ON student_profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "student_profiles: owner write"
  ON student_profiles FOR ALL
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "parent_profiles: authenticated read all"
  ON parent_profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "parent_profiles: owner write"
  ON parent_profiles FOR ALL
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- tutor_profiles
-- Public can read published profiles. Owner can read+write their own always.
-- ---------------------------------------------------------------------------
CREATE POLICY "tutor_profiles: public read published"
  ON tutor_profiles FOR SELECT
  USING (is_published = true OR auth.uid() = id);

CREATE POLICY "tutor_profiles: owner insert"
  ON tutor_profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "tutor_profiles: owner update"
  ON tutor_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "tutor_profiles: owner delete"
  ON tutor_profiles FOR DELETE
  TO authenticated
  USING (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- categories & subcategories
-- Pre-seeded, read-only for all users. Only service role can write.
-- ---------------------------------------------------------------------------
CREATE POLICY "categories: public read"
  ON categories FOR SELECT
  USING (true);

CREATE POLICY "subcategories: public read"
  ON subcategories FOR SELECT
  USING (true);

-- ---------------------------------------------------------------------------
-- user_category_interests
-- Owner only.
-- ---------------------------------------------------------------------------
CREATE POLICY "user_category_interests: owner read"
  ON user_category_interests FOR SELECT
  TO authenticated
  USING (auth.uid() = profile_id);

CREATE POLICY "user_category_interests: owner write"
  ON user_category_interests FOR ALL
  TO authenticated
  USING (auth.uid() = profile_id)
  WITH CHECK (auth.uid() = profile_id);

-- ---------------------------------------------------------------------------
-- tutor_subcategories & tutor_availability
-- Public read (visible on tutor profiles). Owner write.
-- ---------------------------------------------------------------------------
CREATE POLICY "tutor_subcategories: public read"
  ON tutor_subcategories FOR SELECT
  USING (true);

CREATE POLICY "tutor_subcategories: owner write"
  ON tutor_subcategories FOR ALL
  TO authenticated
  USING (auth.uid() = tutor_id)
  WITH CHECK (auth.uid() = tutor_id);

CREATE POLICY "tutor_availability: public read"
  ON tutor_availability FOR SELECT
  USING (true);

CREATE POLICY "tutor_availability: owner write"
  ON tutor_availability FOR ALL
  TO authenticated
  USING (auth.uid() = tutor_id)
  WITH CHECK (auth.uid() = tutor_id);

-- ---------------------------------------------------------------------------
-- posts & post_media
-- All rows are publicly readable. Only the owning tutor can write.
-- ---------------------------------------------------------------------------
CREATE POLICY "posts: public read"
  ON posts FOR SELECT
  USING (true);

CREATE POLICY "posts: owner write"
  ON posts FOR ALL
  TO authenticated
  USING (auth.uid() = tutor_id)
  WITH CHECK (auth.uid() = tutor_id);

CREATE POLICY "post_media: public read"
  ON post_media FOR SELECT
  USING (true);

-- post_media write: owner is whoever owns the parent post
CREATE POLICY "post_media: owner write"
  ON post_media FOR ALL
  TO authenticated
  USING (
    auth.uid() = (SELECT tutor_id FROM posts WHERE id = post_id)
  )
  WITH CHECK (
    auth.uid() = (SELECT tutor_id FROM posts WHERE id = post_id)
  );

-- ---------------------------------------------------------------------------
-- post_likes & post_comments (schema-only in v1, UI deferred)
-- ---------------------------------------------------------------------------
CREATE POLICY "post_likes: authenticated read"
  ON post_likes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "post_likes: owner write"
  ON post_likes FOR ALL
  TO authenticated
  USING (auth.uid() = profile_id)
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "post_comments: public read non-deleted"
  ON post_comments FOR SELECT
  USING (deleted_at IS NULL);

CREATE POLICY "post_comments: owner write"
  ON post_comments FOR ALL
  TO authenticated
  USING (auth.uid() = profile_id)
  WITH CHECK (auth.uid() = profile_id);

-- ---------------------------------------------------------------------------
-- inquiries
-- Anyone (including unauthenticated) can INSERT.
-- Tutor can SELECT and UPDATE their own received inquiries.
-- Sender can SELECT their own sent inquiries (if authenticated).
-- ---------------------------------------------------------------------------
CREATE POLICY "inquiries: public insert"
  ON inquiries FOR INSERT
  WITH CHECK (true);

CREATE POLICY "inquiries: tutor read own"
  ON inquiries FOR SELECT
  TO authenticated
  USING (
    auth.uid() = tutor_id
    OR auth.uid() = sender_profile_id
  );

CREATE POLICY "inquiries: tutor update status"
  ON inquiries FOR UPDATE
  TO authenticated
  USING (auth.uid() = tutor_id);

-- ---------------------------------------------------------------------------
-- conversations & messages
-- Participants only.
-- ---------------------------------------------------------------------------
CREATE POLICY "conversations: participants read"
  ON conversations FOR SELECT
  TO authenticated
  USING (auth.uid() = participant_a OR auth.uid() = participant_b);

CREATE POLICY "conversations: participants insert"
  ON conversations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = participant_a OR auth.uid() = participant_b);

CREATE POLICY "messages: participants read"
  ON messages FOR SELECT
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT participant_a FROM conversations WHERE id = conversation_id
      UNION
      SELECT participant_b FROM conversations WHERE id = conversation_id
    )
  );

CREATE POLICY "messages: participants insert"
  ON messages FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND auth.uid() IN (
      SELECT participant_a FROM conversations WHERE id = conversation_id
      UNION
      SELECT participant_b FROM conversations WHERE id = conversation_id
    )
  );

CREATE POLICY "messages: owner mark read"
  ON messages FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT participant_a FROM conversations WHERE id = conversation_id
      UNION
      SELECT participant_b FROM conversations WHERE id = conversation_id
    )
  );

-- ---------------------------------------------------------------------------
-- notifications
-- Recipient only. System (service role) writes — no INSERT policy needed
-- since service_role bypasses RLS.
-- ---------------------------------------------------------------------------
CREATE POLICY "notifications: recipient read"
  ON notifications FOR SELECT
  TO authenticated
  USING (auth.uid() = recipient_id);

CREATE POLICY "notifications: recipient update (mark read)"
  ON notifications FOR UPDATE
  TO authenticated
  USING (auth.uid() = recipient_id);

-- ---------------------------------------------------------------------------
-- push_tokens & saved_filter_preferences
-- Owner only.
-- ---------------------------------------------------------------------------
CREATE POLICY "push_tokens: owner"
  ON push_tokens FOR ALL
  TO authenticated
  USING (auth.uid() = profile_id)
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "saved_filter_preferences: owner"
  ON saved_filter_preferences FOR ALL
  TO authenticated
  USING (auth.uid() = profile_id)
  WITH CHECK (auth.uid() = profile_id);
