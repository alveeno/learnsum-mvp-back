-- LearnSum MVP — Tutor contact columns (Instagram + WeChat)
-- Migration: 0004_tutor_contact_columns.sql
-- Reference: plan.md §4.1 / §4.5, CLAUDE.md (Contact flow — WhatsApp / Instagram / WeChat)
-- Note: like 0002_rls.sql and 0003, this file is a local record of objects
--       applied manually via the Supabase dashboard SQL editor. Safe to re-run:
--       ADD COLUMN IF NOT EXISTS is a no-op if the column already exists.
--
-- Adds two optional contact columns to tutor_profiles, alongside the existing
-- whatsapp_number. All three are optional and any combination may be set; the
-- public tutor profile page renders a button for each one that is filled in.
-- Values are stored as entered (the app builds the wa.me / instagram.com / WeChat
-- links). No RLS change is needed: the existing "owner update/insert" policies on
-- tutor_profiles already cover every column on the row.

ALTER TABLE tutor_profiles
  ADD COLUMN IF NOT EXISTS instagram_handle text,
  ADD COLUMN IF NOT EXISTS wechat_id        text;
