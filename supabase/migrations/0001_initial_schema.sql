-- LearnSum MVP — Initial Schema
-- Migration: 0001_initial_schema.sql
-- Target: Supabase / PostgreSQL

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('parent', 'student', 'tutor');
CREATE TYPE preferred_language AS ENUM ('english', 'cantonese', 'mandarin');
CREATE TYPE hk_district AS ENUM (
  'CentralWestern', 'WanChai', 'Eastern', 'Southern',
  'YauTsimMong', 'ShamshuiPo', 'KowloonCity', 'WongTaiSin', 'KwunTong',
  'KwaiTsing', 'TsuenWan', 'TuenMun', 'YuenLong', 'North', 'TaiPo', 'SaiKung', 'ShaTin', 'Islands'
);
CREATE TYPE gender_type AS ENUM ('male', 'female', 'other', 'prefer_not_to_say');
CREATE TYPE school_level AS ENUM ('primary', 'secondary', 'university', 'adult');
CREATE TYPE tutoring_format AS ENUM ('online', 'in_person', 'both');
CREATE TYPE tutoring_type AS ENUM ('individual', 'group', 'both');
CREATE TYPE day_of_week AS ENUM ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun');
CREATE TYPE time_slot AS ENUM ('morning', 'afternoon', 'evening');
CREATE TYPE post_type AS ENUM ('update', 'showcase', 'result');
CREATE TYPE media_type AS ENUM ('image', 'video');
CREATE TYPE inquiry_status AS ENUM ('new', 'read', 'replied');
CREATE TYPE notification_type AS ENUM ('new_message', 'new_match', 'post_like', 'post_comment');
CREATE TYPE platform_type AS ENUM ('ios', 'android', 'web');

-- ---------------------------------------------------------------------------
-- Core profile table — extends auth.users
-- ---------------------------------------------------------------------------
CREATE TABLE profiles (
  id                 uuid                NOT NULL PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  role               user_role           NOT NULL,
  full_name          text,
  display_name       text,
  avatar_url         text,
  preferred_language preferred_language,
  district           hk_district,
  age                integer,
  gender             gender_type,
  school_name        text,
  onboarding_done    boolean             NOT NULL DEFAULT false,
  created_at         timestamptz         NOT NULL DEFAULT now(),
  updated_at         timestamptz         NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Role-specific profile detail tables
-- ---------------------------------------------------------------------------
CREATE TABLE student_profiles (
  id                   uuid            NOT NULL PRIMARY KEY REFERENCES profiles ON DELETE CASCADE,
  school_level         school_level,
  tutoring_format_pref tutoring_format,
  tutoring_type_pref   tutoring_type,
  budget_max_per_hour  integer
);

CREATE TABLE parent_profiles (
  id                   uuid            NOT NULL PRIMARY KEY REFERENCES profiles ON DELETE CASCADE,
  searching_for_self   boolean         NOT NULL DEFAULT false,
  tutoring_format_pref tutoring_format,
  tutoring_type_pref   tutoring_type,
  budget_max_per_hour  integer
);

CREATE TABLE tutor_profiles (
  id              uuid            NOT NULL PRIMARY KEY REFERENCES profiles ON DELETE CASCADE,
  slug            text            NOT NULL UNIQUE,
  bio             text,
  bio_zh          text,
  university      text,
  tutoring_format tutoring_format,
  tutoring_type   tutoring_type,
  whatsapp_number text,
  is_published    boolean         NOT NULL DEFAULT false,
  created_at      timestamptz     NOT NULL DEFAULT now(),
  updated_at      timestamptz     NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Taxonomy
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
  id      uuid NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4(),
  name_en text NOT NULL,
  name_zh text NOT NULL,
  slug    text NOT NULL UNIQUE
);

CREATE TABLE subcategories (
  id          uuid NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id uuid NOT NULL REFERENCES categories ON DELETE CASCADE,
  name_en     text NOT NULL,
  name_zh     text NOT NULL,
  slug        text NOT NULL UNIQUE
);

-- ---------------------------------------------------------------------------
-- Interest & subject junction tables
-- ---------------------------------------------------------------------------
CREATE TABLE user_category_interests (
  id             uuid NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id     uuid NOT NULL REFERENCES profiles ON DELETE CASCADE,
  subcategory_id uuid NOT NULL REFERENCES subcategories ON DELETE CASCADE,
  UNIQUE (profile_id, subcategory_id)
);

CREATE TABLE tutor_subcategories (
  id               uuid    NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4(),
  tutor_id         uuid    NOT NULL REFERENCES tutor_profiles ON DELETE CASCADE,
  subcategory_id   uuid    NOT NULL REFERENCES subcategories ON DELETE CASCADE,
  years_experience integer,
  hourly_rate_min  integer,
  hourly_rate_max  integer,
  -- v1.1 fields: schema-ready, not exposed in v1 onboarding UI
  achievements     jsonb,
  qualifications   jsonb,
  exam_results     jsonb
);

-- ---------------------------------------------------------------------------
-- Tutor availability
-- ---------------------------------------------------------------------------
CREATE TABLE tutor_availability (
  id          uuid        NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4(),
  tutor_id    uuid        NOT NULL REFERENCES tutor_profiles ON DELETE CASCADE,
  day_of_week day_of_week NOT NULL,
  time_slot   time_slot   NOT NULL,
  UNIQUE (tutor_id, day_of_week, time_slot)
);

-- ---------------------------------------------------------------------------
-- Posts & media
-- ---------------------------------------------------------------------------
CREATE TABLE posts (
  id             uuid        NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4(),
  tutor_id       uuid        NOT NULL REFERENCES tutor_profiles ON DELETE CASCADE,
  content        text,
  content_zh     text,
  post_type      post_type,
  likes_count    integer     NOT NULL DEFAULT 0,
  comments_count integer     NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE post_media (
  id         uuid       NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id    uuid       NOT NULL REFERENCES posts ON DELETE CASCADE,
  url        text       NOT NULL,
  media_type media_type NOT NULL,
  sort_order integer    NOT NULL DEFAULT 0
);

CREATE TABLE post_likes (
  id         uuid        NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id    uuid        NOT NULL REFERENCES posts ON DELETE CASCADE,
  profile_id uuid        NOT NULL REFERENCES profiles ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, profile_id)
);

CREATE TABLE post_comments (
  id                uuid        NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id           uuid        NOT NULL REFERENCES posts ON DELETE CASCADE,
  profile_id        uuid        NOT NULL REFERENCES profiles ON DELETE CASCADE,
  parent_comment_id uuid        REFERENCES post_comments,
  content           text        NOT NULL,
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Inquiries
-- ---------------------------------------------------------------------------
CREATE TABLE inquiries (
  id                uuid           NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4(),
  tutor_id          uuid           NOT NULL REFERENCES tutor_profiles ON DELETE CASCADE,
  sender_profile_id uuid           REFERENCES profiles ON DELETE SET NULL,
  sender_name       text           NOT NULL,
  sender_email      text           NOT NULL,
  sender_phone      text,
  message           text           NOT NULL,
  preferred_schedule text,
  status            inquiry_status NOT NULL DEFAULT 'new',
  created_at        timestamptz    NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Conversations & messages (v2 Realtime chat — schema only in v1)
-- ---------------------------------------------------------------------------
CREATE TABLE conversations (
  id              uuid        NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4(),
  participant_a   uuid        NOT NULL REFERENCES profiles ON DELETE CASCADE,
  participant_b   uuid        NOT NULL REFERENCES profiles ON DELETE CASCADE,
  last_message_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (participant_a, participant_b),
  CHECK (participant_a < participant_b)
);

CREATE TABLE messages (
  id              uuid        NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id uuid        NOT NULL REFERENCES conversations ON DELETE CASCADE,
  sender_id       uuid        NOT NULL REFERENCES profiles ON DELETE CASCADE,
  content         text        NOT NULL,
  is_read         boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Push tokens & notifications
-- ---------------------------------------------------------------------------
CREATE TABLE push_tokens (
  id         uuid          NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id uuid          NOT NULL REFERENCES profiles ON DELETE CASCADE,
  token      text          NOT NULL,
  platform   platform_type NOT NULL,
  created_at timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (profile_id, token)
);

CREATE TABLE notifications (
  id           uuid              NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_id uuid              NOT NULL REFERENCES profiles ON DELETE CASCADE,
  type         notification_type NOT NULL,
  title_en     text,
  title_zh     text,
  body_en      text,
  body_zh      text,
  data         jsonb,
  is_read      boolean           NOT NULL DEFAULT false,
  push_sent    boolean           NOT NULL DEFAULT false,
  created_at   timestamptz       NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Saved filter preferences (one row per profile, upsert pattern)
-- ---------------------------------------------------------------------------
CREATE TABLE saved_filter_preferences (
  id              uuid            NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id      uuid            NOT NULL UNIQUE REFERENCES profiles ON DELETE CASCADE,
  preferred_langs text[],
  districts       text[],
  tutoring_format tutoring_format,
  tutoring_type   tutoring_type,
  subcategory_ids uuid[],
  price_min       integer,
  price_max       integer,
  availability    jsonb,
  updated_at      timestamptz     NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX idx_tutor_profiles_slug        ON tutor_profiles (slug);
CREATE INDEX idx_tutor_profiles_published   ON tutor_profiles (is_published) WHERE is_published = true;
CREATE INDEX idx_tutor_subcategories_tutor  ON tutor_subcategories (tutor_id);
CREATE INDEX idx_tutor_subcategories_subcat ON tutor_subcategories (subcategory_id);
CREATE INDEX idx_posts_tutor_id             ON posts (tutor_id);
CREATE INDEX idx_posts_created_at           ON posts (created_at DESC);
CREATE INDEX idx_post_likes_post_id         ON post_likes (post_id);
CREATE INDEX idx_post_comments_post_id      ON post_comments (post_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_inquiries_tutor_id         ON inquiries (tutor_id);
CREATE INDEX idx_notifications_recipient    ON notifications (recipient_id) WHERE is_read = false;
CREATE INDEX idx_messages_conversation      ON messages (conversation_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Trigger functions — denormalized counter maintenance (§4.3a)
-- ---------------------------------------------------------------------------

-- post_likes → posts.likes_count
CREATE OR REPLACE FUNCTION increment_likes_count() RETURNS trigger AS $$
BEGIN
  UPDATE posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_increment_likes
  AFTER INSERT ON post_likes
  FOR EACH ROW EXECUTE FUNCTION increment_likes_count();

CREATE OR REPLACE FUNCTION decrement_likes_count() RETURNS trigger AS $$
BEGIN
  UPDATE posts SET likes_count = likes_count - 1 WHERE id = OLD.post_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_decrement_likes
  AFTER DELETE ON post_likes
  FOR EACH ROW EXECUTE FUNCTION decrement_likes_count();

-- post_comments → posts.comments_count
CREATE OR REPLACE FUNCTION increment_comments_count() RETURNS trigger AS $$
BEGIN
  IF NEW.deleted_at IS NULL THEN
    UPDATE posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_increment_comments
  AFTER INSERT ON post_comments
  FOR EACH ROW EXECUTE FUNCTION increment_comments_count();

CREATE OR REPLACE FUNCTION decrement_comments_count() RETURNS trigger AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    UPDATE posts SET comments_count = comments_count - 1 WHERE id = OLD.post_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_decrement_comments
  AFTER UPDATE ON post_comments
  FOR EACH ROW EXECUTE FUNCTION decrement_comments_count();

-- ---------------------------------------------------------------------------
-- Auto-create profiles row when auth.users row is inserted
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user() RETURNS trigger AS $$
BEGIN
  INSERT INTO profiles (id, role)
  VALUES (NEW.id, (NEW.raw_user_meta_data->>'role')::user_role);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
