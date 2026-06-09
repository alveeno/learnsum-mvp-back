# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

LearnSum is a Hong Kong-based two-sided tutoring marketplace. Tutors build Instagram-style profiles (bio + scrollable post feed) rather than CV-style listings. The primary tutor target is university students seeking side income. See `plan.md` for the full product and technical plan.

## Planned Stack

- **Backend API:** Next.js 14 (App Router) — API routes only, no frontend pages or UI
- **Frontend:** React Native + Expo (separate repo: `learnsum-mvp-expo-app`) — not in this repository
- **Backend + DB:** Supabase — auth, Postgres, Storage (media), Realtime (chat, v2)
- **Email:** Resend (transactional)
- **Deploy:** Vercel (API server only — no SSR pages, no static assets)

> **Note:** This repository contains the backend API only. There is no frontend code here. All UI, screens, and components live in the `learnsum-mvp-expo-app` repository.

Development environment: macOS, Terminal. Use bash-compatible commands for all testing instructions.

Testing commands must always be single-line bash commands. Never use multi-line curl syntax.

## Architecture Decisions

### Three user roles
`parent` | `student` | `tutor` — stored as an enum on the `profiles` table which extends `auth.users`. Each role has a corresponding detail table (`parent_profiles`, `student_profiles`, `tutor_profiles`).

### Tutor profiles are public without auth
`tutor_profiles.is_published = true` makes a profile publicly visible. RLS enforces this. An account is required only for: posting content, sending/receiving inquiries, and (v2) chat.

### Contact flow
WhatsApp redirect is the primary contact path (`wa.me/[number]?text=...`). The inquiry form is a fallback. No in-app messaging in v1.

### Bilingual content strategy
- System content (categories, notifications): parallel `name_en` / `name_zh` columns — acceptable since it is pre-seeded and finite
- Tutor free-text fields (`achievements`, `qualifications`, `exam_results` on `tutor_subcategories`): `jsonb` with `{"en": "...", "zh": "..."}` — extensible to more languages without schema changes
- User-generated posts: parallel `content` / `content_zh` columns

### Denormalized counters require triggers
`posts.likes_count` and `posts.comments_count` are denormalized for read performance. Postgres triggers on `post_likes` and `post_comments` must be created alongside the tables — see `plan.md §4.3a` for the required trigger stubs.

### Conversations canonical ordering
`conversations` enforces `CHECK (participant_a < participant_b)` to prevent duplicate rows. Always insert with the smaller UUID in `participant_a`.

### `tutor_subcategories` v1 scope
v1 onboarding collects only `subcategory_id`, `years_experience`, `hourly_rate_min`, `hourly_rate_max`. The `achievements`, `qualifications`, and `exam_results` jsonb fields are schema-ready but must not appear in the v1 onboarding form — they are v1.1.

### Two-sided matching (seeker → tutors)
`GET /api/feed` is personalized for an authenticated `student`/`parent` who has ≥1 `user_category_interests` row; everyone else (guests, tutors, seekers with no interests) gets the latest-tutors feed. Ranking runs in the Postgres RPC `match_tutors_for_seeker(p_page, p_page_size)` (`SECURITY DEFINER`, identifies the caller via `auth.uid()`). It scores every published tutor with a **soft** weighted similarity (no hard exclusions): category overlap **40**, availability overlap / district / preferred language / format-type-budget **15** each. A dimension with no data on either side is dropped and the remaining weights renormalize, so missing data never zeroes a tutor out (e.g. district is dropped for online-only tutors). Weights live as the five integer literals in `0003_seeker_availability_and_matching.sql` — tune them there. Availability for both sides is recurring `day_of_week × time_slot` buckets, not a calendar: tutors in `tutor_availability`, seekers in `seeker_availability`, both written via `PUT /api/availability` (role-routed).

## What is explicitly out of v1

Do not build these even if they seem natural extensions of adjacent work:

- Student and parent account profiles
- Tutor onboarding carousel (needs real profiles first)
- Real-time chat (use WhatsApp + inquiry form)
- Push notifications (use Resend email)
- Post likes and comments UI (schema exists, hold the UI)
- Saved filter preferences
- Calendar-based / per-date availability scheduling (matching uses recurring `day_of_week × time_slot` buckets only — see "Two-sided matching")
- Advanced search beyond category + district

> **Note:** Personalised home feed matching was originally deferred but is now built — see the "Two-sided matching" architecture decision above.
