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
- **Email:** Resend (transactional) — **not wired in v1** (email verification off, notifications out)
- **Deploy:** Vercel (API server only — no SSR pages, no static assets)

> **Note:** This repository contains the backend API only. There is no frontend code here. All UI, screens, and components live in the `learnsum-mvp-expo-app` repository.

Development environment: macOS, Terminal. Use bash-compatible commands for all testing instructions.

Testing commands must always be single-line bash commands. Never use multi-line curl syntax.

## Architecture Decisions

### Three user roles
`parent` | `student` | `tutor` — stored as an enum on the `profiles` table which extends `auth.users`. Each role has detail tables: `student_profiles`, `parent_profiles`, `tutor_profiles`, plus **`child_profiles`** (one row per child of a parent — NEW, see "Parent children" below).

### Onboarding & auth — credentials last (Option A)
A guest browses freely; onboarding collects everything first and **email + password are entered on the final step**. Submitting credentials creates the Supabase account and writes all collected onboarding data in one shot. **Email verification is OFF**, so `signup` returns a live session and the write happens under the new user (no service-role key needed). **Social login (Google/Apple/Microsoft) is in v1** alongside email/password. The one-shot onboarding write endpoint is **`POST /api/onboarding` ✅** — it maps the frontend's slugs/labels to backend IDs/enums and persists the role's data atomically via the `complete_onboarding()` function (migration `0009`); custom subjects + tutor levels/proficiency/experience are skipped and reported (no DB home yet). See `plan.md §5/§9`.

### Tutor profiles are public, but not auto-published
`tutor_profiles.is_published = true` makes a profile publicly visible (RLS enforces this). After onboarding a tutor stays **unpublished**; the tutor home screen shows a persistent "complete your profile" prompt → a dedicated screen for bio, photo, WhatsApp, Instagram, WeChat and remaining details, then the tutor **explicitly publishes**. Tutors can **self-unpublish** (set `is_published = false`) from their profile. An account is required for: posting content and (dormant) chat.

### Contact flow — WhatsApp / Instagram / WeChat
Three optional columns on `tutor_profiles`: `whatsapp_number`, `instagram_handle`, `wechat_id` (the latter two added in migration `0004` ✅). All optional, any combination; the profile page shows every configured button simultaneously. WhatsApp opens `wa.me/[number]?text=Hi, I found you on LearnSum and I'm interested in tutoring for [subject].`; Instagram opens the profile; WeChat opens with the WeChat ID. **No inquiry form** (the `inquiries` table + endpoint remain but are dormant). **No in-app messaging in v1.**

### Profile editing & account deletion (all roles)
Every role can edit its onboarding preferences from the profile screen and **delete its account**. Tutors edit: profile picture, bio, WhatsApp/Instagram/WeChat, categories, availability, rates, districts, languages, and `is_published`. Students/parents edit any onboarding preference. (Endpoint coverage is partial — TODO in `plan.md §5`.)

### Bilingual content strategy
- System content (categories): parallel `name_en` / `name_zh` columns — pre-seeded and finite.
- Tutor free-text fields (`achievements`, `qualifications`, `exam_results` on `tutor_subcategories`): `jsonb` `{"en": "...", "zh": "..."}`.
- User-generated posts: parallel `content` / `content_zh` columns.

### Denormalized counters require triggers
`posts.likes_count` and `posts.comments_count` are denormalized; triggers on `post_likes` and `post_comments` maintain them (already in `0001`; see `plan.md §4.4a`). Likes/comments **UI is out of v1** — schema only.

### `tutor_subcategories` — achievements/qualifications are v1
v1 onboarding collects `subcategory_id`, `years_experience`, pay, **and** `achievements`, `qualifications`, `exam_results` (the tutor "Strengths & Details" screen already collects them). It also collects a free-text "relevant experience" list (needs a column — TODO) and a single pay figure per subject (map to `hourly_rate_min`/`max` — TODO).

### Parent children (NEW)
A parent's tutoring preferences are **per child**, not on the parent. Each child is a `child_profiles` row (name, `school_level`, format/type/budget, preferred languages/districts) with its own `child_category_interests` and availability. **Matching runs per child.** (Tables added in migration `0006`, owner-only/private ✅; per-child matching + onboarding write still TODO.)

### Availability — precise time ranges (REDESIGNED)
v1 stores **precise start/end minute ranges per weekday**, not `morning|afternoon|evening` buckets. The `time_slot` enum is removed; `tutor_availability` / `seeker_availability` use `start_min`/`end_min`; multiple ranges per day allowed. Written via `GET`/`PUT /api/availability` (role-routed; parents pass a `child_id`). **Done in migration `0007` ✅** (tables + endpoint reworked; children's per-child availability is code-complete but not live-testable until a children-creation endpoint exists).

### Two-sided matching (seeker → tutors)
`GET /api/feed` is personalized for an authenticated seeker (a `student`, or a `parent`'s `child`) with ≥1 category interest; everyone else (guests, tutors, seekers with no interests) gets the latest-tutors feed (`created_at` DESC, unfiltered). Ranking runs in the Postgres RPC `match_tutors_for_seeker(...)` (`SECURITY DEFINER`, caller via `auth.uid()`). **v1 weighting order, most → least important: subject/category → availability (real time-overlap) → price → preferred language → district** (district dropped for online-only tutors). Scoring is **soft** with **graceful degradation — never an empty state**; a dimension with no data on either side is dropped and remaining weights renormalize. Weights are an **operator-tunable config** (the integer literals in the matching migration) — **no end-user weight UI in v1**. **Reworked in migration `0008` ✅** for precise time-overlap, a separate price dimension, the new weight order (subject 40 > availability 25 > price 15 > language 10 > district 7), and **per-child** matching; format/type are a minor tie-breaker (weight 3). `/api/feed` accepts a `child_id` for parents.

## What is explicitly out of v1

Do not build these even if they seem natural extensions of adjacent work:

- In-app chat / messaging — `conversations`/`messages` schema + `/api/conversations*` exist but are **dormant** (planned v2). Contact is WhatsApp/Instagram/WeChat.
- Inquiry form — `inquiries` table + `/api/tutors/[slug]/inquiries` exist but are **dormant**.
- Push notifications **and** in-app notifications — **fully out** (no push tokens, no notifications written, no endpoints).
- Post likes & comments UI (schema + triggers exist, hold the UI).
- Calendar / per-date availability scheduling (matching uses recurring weekday ranges only).
- Tutor onboarding sample-profile carousel (placeholder only — needs real profiles).
- University verification badge.

> **Now IN v1** (previously deferred): personalized matching feed, saved filter preferences (`GET`/`PUT /api/filters` + Quick Match card), the full filter set (languages, districts, format, type, subcategory, price, availability), tutor posts (creation + feed viewer), social login.

## Migrations note

`supabase/migrations/`: `0001_initial_schema.sql`, `0002_rls.sql` (canonical RLS), `0003_seeker_availability_and_matching.sql`, `0004_tutor_contact_columns.sql` (Instagram/WeChat), `0005_school_level_six_values.sql` (4→6 education levels), `0006_child_profiles.sql` (per-child seeker tables, owner-only), `0007_precise_availability.sql` (bucket→precise time ranges; rebuilds `seeker_availability` per-child), `0008_matching_rpc_rework.sql` (precise-overlap + price + per-child matching RPC), `0009_complete_onboarding.sql` (atomic one-shot onboarding writer), `0010_language_refinement.sql` (`tutor_languages` + student language/district lists; matching + onboarding updated to use them). The stale `0002_rls_policies.sql` duplicate has been removed. **Applied to live Supabase:** 0001, 0002, 0004, 0005, 0006, 0007, 0008, 0009. **Not yet applied:** 0010. **`0003` is superseded by 0007/0008 — do not apply it.** **All v1 schema migrations are now written (0004–0010).**

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
- `GET /api/feed` → `{ feed: [{ slug, bio, created_at, display_name, avatar_url, district, categories: [{id,name_en,name_zh,slug}], score? }], personalized: bool, pagination: { page, page_size, total, has_more } }`
- `GET /api/tutors` → `{ tutors: [ same card shape minus score ], pagination }`
- `GET /api/tutors/[slug]` → `{ tutor: { ...profile, profiles{...}, tutor_subcategories[...], posts:[{...,post_media[]}] } }`
- `GET /api/auth/me` → `{ user, profile }`
- `GET/PUT /api/filters`, `GET/PUT /api/availability` → see `plan.md §5`

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
