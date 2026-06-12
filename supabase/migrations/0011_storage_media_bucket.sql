-- LearnSum MVP — Storage: media bucket for avatars + post media
-- Migration: 0011_storage_media_bucket.sql
-- Reference: plan.md §4.4 (post_media) / §5 (POST /api/upload), CLAUDE.md (Storage).
-- Note: local record of objects applied manually via the Supabase SQL editor.
--       Run AFTER 0010. Paste and run the WHOLE file.
--
-- Creates ONE public bucket, `media`, holding both avatars and tutor post media.
-- There is no service-role key in this project, so uploads run as the logged-in
-- user: the API issues a signed upload URL (or the app uploads directly) and the
-- Storage RLS policies below enforce that a user can only write under their own
-- "{auth.uid()}/..." path prefix. Reads are public because avatars and post
-- media are shown on public tutor profiles/cards.
--
-- Path convention (set by POST /api/upload):
--   {auth.uid()}/avatars/{uuid}.{ext}
--   {auth.uid()}/posts/{uuid}.{ext}
-- so (storage.foldername(name))[1] is always the owner's user id.

-- ===========================================================================
-- 1. The bucket (public read; 100 MB cap; image + common video mime types)
-- ===========================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media', 'media', true, 104857600,
  ARRAY['image/jpeg','image/png','image/webp','image/gif',
        'video/mp4','video/quicktime','video/webm']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ===========================================================================
-- 2. RLS on storage.objects for the `media` bucket
--    (storage.objects already has RLS enabled by Supabase.)
-- ===========================================================================
DROP POLICY IF EXISTS "media: public read"   ON storage.objects;
DROP POLICY IF EXISTS "media: owner insert"  ON storage.objects;
DROP POLICY IF EXISTS "media: owner update"  ON storage.objects;
DROP POLICY IF EXISTS "media: owner delete"  ON storage.objects;

-- Public read of every object in the media bucket.
CREATE POLICY "media: public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'media');

-- Authenticated users may write only under their own {auth.uid()}/ prefix.
CREATE POLICY "media: owner insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "media: owner update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "media: owner delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
