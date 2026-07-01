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
`tutor_profiles.is_published = true` makes a profile publicly visible (RLS enforces this). After onboarding a tutor stays **unpublished**; the tutor home screen shows a persistent "complete your profile" prompt → a dedicated screen for bio, photo, WhatsApp, WeChat and remaining details, then the tutor **explicitly publishes** (the app collects the initial publish/visibility choice on the onboarding review's publish sheet). Tutors can **self-unpublish** (set `is_published = false`) from their profile. An account is required for: posting content and in-app chat (live).

### Contact flow — WhatsApp / WeChat (+ live in-app chat)
Optional contact columns on `tutor_profiles`: `whatsapp_number`, `wechat_id` (`instagram_handle` exists from migration `0004` but **Instagram was dropped by the app** — the column is vestigial/unused). All optional, any combination; the profile shows every configured button. WhatsApp opens `wa.me/[number]?text=Hi, I found you on LearnSum and I'm interested in tutoring for [subject].`; WeChat copies the ID (no deep link). **Seekers (student/parent) now have their own `wechat_id`** on the shared `profiles` table (migration `0031`), edited from the app's **"Account information"** section via `PATCH /api/profiles/me`. **In-app chat is LIVE, both sides** (`/api/conversations*` + migration `0018`; REST-polled by the app). Off-app contact (WhatsApp/WeChat) is **tier- + quota-gated** and only shown to seekers for premium/deluxe tutors — see "Subscription tiers, contact gating & seeker privacy" below. **No inquiry form** (the `inquiries` table + endpoint remain dormant).

### Profile editing & account deletion (all roles)
Every role can edit its onboarding preferences from the profile screen and **delete its account**. Tutors edit: profile picture, bio, WhatsApp/WeChat, categories, availability, rates, districts, languages, and `is_published`. Students/parents edit any onboarding preference **plus their own `wechat_id`** (0031) from the "Account information" section. **Endpoint coverage complete:** `PATCH /api/profiles/me` (account + student/parent prefs + interests + `bio`/`phone`/`wechat_id`), `/api/children` + `/api/children/[id]` (parent children CRUD), `PUT /api/tutor/subjects` + `PUT /api/tutor/languages` (tutor subjects/languages), `PATCH /api/tutors/[slug]` (tutor profile/contacts/publish), `PUT /api/availability` (schedules), and `DELETE /api/profiles/me` (account deletion via SECURITY DEFINER 0013). **Change-password has no backend endpoint yet** (the app's Account-information Change-password sheet is UI-only).

### Bilingual content strategy
- System content (categories): parallel `name_en` / `name_zh` columns — pre-seeded and finite.
- Tutor free-text fields on `tutor_subcategories` (`jsonb`): `achievements` is stored `{"en": "...", "zh": "..."}`; **`qualifications` is the app's structured array** and **`exam_results` is unused** (the app folds exam grades into `qualifications`). *(The `{en,zh}` convention + the `PUT /api/tutor/subjects` validator don't match the app's actual shapes — see `plan.md §7` TODO.)*
- User-generated posts: parallel `content` / `content_zh` columns.

### Denormalized counters require triggers
`posts.likes_count` and `posts.comments_count` are denormalized; triggers on `post_likes` and `post_comments` maintain them (already in `0001`, recreated `SECURITY DEFINER` in `0019`; see `plan.md §4.4a`). Post **likes are live + wired** (`POST`/`DELETE`/`GET /api/posts/[id]/likes`, `liked_by_me` on the feed); **comments were dropped by the app** (`post_comments` schema stays dormant).

### `tutor_subcategories` — achievements/qualifications collected in onboarding
Onboarding collects `subcategory_id`, `years_experience`, pay, **and** `achievements`, `qualifications`, `exam_results` (the tutor "Strengths & Details" screen already collects them). It also collects a free-text "relevant experience" list (stored in `tutor_subcategories.experience` jsonb — migration `0014`) and a single pay figure per subject (mapped to both `hourly_rate_min`/`max`). Teaching levels + education history live on `tutor_profiles` (`teaching_levels`/`education`/`current_studies`, also `0014`). The app also collects **per-subject lesson format + districts** (`format`/`districts` — migration `0016`; **`districts` is now `text[]` of SUBDISTRICT slugs** like `causeway_bay` — migration `0021`, was `hk_district[]`) **and per-subject teaching levels** (`levels school_level[]` — migration `0020`; level selection moved into the per-subject Strengths & Details screen because a tutor can teach different age groups per subject — the tutor-level `teaching_levels` stays as the union). **`GET /api/tutors/[slug]` returns these jsonb/array fields per subject, plus the tutor's `tutor_languages` (language + proficiency) ✅.** Post-onboarding, a tutor edits subjects via **`PUT /api/tutor/subjects`** (full-replace; pre-validates subcategory ids before the destructive delete) and teaching languages via **`PUT /api/tutor/languages`** (full-replace) ✅.

### Parent children (NEW)
A parent's tutoring preferences are **per child**, not on the parent. Each child is a `child_profiles` row (name, `school_level`, format/type/budget, preferred languages/districts) with its own `child_category_interests` and availability. **Matching runs per child.** (Tables added in migration `0006`, owner-only/private ✅; per-child matching ✅ (0008), onboarding write ✅ (0009), and full children CRUD ✅ via `/api/children` + `/api/children/[id]` — schedules via `PUT /api/availability?child_id=`.)

### Availability — precise time ranges (REDESIGNED)
The current design stores **precise start/end minute ranges per weekday**, not `morning|afternoon|evening` buckets. The `time_slot` enum is removed; `tutor_availability` / `seeker_availability` use `start_min`/`end_min`; multiple ranges per day allowed. Written via `GET`/`PUT /api/availability` (role-routed; parents pass a `child_id`). **Done in migration `0007` ✅** (tables + endpoint reworked; children's per-child availability is code-complete but not live-testable until a children-creation endpoint exists).

### Two-sided matching (seeker → tutors)
`GET /api/feed` is personalized for an authenticated seeker (a `student`, or a `parent`'s `child`) with ≥1 category interest; everyone else (guests, tutors, seekers with no interests) gets the latest-tutors feed (`created_at` DESC, unfiltered). Ranking runs in the Postgres RPC `match_tutors_for_seeker(...)` (`SECURITY DEFINER`, caller via `auth.uid()`). **Weighting order, most → least important: subject/category → availability (real time-overlap) → price → preferred language → district** (district dropped for online-only tutors). Scoring is **soft** with **graceful degradation — never an empty state**; a dimension with no data on either side is dropped and remaining weights renormalize. Weights are an **operator-tunable config** (the integer literals in the matching migration) — **no end-user weight UI**. **Reworked in migration `0008` ✅** for precise time-overlap, a separate price dimension, the new weight order (subject 40 > availability 25 > price 15 > language 10 > district 7), and **per-child** matching; format/type are a minor tie-breaker (weight 3). `/api/feed` accepts a `child_id` for parents. **Matching reads the tutor-LEVEL `tutoring_format` + home `district`; the per-subject `format`/`districts` are stored but not yet read by the RPC — TODO: rework `match_tutors_for_seeker` to use them.** **Note (0021):** locations are now per-subject SUBDISTRICT slugs and seeker `preferred_districts` holds subdistrict slugs, so the RPC's `tutor_district = profiles.district` comparison no longer aligns (tutors don't set `profiles.district`) → district weighting in the feed is effectively inert until the RPC is reworked to compare seeker subdistricts vs `tutor_subcategories.districts`. **The live `GET /api/tutors` SEARCH already matches at subdistrict level** (array overlap on `tutor_subcategories.districts`); only the dormant feed RPC is pending (the seeker Home feed is sample-data on the frontend, so no user impact yet).

### Subscription tiers, contact gating & seeker privacy (built + live)
Monetization is **tutor-side only** (seekers are never charged). `tutor_profiles.tier` (`free`/`premium`/`deluxe`, migration `0024`; `PATCH /api/tutor/tier`, surfaced by `me` + `GET /api/tutors/[slug]` via `select('*')`) gates how the two sides reach each other:
- **Contact unlocks + daily quota** (`tutor_contact_unlocks`, migration `0025`): a tutor spends a daily quota (`free 0 / premium 1 / deluxe 3`) to **permanently** unlock a seeker's contact + chat. `GET /api/tutor/contact-quota` · `POST /api/tutor/contact-unlocks`. **Reply gating is enforced server-side** — a tutor's chat send `403`s until they've unlocked the seeker.
- **Seeker read for tutors:** `GET /api/seekers/[id]` via the `get_seeker_for_tutor` SECURITY DEFINER RPC (migration `0029`). Visibility rule: a tutor sees a seeker's details when the seeker is **public OR has messaged the tutor**; PII/phone withheld unless the seeker's `share_personal_info` (phone also needs an unlock). The RPC returns the seeker's contact `wechat → NULL` (seeker WeChat is self-view only, not yet exposed to tutors).
- **Seeker privacy toggles** (`profiles.is_discoverable` + `share_personal_info`, migration `0029`, default true): discoverable = appears in seeker search; share = include name/age/education/phone (off = minimal card).
- **Seeker search:** `GET /api/seekers` via the `search_seekers` RPC (public/discoverable seekers only; level + name/subject text filter). `0030` revokes the seeker RPCs from `anon`.
- **Profile views ("who viewed you"):** `profile_views` (migration `0026`) + `POST /api/tutors/[slug]/views` (record) + `GET /api/tutor/profile-views` (list). Tier-gated on the app: free = locked · premium = count + anonymized · deluxe = full.
- **Tutor-side saved (mixed tutors + seekers):** `saved_people` (migration `0027`) + `GET/POST/DELETE /api/saved/people` (distinct from the seeker-side `/api/saved`).
- **Child age:** `child_profiles.age` (migration `0028`; written by `complete_onboarding`, read by `me` + the seeker read).

### Session persistence — refresh + logout revocation
The app holds the Supabase session itself (no cookies in React Native — Bearer transport, `src/lib/supabase/server.ts`). To keep users logged in across cold starts and past the ~1h access-token expiry:
- **`POST /api/auth/refresh` `{ refresh_token }` → `{ user, session }`** — `supabase.auth.refreshSession({ refresh_token })`; the app stores the refresh token and calls this on a 401 (auto-retry). A rejected token returns `401` and the app logs out.
- **`POST /api/auth/logout`** now **revokes the refresh token(s)** server-side (GoTrue `scope=global`, authorized by the caller's access token, falling back to minting one from a posted `refresh_token` when the access token is expired). The old cookie-based `supabase.auth.signOut()` was a no-op for the Bearer/RN app.

## TODO (eventually)

No launch deadline — everything here is intended for build at some point, in no fixed order. Nothing is "cut"; it's just not built yet. Several already have dormant schema/endpoints in the repo (noted inline) — switch them on, don't rebuild from scratch.

**Pending features**
- In-app chat / messaging — **live, both sides** (`/api/conversations*` + migration 0018; **frontend wired Jun 27** via REST polling — `components/chat/*`, `app/messages/*`, a "Message" button on tutor profiles, unread/mark-read). The app polls (no Supabase client), so 0018's Realtime publication is **ready but unused**; swapping to live push later = add `@supabase/supabase-js`. WhatsApp/WeChat remain as alternative contact.
- Inquiry form — `inquiries` table + `/api/tutors/[slug]/inquiries` exist but are **dormant**; no UI.
- Push notifications **and** in-app notifications — no push tokens, no notifications written, no endpoints (`push_tokens`/`notifications` tables exist but unused).
- Post likes — **live + frontend-wired** on the tutor-profile post feed (`POST`/`DELETE`/`GET /api/posts/[id]/likes`; `liked_by_me` on the feed). Comments were dropped by the app (schema stays dormant). *(The seeker + tutor Home feeds' likes are still local sample state.)*
- Email (Resend) — transactional email + email verification (currently OFF).
- Calendar / per-date availability scheduling — matching uses recurring weekday ranges only.
- Tutor onboarding sample-profile carousel — placeholder only; needs real profiles first.
- University verification badge.

**Operational setup**
- Wire Twilio + the Supabase phone provider so phone OTP sends real SMS (steps under "Pending setup" below). Endpoints are already built.

**Engineering / data-model follow-ups** (full list in `plan.md §5/§7`)
- Custom-subject capture; drop vestigial single-enum `profiles` columns; `avatar_url` validation; align saved-filter languages to the expanded set; transactional multi-step writes; automated test suite. *(Done in `0014`: tutor `experience` column, `teaching_levels`, education history, pay→min/max. Done in build round 2: `GET /api/tutors` browse filters extended to age / gender / language / multi-district.)*

> **Already built** (previously deferred, now done): personalized matching feed, saved filter preferences (`GET`/`PUT /api/filters` + Quick Match card), the full filter set (languages, districts, format, type, subcategory, price, availability), tutor posts (creation + feed viewer), social login. **Build round 2 (Jun 26):** post **likes** endpoint (B1), **search filters** for age/gender(multi)/language/multi-district on `GET /api/tutors` (D1/D2/D4), **saved/bookmarked tutors** (`/api/saved`, H3), and the **in-app chat backend** (Realtime + read receipts, B2) + **per-subject teaching levels** (0020). Migrations 0017–0020 applied. **Frontend wired (same day):** seeker **Search** tab → real `GET /api/tutors` (FilterSheet → query params), **Saved** tab → `/api/saved`, post **likes** on the tutor-profile post feed. **B2 chat** UI wired (Jun 27) via REST polling — list + thread (`components/chat/*`), `app/messages/*` routes, "Message" button on tutor profiles. **Both Search tabs (seeker + tutor) are now real** (`GET /api/tutors`), so tutor↔tutor and seeker→tutor find+message both work (tutor must be published to appear). Still sample/deferred: only the seeker **Home** feed + its like/save. **Rounds 3–5 (Jun 28 – Jul 1), all applied + live:** subdistrict locations (`0021`), seeker profile bio/phone + student education (`0022`/`0023`), **subscription tiers + contact unlocks + profile views + tutor-saved-people + child age + seeker visibility/search** (`0024`–`0030`), and the app's **"Account information"** section incl. seeker `wechat_id` (`0031`) + **session persistence** (`POST /api/auth/refresh` + logout revocation — routes only, no migration). See `FRONTEND_WIRING.md` §3.7/§3.10 + `BACKEND_GAP_ANALYSIS.md`.

## Migrations note

`supabase/migrations/`: `0001_initial_schema.sql`, `0002_rls.sql` (canonical RLS), `0003_seeker_availability_and_matching.sql`, `0004_tutor_contact_columns.sql` (Instagram/WeChat), `0005_school_level_six_values.sql` (4→6 education levels), `0006_child_profiles.sql` (per-child seeker tables, owner-only), `0007_precise_availability.sql` (bucket→precise time ranges; rebuilds `seeker_availability` per-child), `0008_matching_rpc_rework.sql` (precise-overlap + price + per-child matching RPC), `0009_complete_onboarding.sql` (atomic one-shot onboarding writer), `0010_language_refinement.sql` (`tutor_languages` + student language/district lists; matching + onboarding updated to use them), `0011_storage_media_bucket.sql` (public `media` bucket + owner-only storage RLS for avatars/post media), `0012_oauth_role_default.sql` (new-user trigger defaults a missing/OAuth role to `student`; the OAuth callback sets the real role), `0013_delete_own_account.sql` (SECURITY DEFINER self-deletion: removes the auth user + non-cascading seeker_availability; media purged via Storage API in the endpoint), `0014_tutor_profile_extras.sql` (tutor `teaching_levels`, per-subject `experience`, education history + `lgbt` gender value; extends `complete_onboarding`), `0015_seed_taxonomy.sql` (reseeds categories/subcategories to mirror the Expo app's subject slugs — frontend = source of truth; **destructive**: drops + recreates the taxonomy), `0016_tutor_subcategory_format_districts.sql` (per-subject lesson `format` + `districts` on `tutor_subcategories`; extends `complete_onboarding`), `0017_saved_tutors.sql` (saved/bookmarked tutors — `saved_tutors` table, owner-only RLS; backs the Saved tab), `0018_chat_realtime.sql` (turns on in-app chat — adds `conversations`/`messages` to the `supabase_realtime` publication + a `messages` UPDATE policy for read receipts), `0019_counter_triggers_security_definer.sql` (fixes a latent bug from 0001: the `likes_count`/`comments_count` trigger functions ran as the caller, so RLS `posts: owner update` blocked a non-owner's like from bumping the counter — recreated them `SECURITY DEFINER`, with `EXECUTE` revoked from anon/authenticated, + a one-off count backfill), `0020_tutor_subcategory_levels.sql` (per-subject teaching levels — `levels school_level[]` on `tutor_subcategories`; the app moved teaching-level selection into the per-subject Strengths & Details screen since a tutor can teach different age groups per subject; extends `complete_onboarding`), `0021_subdistricts.sql` (**locations moved from 18 coarse `hk_district` enum values to ~88 SUBDISTRICTS stored as text slugs** — `tutor_subcategories.districts` altered `hk_district[]` → `text[]`; seeker `preferred_districts` already `text[]` now holds subdistrict slugs; `complete_onboarding` drops the `::hk_district[]` cast. **Frontend is the source of truth** for the subdistrict list — `hk_district` enum left in place but vestigial), `0022_profile_bio_phone.sql` (`profiles.bio`/`phone` + `complete_onboarding` writes `avatar_url`/`bio`/`phone`), `0023_seeker_education.sql` (`student_profiles.education` jsonb — full per-level school history), `0024_tutor_tier.sql` (`tutor_profiles.tier` free/premium/deluxe + CHECK), `0025_contact_unlocks.sql` (`tutor_contact_unlocks` + daily quota; server-side chat reply gating), `0026_profile_views.sql` (`profile_views` + record/list endpoints), `0027_saved_people.sql` (`saved_people` — tutor-side mixed tutor+seeker saves), `0028_child_age.sql` (`child_profiles.age`), `0029_seeker_visibility.sql` (`profiles.is_discoverable`/`share_personal_info` + the `get_seeker_for_tutor` / `search_seekers` SECURITY DEFINER RPCs), `0030_revoke_rpc_anon.sql` (revoke the seeker RPCs from `anon`), `0031_profile_wechat.sql` (`profiles.wechat_id` — seeker WeChat for the "Account information" section). The stale `0002_rls_policies.sql` duplicate has been removed. **`0003` is superseded by 0007/0008 — do not apply it.** **Applied to live Supabase: `0001`–`0031` are ALL live** (0001–0018 + 0022–0030 applied manually via the SQL editor; 0019–0021 + 0031 via the Supabase MCP tool). Heads-up: manual applies aren't recorded in `supabase_migrations.schema_migrations`, so `list_migrations` under-reports — the **live schema (`list_tables`) is authoritative**, and it confirms every column/table/RPC above exists.

---

## Adding new features — frontend-first workflow

New features land in the **frontend repo (`learnsum-mvp-expo-app`) first** (for a live
preview), then the backend is built to support them. When the user says they've added a
feature, follow this loop — **do NOT auto-build from the frontend code**:

1. **Locate what's new.** The frontend repo is on the same machine at
   `../learnsum-mvp-expo-app` (sibling of this repo). Read it **directly** — never ask the
   user to type functions out. Narrow the scan with what the user points at, or use the
   frontend's recent git history (`git -C ../learnsum-mvp-expo-app log` / `diff`) to see
   exactly what changed since last time, rather than re-scanning the whole app.
2. **Gap-analyse, don't assume.** Much of the frontend is **prototype / sample UI that was
   never meant to become a real backend feature** (e.g. stories, follows / "Connect",
   ratings, followers, analytics, premium/payments). For each new frontend capability the
   backend can't support, give a short **build / skip / defer** recommendation. See
   `BACKEND_GAP_ANALYSIS.md` for the format and the standing decisions.
3. **Get the user's call.** The user owns the product decision of which prototype ideas
   become real — **never build a new system (table / endpoint) off frontend code alone.**
   Wait for an explicit "build these".
4. **Build the approved items** + write the migration. Migrations are applied **manually**
   by the user in the Supabase SQL editor, so always tell them to run the new file.
5. **Keep the docs honest.** Update this file / `plan.md` / `BACKEND_GAP_ANALYSIS.md` so a
   future session isn't misled (e.g. flip a "no DB home yet" note to the migration that
   added it).

Rationale: the bottleneck is *deciding* what's real, not *gathering* the feature list —
reading the code is accurate and effort-free, but database changes are hard to reverse, so
the human approval gate stays. (`FRONTEND_WIRING.md` maps each screen to the endpoint it
should call.)

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
districts:  string[]   // SUBDISTRICT slugs, e.g. "causeway_bay" (0021); stored as text[]
langs:      string[]   // select mode: main-language ids — "cantonese" | "mandarin" | "english"
moreLangs:  string[]   // select mode: extra-language LABELS — "Japanese", "Korean", ...
langLevels: Record<string, number>  // proficiency mode (tutor): language id → 1..4 (Beginner..Fluent)
avail:      Record<"mon".."sun", { start: number, end: number }[]>  // MINUTES from midnight; multiple ranges/day
```

### API response shapes the frontend expects
**Most screens are now wired to the backend** — auth (signup/login/**refresh**/logout), the one-shot onboarding save (all roles), both Search tabs (`GET /api/tutors`), Saved (`/api/saved`), in-app chat (`/api/conversations*`), post likes, subscription tiers + contact gating, seeker search (`/api/seekers`), and profile editing incl. the **Account information** section. The seeker **Home** post-feed stays **sample data** by decision (no post-stream endpoint). Key live contracts:
- **Auth from the app:** send the user's Supabase `access_token` as `Authorization: Bearer <token>` on every request (React Native cookie handling is unreliable). The backend also accepts the web cookie session; RLS is enforced under the token either way. (`src/lib/supabase/server.ts`) The app stores the **refresh token** too and calls `POST /api/auth/refresh` on a 401 to stay logged in past the ~1h access-token expiry.
- `GET /api/feed` → `{ feed: [{ slug, bio, created_at, display_name, avatar_url, district, categories: [{id,name_en,name_zh,slug}], score? }], personalized: bool, pagination: { page, page_size, total, has_more } }`
- `GET /api/tutors` → `{ tutors: [ same card shape minus score ], pagination }`
- `GET /api/tutors/[slug]` → `{ tutor: { ...profile, profiles{...}, tutor_subcategories[...], posts:[{...,post_media[]}] } }`
- `GET /api/auth/me` → `{ user, profile, detail }` — `detail` is the role block: student → `{ student_profile, interest_subcategory_ids }`, parent → `{ parent_profile, children[] }`, tutor → `{ tutor_profile, subjects, languages }`. `profile` + `*_profile` use `select('*')`, so newer columns (`bio`/`phone`/`wechat_id`/`is_discoverable`/`share_personal_info`, `tier`, student `education`, child `age`) come through with no route change.
- `POST /api/auth/refresh` `{ refresh_token }` → `{ user, session }`; `POST /api/auth/logout` (Bearer + optional `{ refresh_token }`) → revokes the refresh token(s)
- `GET /api/seekers` (search) · `GET /api/seekers/[id]` (tutor reads a seeker) · `GET /api/tutor/contact-quota` · `POST /api/tutor/contact-unlocks` · `PATCH /api/tutor/tier` · `GET /api/tutor/profile-views`
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
| `Interest.catId/subId` (slugs) | `subcategories.id` (uuid) | **Resolved (0015):** DB taxonomy seeded to mirror the frontend slugs (frontend = source of truth), so `/api/onboarding` maps by slug. User-typed customs still need a strategy. |
| `eduLevel` / child `level` (6 values) | `school_level` enum | Rebuilt 4 → 6 in migration `0005` ✅ |
| `Prefs.format` | `tutoring_format(_pref)` | Values align (`in_person/online/both`) ✓ |
| `Prefs.districts` (subdistrict slugs, e.g. `causeway_bay`) | `text[]` (`preferred_districts` / `tutor_subcategories.districts`) | Stored as-is — frontend owns the subdistrict list (0021); **multi → array** |
| `Prefs.langs` (ids) + `Prefs.moreLangs` (labels) | `preferred_languages text[]` | Reconciled by `/api/onboarding` → normalized lowercase list (0010) ✅ |
| `Prefs.langLevels` (tutor proficiency) | `tutor_languages(tutor_id, language, proficiency)` | Added in `0010` ✅ (written via `/api/onboarding`) |
| `Prefs.avail` minutes ranges | `*_availability.start_min/end_min` | Done in `0007` ✅ (precise ranges; parents per child) |
| `Detail.years` `"30+"` | `years_experience int` | Parse `"30+"` → 30 |
| `Detail.pay` single number | `hourly_rate_min/max` | Decide mapping (TODO) |
| `Detail.achievements` `string[]` | `achievements jsonb {en,zh}` | Wrap/translate |
| `Detail.quals` (structured) | `qualifications jsonb` | Serialize |
| `Detail.experiences` | *(none)* | Needs a column (TODO) |
| `parent:roster` + per-child keys | `child_profiles` (+ `child_category_interests`) | New tables added in `0006` ✅ |
