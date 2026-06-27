-- LearnSum MVP — Fix denormalized counter triggers (likes/comments)
-- Migration: 0019_counter_triggers_security_definer.sql
-- Reference: found while verifying B1 (post likes), build round 2.
-- Note: local record of objects applied manually via the Supabase SQL editor.
--       Run AFTER 0018. Paste and run the WHOLE file.
--
-- BUG (latent since 0001): the four counter trigger functions ran as the calling
-- user (SECURITY INVOKER). The trigger body does `UPDATE posts SET likes_count …`,
-- but RLS "posts: owner update" only lets the POST OWNER update a post. When a
-- non-owner liked a post, the trigger's UPDATE matched 0 rows, so `likes_count`
-- (and `comments_count`) never changed — the like row was inserted, but the
-- denormalized counter stayed at 0.
--
-- FIX: recreate the functions as SECURITY DEFINER so the counter UPDATE runs as
-- the function owner and bypasses RLS. They only ever touch posts.*_count by id,
-- so this is safe. The triggers themselves are unchanged (they call these
-- functions by name; CREATE OR REPLACE swaps the body in place).

CREATE OR REPLACE FUNCTION increment_likes_count() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION decrement_likes_count() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE posts SET likes_count = likes_count - 1 WHERE id = OLD.post_id;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION increment_comments_count() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.deleted_at IS NULL THEN
    UPDATE posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION decrement_comments_count() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    UPDATE posts SET comments_count = comments_count - 1 WHERE id = OLD.post_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Lock them down: a SECURITY DEFINER function shouldn't be directly callable via
-- the REST RPC endpoint by anon/authenticated. Triggers fire regardless of the
-- EXECUTE grant (they run as part of the table's trigger mechanism), so revoking
-- is safe and clears the Supabase "anon/authenticated can execute SECURITY
-- DEFINER function" advisor for these four.
REVOKE EXECUTE ON FUNCTION increment_likes_count()    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION decrement_likes_count()    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION increment_comments_count() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION decrement_comments_count() FROM PUBLIC, anon, authenticated;

-- Backfill: recompute counts in case any likes/comments were recorded while the
-- trigger was silently no-op'ing (only likes were ever exercised, but this makes
-- both columns authoritative regardless).
UPDATE posts p SET
  likes_count    = COALESCE((SELECT count(*) FROM post_likes    pl WHERE pl.post_id = p.id), 0),
  comments_count = COALESCE((SELECT count(*) FROM post_comments  pc WHERE pc.post_id = p.id AND pc.deleted_at IS NULL), 0);
