# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

LearnSum is a Hong Kong-based two-sided tutoring marketplace. Tutors build Instagram-style profiles (bio + scrollable post feed) rather than CV-style listings. The primary tutor target is university students seeking side income. See `plan.md` for the full product and technical plan.

> **Repo naming:** this backend repo is `learnsum-mvp-back`; the frontend is
> `learnsum-mvp-expo-app`. (Folders are being renamed to these — treat as canonical.)

## Planned Stack

- **Backend API:** Next.js 16 (App Router) — API routes only, no frontend pages or UI. **Dynamic route handlers must `await params`** (`params` is a Promise in Next 15+; reading it synchronously yields `undefined` and silently breaks `[slug]`/`[id]` lookups).
- **Frontend:** React Native + Expo (separate repo: `learnsum-mvp-expo-app`) — not in this repository
- **Backend + DB:** Supabase — auth, Postgres, Storage (media)
- **Email:** Resend (transactional) — **not wired yet** (email verification off, notifications not built; see TODO)
- **Deploy:** Vercel (API server only — no SSR pages, no static assets)

> **Note:** This repository contains the backend API only. There is no frontend code here. All UI, screens, and components live in the `learnsum-mvp-expo-app` repository.

Development environment: macOS, Terminal. Use bash-compatible commands for all testing instructions.

Testing commands must always be single-line bash commands. Never use multi-line curl syntax.

## Architecture Decisions

### Three user roles
`parent` | `student` | `tutor` — stored as an enum on the `profiles` table which extends `auth.users`. Each role has detail tables: `student_profiles`, `parent_profiles`, `tutor_profiles`, plus **`child_profiles`** (one row per child of a parent — NEW, see "Parent children" below).

### Onboarding & auth — credentials first
All auth methods (email, phone, social) create the account **before** collecting preferences. The frontend shows credentials/OTP on the first onboarding screen; once a session exists the user fills in their preferences; the one-shot `POST /api/onboarding` write persists them at the end. The signup/verify endpoints return `is_new_user` (false = returning user → skip onboarding) so the app can branch appropriately.

**Email+password:** `POST /api/auth/signup` with `{ email, password, role }` — creates the account and returns a live session. Email verification is OFF. `POST /api/auth/login` signs in.

**Phone/SMS OTP (built ✅):** `POST /api/auth/phone` with `{ phone, role? }` sends a 6-digit OTP via SMS (Supabase phone provider + Twilio). `POST /api/auth/phone/verify` with `{ phone, token, role? }` verifies the code, creates or signs into the account, assigns role for new users, returns `{ user, session, is_new_user }`. Phone number is stored in `auth.users.phone` and returned by `GET /api/auth/me` on the `user` object — no separate `profiles.phone` column needed. Uses international E.164 format (+[country code][number]).

**Social login (Google/Apple/Microsoft):** backend-mediated via `POST`/`GET /api/auth/oauth` + `GET /api/auth/callback` (migration `0012` defaults a missing OAuth role to `student`; the callback assigns the real chosen role while `onboarding_done` is false; Microsoft → Supabase `azure`). The callback's `next` redirect is **allowlist-validated to prevent an open redirect** — set the **`OAUTH_REDIRECT_ALLOWLIST`** env (comma-separated trusted prefixes, e.g. `learnsum://,https://app.learnsum.com`) to the app deep-link scheme + web origin when wiring the frontend; same-origin is always allowed.

The one-shot onboarding write endpoint is **`POST /api/onboarding` ✅** — it maps the frontend's slugs/labels to backend IDs/enums and persists the role's data atomically via the `complete_onboarding()` function (migration `0009`, extended by `0014`); tutor teaching levels, per-subject experience and education history are now persisted (migration `0014`); only custom subjects are skipped/reported, and language proficiency is display-only. See `plan.md §5/§9`.

### Tutor profiles are public, but not auto-published
`tutor_profiles.is_published = true` makes a profile publicly visible (RLS enforces this). After onboarding a tutor stays **unpublished**; the tutor home screen shows a persistent "complete your profile" prompt → a dedicated screen for bio, photo, WhatsApp, Instagram, WeChat and remaining details, then the tutor **explicitly publishes**. Tutors can **self-unpublish** (set `is_published = false`) from their profile. An account is required for: posting content and (dormant) chat.

### Contact flow — WhatsApp / Instagram / WeChat
Three optional columns on `tutor_profiles`: `whatsapp_number`, `instagram_handle`, `wechat_id` (the latter two added in migration `0004` ✅). All optional, any combination; the profile page shows every configured button simultaneously. WhatsApp opens `wa.me/[number]?text=Hi, I found you on LearnSum and I'm interested in tutoring for [subject].`; Instagram opens the profile; WeChat opens with the WeChat ID. **No inquiry form** (the `inquiries` table + endpoint remain but are dormant). **No in-app messaging yet (see TODO).**

### Profile editing & account deletion (all roles)
Every role can edit its onboarding preferences from the profile screen and **delete its account**. Tutors edit: profile picture, bio, WhatsApp/Instagram/WeChat, categories, availability, rates, districts, languages, and `is_published`. Students/parents edit any onboarding preference. **Endpoint coverage complete:** `PATCH /api/profiles/me` (account + student/parent prefs + interests), `/api/children` + `/api/children/[id]` (parent children CRUD), `PUT /api/tutor/subjects` + `PUT /api/tutor/languages` (tutor subjects/languages), `PATCH /api/tutors/[slug]` (tutor profile/contacts/publish), `PUT /api/availability` (schedules), and `DELETE /api/profiles/me` (account deletion via SECURITY DEFINER 0013).

### Bilingual content strategy
- System content (categories): parallel `name_en` / `name_zh` columns — pre-seeded and finite.
- Tutor free-text fields (`achievements`, `qualifications`, `exam_results` on `tutor_subcategories`): `jsonb` `{"en": "...", "zh": "..."}`.
- User-generated posts: parallel `content` / `content_zh` columns.

### Denormalized counters require triggers
`posts.likes_count` and `posts.comments_count` are denormalized; triggers on `post_likes` and `post_comments` maintain them (already in `0001`; see `plan.md §4.4a`). Likes/comments **UI not built yet (see TODO)** — schema only.

### `tutor_subcategories` — achievements/qualifications collected in onboarding
Onboarding collects `subcategory_id`, `years_experience`, pay, **and** `achievements`, `qualifications`, `exam_results` (the tutor "Strengths & Details" screen already collects them). It also collects a free-text "relevant experience" list (stored in `tutor_subcategories.experience` jsonb — migration `0014`) and a single pay figure per subject (mapped to both `hourly_rate_min`/`max`). Teaching levels + education history live on `tutor_profiles` (`teaching_levels`/`education`/`current_studies`, also `0014`). **`GET /api/tutors/[slug]` returns these three jsonb fields per subject, plus the tutor's `tutor_languages` (language + proficiency) ✅.** Post-onboarding, a tutor edits subjects via **`PUT /api/tutor/subjects`** (full-replace; pre-validates subcategory ids before the destructive delete) and teaching languages via **`PUT /api/tutor/languages`** (full-replace) ✅.

### Parent children (NEW)
A parent's tutoring preferences are **per child**, not on the parent. Each child is a `child_profiles` row (name, `school_level`, format/type/budget, preferred languages/districts) with its own `child_category_interests` and availability. **Matching runs per child.** (Tables added in migration `0006`, owner-only/private ✅; per-child matching ✅ (0008), onboarding write ✅ (0009), and full children CRUD ✅ via `/api/children` + `/api/children/[id]` — schedules via `PUT /api/availability?child_id=`.)

### Availability — precise time ranges (REDESIGNED)
The current design stores **precise start/end minute ranges per weekday**, not `morning|afternoon|evening` buckets. The `time_slot` enum is removed; `tutor_availability` / `seeker_availability` use `start_min`/`end_min`; multiple ranges per day allowed. Written via `GET`/`PUT /api/availability` (role-routed; parents pass a `child_id`). **Done in migration `0007` ✅** (tables + endpoint reworked; children's per-child availability is code-complete but not live-testable until a children-creation endpoint exists).

### Two-sided matching (seeker → tutors)
`GET /api/feed` is personalized for an authenticated seeker (a `student`, or a `parent`'s `child`) with ≥1 category interest; everyone else (guests, tutors, seekers with no interests) gets the latest-tutors feed (`created_at` DESC, unfiltered). Ranking runs in the Postgres RPC `match_tutors_for_seeker(...)` (`SECURITY DEFINER`, caller via `auth.uid()`). **Weighting order, most → least important: subject/category → availability (real time-overlap) → price → preferred language → district** (district dropped for online-only tutors). Scoring is **soft** with **graceful degradation — never an empty state**; a dimension with no data on either side is dropped and remaining weights renormalize. Weights are an **operator-tunable config** (the integer literals in the matching migration) — **no end-user weight UI**. **Reworked in migration `0008` ✅** for precise time-overlap, a separate price dimension, the new weight order (subject 40 > availability 25 > price 15 > language 10 > district 7), and **per-child** matching; format/type are a minor tie-breaker (weight 3). `/api/feed` accepts a `child_id` for parents.

## TODO (eventually)

No launch deadline — everything here is intended for build at some point, in no fixed order. Nothing is "cut"; it's just not built yet. Several already have dormant schema/endpoints in the repo (noted inline) — switch them on, don't rebuild from scratch.

**Pending features**
- In-app chat / messaging — `conversations`/`messages` schema + `/api/conversations*` exist but are **dormant**; no real-time wiring, no UI. Contact today is WhatsApp/Instagram/WeChat.
- Inquiry form — `inquiries` table + `/api/tutors/[slug]/inquiries` exist but are **dormant**; no UI.
- Push notifications **and** in-app notifications — no push tokens, no notifications written, no endpoints (`push_tokens`/`notifications` tables exist but unused).
- Post likes & comments UI — schema + triggers exist; build the interaction UI.
- Email (Resend) — transactional email + email verification (currently OFF).
- Calendar / per-date availability scheduling — matching uses recurring weekday ranges only.
- Tutor onboarding sample-profile carousel — placeholder only; needs real profiles first.
- University verification badge.

**Operational setup**
- Wire Twilio + the Supabase phone provider so phone OTP sends real SMS (steps under "Pending setup" below). Endpoints are already built.

**Engineering / data-model follow-ups** (full list in `plan.md §5/§7`)
- Custom-subject capture; drop vestigial single-enum `profiles` columns; `avatar_url` validation; align saved-filter languages to the expanded set; transactional multi-step writes; extend `GET /api/tutors` filters; automated test suite. *(Done in `0014`: tutor `experience` column, `teaching_levels`, education history, pay→min/max.)*

> **Already built** (previously deferred, now done): personalized matching feed, saved filter preferences (`GET`/`PUT /api/filters` + Quick Match card), the full filter set (languages, districts, format, type, subcategory, price, availability), tutor posts (creation + feed viewer), social login.

## Migrations note

`supabase/migrations/`: `0001_initial_schema.sql`, `0002_rls.sql` (canonical RLS), `0003_seeker_availability_and_matching.sql`, `0004_tutor_contact_columns.sql` (Instagram/WeChat), `0005_school_level_six_values.sql` (4→6 education levels), `0006_child_profiles.sql` (per-child seeker tables, owner-only), `0007_precise_availability.sql` (bucket→precise time ranges; rebuilds `seeker_availability` per-child), `0008_matching_rpc_rework.sql` (precise-overlap + price + per-child matching RPC), `0009_complete_onboarding.sql` (atomic one-shot onboarding writer), `0010_language_refinement.sql` (`tutor_languages` + student language/district lists; matching + onboarding updated to use them), `0011_storage_media_bucket.sql` (public `media` bucket + owner-only storage RLS for avatars/post media), `0012_oauth_role_default.sql` (new-user trigger defaults a missing/OAuth role to `student`; the OAuth callback sets the real role), `0013_delete_own_account.sql` (SECURITY DEFINER self-deletion: removes the auth user + non-cascading seeker_availability; media purged via Storage API in the endpoint), `0014_tutor_profile_extras.sql` (tutor `teaching_levels`, per-subject `experience`, education history + `lgbt` gender value; extends `complete_onboarding`). The stale `0002_rls_policies.sql` duplicate has been removed. **Applied to live Supabase:** 0001, 0002, 0004, 0005, 0006, 0007, 0008, 0009, 0010, 0011, 0012, 0013 (live). **`0014` is written but NOT yet applied — run it in the Supabase SQL editor.** **`0003` is superseded by 0007/0008 — do not apply it.** **All schema migrations are now written (0004–0014).**

---

## Frontend integration notes

> This section exists so backend sessions have the frontend contract without opening the
> `learnsum-mvp-expo-app` repo. It describes what the onboarding **in-memory store**
> collects per role, what API shapes the frontend expects, and the **naming/shape
> mismatches** that the onboarding write path must reconcile. (Source: the Expo app's
> `components/onboarding/onboardingStore.ts` + the `app/onboarding/*` screens.)

### How the store works
A generic in-memory key→value notebook (`usePersistentState`/`getStored`/`setStored`). It is **not** persisted to disk or backend; it survives only while the app is open. Nothing in onboarding currently calls the backend — the store is the staging area for the future one-shot write. Categories/districts use **hardcoded frontend slugs/labels**, not backend IDs.

### What each role collects (store keys → shapes)

**Student**
- `student:eduLevel` → one of `kindergarten | primary | middle | high | university | adult`
- `student:interests` → `Interest[]`, where `Interest = { catId, subId, category?, label?, color? }` (frontend slugs, e.g. `catId:"academics"`, `subId:"mathematics"`; user-typed customs are `subId:"custom-<ts>"`)
- `student:prefs` → `Prefs` (see below; student uses language **select** mode)

**Parent**
- `parent:roster` → `Child[]`, where `Child = { name: string, level: string|null }` (1–6 children; `level` is one of the 6 education levels)
- `parent:child:{i}:interests` → `Interest[]` (per child, `i` = 0-based index)
- `parent:child:{i}:prefs` → `Prefs` (per child)

**Tutor**
- `tutor:levels` → `Set<level>` (multi-select of the 6 education levels) — serialized to an array when forwarded
- `tutor:interests` → `Interest[]`
- `tutor:sd:details` → `Record<"<catId>:<subId>", Detail>` where
  `Detail = { years: string("0".."30+"), pay: number(100..3000; 3000 = "$3000+"), achievements: string[], experiences: Experience[], quals: Qualification[] }`,
  `Experience = { text, kind:"duration"|"event", dur, unit:"months"|"years", ongoing:boolean, year }`,
  `Qualification = { type?, detail?, test?, subject?, grade? }`
- `tutor:prefs` → `Prefs` (tutor uses language **proficiency** mode → `langLevels` populated)

**`Prefs`** (shared preferences shape, all roles)
```
format:     "in_person" | "online" | "both" | null
districts:  string[]   // each "<regionId>:<District Label>", e.g. "hk:Central & Western"; regionId ∈ hk|kln|nt
langs:      string[]   // select mode: main-language ids — "cantonese" | "mandarin" | "english"
moreLangs:  string[]   // select mode: extra-language LABELS — "Japanese", "Korean", ...
langLevels: Record<string, number>  // proficiency mode (tutor): language id → 1..4 (Beginner..Fluent)
avail:      Record<"mon".."sun", { start: number, end: number }[]>  // MINUTES from midnight; multiple ranges/day
```

### API response shapes the frontend expects
**As of now, no onboarding/feed/login screen is wired to the backend** — the feed and login are placeholders. So the only live contracts are what the backend already returns; build the frontend against these:
- **Auth from the app:** send the user's Supabase `access_token` as `Authorization: Bearer <token>` on every request (React Native cookie handling is unreliable). The backend also accepts the web cookie session; RLS is enforced under the token either way. (`src/lib/supabase/server.ts`)
- `GET /api/feed` → `{ feed: [{ slug, bio, created_at, display_name, avatar_url, district, categories: [{id,name_en,name_zh,slug}], score? }], personalized: bool, pagination: { page, page_size, total, has_more } }`
- `GET /api/tutors` → `{ tutors: [ same card shape minus score ], pagination }`
- `GET /api/tutors/[slug]` → `{ tutor: { ...profile, profiles{...}, tutor_subcategories[...], posts:[{...,post_media[]}] } }`
- `GET /api/auth/me` → `{ user, profile }`
- `GET/PUT /api/filters`, `GET/PUT /api/availability` → see `plan.md §5`

## Pending setup (not yet done — complete before testing phone auth)

### Twilio + Supabase phone auth
Phone OTP endpoints are built (`POST /api/auth/phone` + `POST /api/auth/phone/verify`) but will not send real SMS until the Supabase phone provider is wired up. Steps:

1. Sign up at twilio.com → from the Console dashboard copy **Account SID** and **Auth Token**
2. Buy a phone number with SMS capability (trial account gives one free number)
3. In Supabase dashboard: **Authentication → Providers → Phone** → toggle ON → select **Twilio** → paste Account SID, Auth Token, and the Twilio phone number → Save
4. Leave "Phone Confirm" OFF (consistent with email confirmation being off)
5. Optional (avoids real SMS costs in dev): scroll down on the same page to **Test OTP Numbers** → add e.g. `+85200000001` with token `123456`

Test once set up:
```bash
curl -s -X POST http://localhost:3000/api/auth/phone -H "Content-Type: application/json" -d '{"phone":"+85200000001","role":"student"}'
curl -s -X POST http://localhost:3000/api/auth/phone/verify -H "Content-Type: application/json" -d '{"phone":"+85200000001","token":"123456","role":"student"}'
```

### Naming / shape mismatches the write path must reconcile
| Frontend (store) | Backend (column/enum) | Mismatch |
|---|---|---|
| `Interest.catId/subId` (slugs) | `subcategories.id` (uuid) | Must map slugs → UUIDs (or seed DB to match); customs need a strategy |
| `eduLevel` / child `level` (6 values) | `school_level` enum | Rebuilt 4 → 6 in migration `0005` ✅ |
| `Prefs.format` | `tutoring_format(_pref)` | Values align (`in_person/online/both`) ✓ |
| `Prefs.districts` `"hk:Central & Western"` | `hk_district` enum `CentralWestern` | Strip region prefix + map label → enum; **multi → array** |
| `Prefs.langs` (ids) + `Prefs.moreLangs` (labels) | `preferred_languages text[]` | Reconciled by `/api/onboarding` → normalized lowercase list (0010) ✅ |
| `Prefs.langLevels` (tutor proficiency) | `tutor_languages(tutor_id, language, proficiency)` | Added in `0010` ✅ (written via `/api/onboarding`) |
| `Prefs.avail` minutes ranges | `*_availability.start_min/end_min` | Done in `0007` ✅ (precise ranges; parents per child) |
| `Detail.years` `"30+"` | `years_experience int` | Parse `"30+"` → 30 |
| `Detail.pay` single number | `hourly_rate_min/max` | Decide mapping (TODO) |
| `Detail.achievements` `string[]` | `achievements jsonb {en,zh}` | Wrap/translate |
| `Detail.quals` (structured) | `qualifications jsonb` | Serialize |
| `Detail.experiences` | *(none)* | Needs a column (TODO) |
| `parent:roster` + per-child keys | `child_profiles` (+ `child_category_interests`) | New tables added in `0006` ✅ |
