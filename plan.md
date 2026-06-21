---

# LearnSum MVP — Product & Technical Plan

> **Repo naming:** this backend repo is `learnsum-mvp-back`; the React Native + Expo
> frontend is `learnsum-mvp-expo-app`. (Folders are being renamed to these; treat
> them as canonical in all docs.)
>
> **This document is the source of truth for the backend schema + API.** It reflects
> the product decisions agreed for the current build. Where a decision implies
> schema/API work that is not yet written, it is called out inline with **TODO**.

## 1. Product Overview

Hong Kong-based two-sided tutoring marketplace with a social media layer.

**Three user types:** Parent · Student · Tutor

**Core philosophy:**
- **Browse is public; the account is created up front, the data saved at the end.** A guest
  can browse the whole app. When they start a role's flow they **sign up / log in first**
  (credentials first — see §9), then answer the onboarding questions under the live session;
  the one-shot write persists everything at the end.
- Tutor profiles work like Instagram — bio block + scrollable post feed.
- Two-way discovery — parents/students find tutors via a personalized, weighted feed.
- **Contact is WhatsApp / Instagram / WeChat** (all optional, any combination). No
  in-app inquiry form, no in-app chat yet (see TODO).

---

## 2. Three Core Features

**1. Tutor Social Profile** — supply-side value proposition
Bio block: photo, display name, university, categories, pricing, personal description,
plus per-subject achievements / qualifications / experience. Below: scrollable post feed
(text, photos, video). A tutor's profile is **not auto-published**: after onboarding
`is_published` stays `false` and the tutor home screen shows a persistent "complete your
profile" prompt leading to a dedicated screen (bio, photo, WhatsApp, Instagram, WeChat,
remaining details) where they explicitly publish. Tutors can later unpublish themselves.

**2. Public Browse + Full Filters + Personalized Feed** — demand-side discovery + SEO
Public browse of published tutors. The home feed is **personalized by a weighted matching
algorithm** for seekers (see §6). Filters are the **full saved-filter set**:
preferred languages, districts, tutoring format, tutoring type, subcategory, price
min/max, and availability. Saved filter preferences are auth-gated and surfaced via a
**Quick Match** card on the home screen.

**3. WhatsApp / Instagram / WeChat Contact** — closes the marketplace loop
Each tutor may set any combination of three optional contact methods. On the tutor
profile page, **all configured contact buttons show simultaneously**:
- **WhatsApp** → `https://wa.me/[number]?text=...` pre-filled with
  `Hi, I found you on LearnSum and I'm interested in tutoring for [subject].`
- **Instagram** → opens the tutor's Instagram profile.
- **WeChat** → opens WeChat with the tutor's WeChat ID.

No inquiry form and no backend booking logic yet (see TODO). (The `inquiries` table and its
endpoint remain in the codebase but are **dormant** — see §4.6 / §5.)

---

## 3. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Backend API | Next.js 16 (App Router) | API routes only — no frontend pages or UI in this repo. Dynamic route handlers must `await params` (Promise in Next 15+). |
| Frontend | React Native + Expo (separate repo: `learnsum-mvp-expo-app`) | Mobile-first UI, separate from the API server |
| Backend + DB | Supabase | Auth + Postgres + Storage |
| Email | Resend (transactional) | **Not wired yet** (see TODO) — email verification is OFF and notifications are not built |
| Deploy | Vercel | API server only — zero-config, Next.js native |

> **Not wired yet (see TODO):** Supabase Realtime / chat, Expo Push / FCM (no
> push notifications built yet).

---

## 4. Database Schema

> Migrations live in `supabase/migrations/`, applied manually via the Supabase SQL editor.
> Current files: `0001_initial_schema.sql`, `0002_rls.sql` (canonical RLS), `0003_seeker_availability_and_matching.sql`,
> `0004_tutor_contact_columns.sql`, `0005_school_level_six_values.sql`, `0006_child_profiles.sql`, `0007_precise_availability.sql`, `0008_matching_rpc_rework.sql`, `0009_complete_onboarding.sql`, `0010_language_refinement.sql`, `0011_storage_media_bucket.sql`, `0012_oauth_role_default.sql`, `0013_delete_own_account.sql`, `0014_tutor_profile_extras.sql`, `0015_seed_taxonomy.sql`, `0016_tutor_subcategory_format_districts.sql`. (The stale `0002_rls_policies.sql`
> duplicate has been removed; 0003 is superseded by 0007/0008.) **Done:** 0004 (contact columns), 0005 (6-value education enum), 0006 (per-child seeker tables), 0007 (precise availability), 0008 (reworked matching RPC), 0009 (atomic onboarding writer), 0010 (multi-language model), 0011 (media storage bucket + RLS), 0012 (OAuth-tolerant new-user trigger), 0013 (self-service account deletion), 0014 (tutor profile extras — teaching levels, per-subject experience, education history, `lgbt` gender), 0015 (reseed taxonomy to mirror the app's subject slugs — destructive), 0016 (per-subject lesson format + districts).
> **All schema migrations are now written and applied (0004–0016).**

### 4.1 Auth & Core Profiles

**`profiles`** — extends `auth.users`, one row per account
```
id                  uuid        PK  FK → auth.users
role                enum        'parent' | 'student' | 'tutor'
full_name           text
display_name        text
avatar_url          text
age                 int
gender              enum        'male' | 'female' | 'other' | 'prefer_not_to_say'
onboarding_done     bool        default false
created_at          timestamptz
updated_at          timestamptz
```
> **Changed:** per-person *preferred languages* and *preferred districts* are now
> multi-valued and live on the seeker detail tables (below), not as single enums on
> `profiles`. **TODO (migration):** drop/relax `profiles.preferred_language` and
> `profiles.district` single-enum columns, or keep one as an optional "primary/home" value.
> `school_name` is no longer collected in onboarding.

**`student_profiles`** — one-to-one with profiles where role = 'student' (a *seeker*)
```
id                      uuid    PK  FK → profiles
school_level            enum    'kindergarten' | 'primary' | 'middle' | 'high' | 'university' | 'adult'
tutoring_format_pref    enum    'online' | 'in_person' | 'both'
tutoring_type_pref      enum    'individual' | 'group' | 'both'
budget_max_per_hour     int     HKD
preferred_languages     text[]  expanded language set (see §4.2a)
preferred_districts     text[]  array of district enums (see §4.10)
```
> **DONE (migration 0005):** `school_level` rebuilt to the 6 values
> (`kindergarten`, `primary`, `middle`, `high`, `university`, `adult`); legacy `secondary` removed (mapped to `middle`).
> **DONE (migration 0010):** added `preferred_languages` / `preferred_districts` text[].

**`parent_profiles`** — one-to-one with profiles where role = 'parent'
```
id                      uuid    PK  FK → profiles
searching_for_self      bool    default false
```
> A parent does **not** hold tutoring preferences directly — each child does (below).

**`child_profiles`** — NEW. One row per child of a parent account (a *seeker*)
```
id                      uuid    PK
parent_id               uuid    FK → profiles (role = 'parent')
name                    text
school_level            enum    same 6-value enum as student_profiles
tutoring_format_pref    enum    'online' | 'in_person' | 'both'
tutoring_type_pref      enum    'individual' | 'group' | 'both'
budget_max_per_hour     int     HKD
preferred_languages     text[]
preferred_districts     text[]
created_at              timestamptz
```
> **DONE (migration 0006):** created `child_profiles` with owner-only RLS (private — children
> are minors; matching reads via the SECURITY DEFINER RPC). A parent can have 1–6 children, each
> with its own interests + availability (below). Matching runs **per child** (§6).

**`tutor_profiles`** — one-to-one with profiles where role = 'tutor'
```
id                  uuid   PK  FK → profiles
slug                text   UNIQUE  (SEO: /tutors/[slug])
bio                 text
bio_zh              text   Traditional Chinese bio
university          text
tutoring_format     enum   'online' | 'in_person' | 'both'
tutoring_type       enum   'individual' | 'group' | 'both'
whatsapp_number     text   optional contact
instagram_handle    text   optional contact   — NEW
wechat_id           text   optional contact   — NEW
is_published        bool   default false       (stays false until tutor explicitly publishes)
created_at          timestamptz
updated_at          timestamptz
```
> **DONE (migration 0004):** added `instagram_handle`, `wechat_id` (wired into `POST`/`PATCH`/`GET /api/tutors/[slug]`). Tutor teaching
> languages + proficiency live in **`tutor_languages` `(tutor_id, language, proficiency 1..4)` —
> added in migration 0010 ✅** and written via `/api/onboarding` (proficiency is display-only).

---

### 4.2 Categories & Subjects

**`categories`** — pre-seeded, not user-created
```
id       uuid  PK
name_en  text  (e.g. "Sports")
name_zh  text  (e.g. "體育")
slug     text  UNIQUE
```

**`subcategories`**
```
id           uuid  PK
category_id  uuid  FK → categories
name_en      text  (e.g. "Basketball")
name_zh      text
slug         text  UNIQUE
```

> **Frontend mismatch — RESOLVED (0015):** the `categories`/`subcategories` taxonomy is
> **seeded to mirror the frontend's hardcoded slugs** (`"sports"`, `"basketball"`, … —
> frontend = source of truth), so `/api/onboarding` maps each subject by slug with nothing
> dropped. `0015` is **destructive** (drops + recreates the taxonomy, cascading to existing
> subject links — fine pre-launch). User-typed **custom** subjects still need a capture strategy.

**Interest junction tables** — drive feed matching
```
user_category_interests   (id, profile_id  FK → profiles,       subcategory_id, UNIQUE(profile_id, subcategory_id))   — students
child_category_interests  (id, child_id    FK → child_profiles, subcategory_id, UNIQUE(child_id, subcategory_id))     — NEW, per child
```
> **DONE (migration 0006):** added `child_category_interests` (owner-only via the child's parent).

**`tutor_subcategories`** — what a tutor teaches, with per-subject detail
```
id                  uuid   PK
tutor_id            uuid   FK → tutor_profiles
subcategory_id      uuid   FK → subcategories
years_experience    int
hourly_rate_min     int    HKD
hourly_rate_max     int    HKD
achievements        jsonb  {"en": "...", "zh": "..."}   — collected in onboarding
qualifications      jsonb  app sends a STRUCTURED ARRAY of quals    — onboarding (NOT {en,zh})
exam_results        jsonb  unused — app folds exam grades into qualifications (null)
experience          jsonb  array of "relevant experience" entries  — 0014
format              tutoring_format  per-subject lesson format       — 0016
districts           hk_district[]    per-subject (in_person/both)    — 0016
```
> **Changed:** `achievements` / `qualifications` / `exam_results` are now **collected in onboarding**
> (the tutor "Strengths & Details" screen already collects them). The onboarding also
> collects a free-text **"relevant experience"** list and a single **preferred pay**
> figure per subject. **DONE (0014):** `experience` jsonb on `tutor_subcategories` holds the
> list; the single pay figure maps to **both** `hourly_rate_min`/`hourly_rate_max`. Tutor
> teaching levels + education history live on `tutor_profiles` (`teaching_levels`/`education`/`current_studies`).

#### 4.2a Expanded language set
The seeker language selection and tutor teaching languages now include the extended list
from onboarding, not just three. Languages: `english`, `cantonese`, `mandarin`,
`japanese`, `korean`, `french`, `spanish`, `german`, `italian`, `portuguese`, `thai`,
`hindi`, `arabic` (extend as needed).
> **DONE (0010):** the expanded set is stored as **text** (lowercase tokens) in `text[]`
> columns (`preferred_languages` on seekers) and `tutor_languages.language`. The old 3-value
> `preferred_language` enum stays (now vestigial for matching; `profiles.district` is still used).

---

### 4.3 Availability (precise time ranges) — REDESIGNED

The current design stores **precise start/end time ranges per weekday**, not coarse morning/afternoon/
evening buckets. The `time_slot` enum (`morning|afternoon|evening`) is **removed**.

**`tutor_availability`**
```
id           uuid        PK
tutor_id     uuid        FK → tutor_profiles
day_of_week  enum        'mon'..'sun'
start_min    int         minutes from midnight (0–1440)
end_min      int         minutes from midnight (0–1440), > start_min
```

**`seeker_availability`** — students and children
```
id           uuid        PK
owner_id     uuid        a student's profile_id OR a child_profiles.id
owner_type   enum        'student' | 'child'
day_of_week  enum        'mon'..'sun'
start_min    int
end_min      int
```
> **DONE (migration 0007):** dropped the `time_slot` enum; both availability tables now use
> the `start_min`/`end_min` shape with `owner_type` (`student`|`child`) on `seeker_availability`;
> multiple ranges per day allowed. `GET`/`PUT /api/availability` reworked to the range shape
> (role-routed; parents pass a `child_id`). Supersedes 0003 — do not apply 0003.

---

### 4.4 Social Posts (Tutor Feed)

**`posts`**
```
id              uuid  PK
tutor_id        uuid  FK → tutor_profiles
content         text
content_zh      text
post_type       enum  'update' | 'showcase' | 'result'
likes_count     int   default 0  (denormalised — maintained by trigger, see §4.4a)
comments_count  int   default 0  (denormalised — maintained by trigger, see §4.4a)
created_at      timestamptz
updated_at      timestamptz
```

**`post_media`**
```
id          uuid  PK
post_id     uuid  FK → posts  ON DELETE CASCADE
url         text  (Supabase Storage public URL)
media_type  enum  'image' | 'video'
sort_order  int
```

**`post_likes`** / **`post_comments`** — schema only; **likes/comments UI not built yet (see TODO)**
(tables + triggers exist so the data model is ready).
```
post_likes     (id, post_id, profile_id, created_at, UNIQUE(post_id, profile_id))
post_comments  (id, post_id, profile_id, parent_comment_id, content, deleted_at, created_at)
```

> **Built:** tutors can **create posts** and the tutor profile shows a **scrollable
> post feed** (bio at top, posts below, Instagram-style). Post creation + feed viewer are
> built; likes/comments remain schema-only (see TODO).

#### §4.4a — Required counter triggers
Created alongside the tables (already in `0001`). Without them the counts stay 0.
```sql
-- after INSERT on post_likes  → posts.likes_count    + 1
-- after DELETE on post_likes  → posts.likes_count    - 1
-- after INSERT on post_comments (deleted_at IS NULL) → posts.comments_count + 1
-- after UPDATE on post_comments (deleted_at set)     → posts.comments_count - 1
```

---

### 4.5 Contact methods (replaces the inquiry flow)

Three optional columns on `tutor_profiles` (§4.1): `whatsapp_number`, `instagram_handle`,
`wechat_id`. All optional; any combination. The profile page renders every configured
button. There is **no inquiry form** (see TODO).

### 4.6 Inquiries — DORMANT (kept in schema, not wired)
```
inquiries (id, tutor_id, sender_profile_id, sender_name, sender_email, sender_phone,
           message, preferred_schedule, status 'new'|'read'|'replied', created_at)
```
> The table and `POST /api/tutors/[slug]/inquiries` exist but are **not built yet** —
> no UI against them. Dormant; tracked in TODO.

### 4.7 Chat & Messaging — DORMANT (not built — see TODO)
```
conversations (id, participant_a, participant_b, last_message_at, created_at,
               UNIQUE(participant_a, participant_b), CHECK (participant_a < participant_b))
messages      (id, conversation_id, sender_id, content, is_read, created_at)
```
> Canonical ordering: always insert the smaller UUID in `participant_a`. The
> `/api/conversations*` endpoints exist but are **dormant** — chat is a TODO feature.
> No real-time wiring yet.

### 4.8 Notifications & Push — NOT BUILT (see TODO; dormant schema)
```
push_tokens   (id, profile_id, token, platform, created_at, UNIQUE(profile_id, token))
notifications (id, recipient_id, type, title_en/zh, body_en/zh, data, is_read, push_sent, created_at)
```
> **Not built yet (see TODO):** no push tokens registered, no notifications written, no
> notification endpoints. Tables remain but are unused.

---

### 4.9 Saved Filter Preferences (auth-gated)
```
saved_filter_preferences
  id                uuid        PK
  profile_id        uuid        FK → profiles  UNIQUE
  preferred_langs   text[]      expanded language set
  districts         text[]      district enums
  tutoring_format   enum        'online' | 'in_person' | 'both'
  tutoring_type     enum        'individual' | 'group' | 'both'
  subcategory_ids   uuid[]      (no FK enforcement — categories are pre-seeded and stable)
  price_min         int         HKD
  price_max         int         HKD
  availability      jsonb       precise ranges, e.g. {"mon":[{"start":540,"end":720}]}
  updated_at        timestamptz
```
> Surfaced via the **Quick Match** card on the home screen. `GET`/`PUT /api/filters` are
> built. **DONE:** the `availability` jsonb now uses the precise minute-range shape
> `{ [day]: [{ start, end }] }` (§4.3) — matching `/api/availability` and the matching engine;
> the old morning/afternoon/evening bucket shape is rejected. `null` clears the saved value.

### 4.10 HK Districts Enum (18 districts)
```
CentralWestern | WanChai | Eastern | Southern
YauTsimMong | ShamshuiPo | KowloonCity | WongTaiSin | KwunTong
KwaiTsing | TsuenWan | TuenMun | YuenLong | North | TaiPo | SaiKung | ShaTin | Islands
```
> **Frontend mismatch (TODO):** onboarding shows district *labels* (`"Central & Western"`,
> `"Wan Chai"`) and groups them by region (HK Island / Kowloon / New Territories). These
> must be mapped to the enum values above before storage.

---

### 4.11 Key RLS Policies
| Table | Public SELECT | Write |
|---|---|---|
| `tutor_profiles` | `is_published = true` only | Owner only |
| `posts` + `post_media` | All rows | Owner only |
| `student_profiles` | All rows (tutors may browse) | Owner only |
| `child_profiles` | **Owner only** (private — minors; matching reads via SECURITY DEFINER) | Owner only |
| `tutor_subcategories`, `*_availability`, `*_category_interests` | per matching needs | Owner only |
| `saved_filter_preferences` | Owner only | Owner only |
| `inquiries` *(dormant)* | Tutor sees their own | Anyone INSERT; tutor UPDATE status |
| `conversations`, `messages` *(dormant)* | Participants only | Participants only |
| `notifications` *(out)* | Recipient only | System / triggers only |

> The matching RPC is `SECURITY DEFINER`, so it reads seeker/tutor preference rows
> regardless of RLS, identifying the caller via `auth.uid()`.

---

## 5. API Routes

Legend: **[built]** active · **[dormant]** code exists, switched off · **[todo]** not built yet.

### Auth
```
POST  /api/auth/signup     [built]  email + password + role; creates auth user (trigger makes profiles row)
POST  /api/auth/login      [built]
POST  /api/auth/logout     [built]
POST  /api/auth/oauth      [built]  start social sign-in (JSON): { provider: google|microsoft|apple,
                                 role?, redirect_to? } → { url } (provider authorization URL)
GET   /api/auth/oauth      [built]  same, browser entry: ?provider=&role=&redirect_to= → 302 to provider
GET   /api/auth/callback   [built]  OAuth redirect target: exchanges ?code= for a session, assigns the
                                 chosen role to a NEW account (while onboarding_done=false), then
                                 redirects to ?next= or returns { ok, user }. `next` is allowlist-
                                 validated (same-origin + OAUTH_REDIRECT_ALLOWLIST prefixes) to
                                 prevent an open redirect; set OAUTH_REDIRECT_ALLOWLIST to the app
                                 deep-link scheme + web origin (e.g. "learnsum://,https://app...").
GET   /api/auth/me         [built]  returns { user, profile, detail } — detail is the role's
                                  editable data (student → student_profile + interest ids;
                                  parent → parent_profile + children w/ interests;
                                  tutor → tutor_profile + subjects + languages)
```
> **Email verification is OFF** in Supabase Auth, so `signup` returns a live session and
> the app can immediately write onboarding data under the new user (credentials first, §9). No
> service-role key is required for that path.
> **Social login (Google / Apple / Microsoft) is built.** **DONE:** backend-mediated OAuth via
> `POST`/`GET /api/auth/oauth` (initiate) + `GET /api/auth/callback` (code exchange + role assignment).
> Migration `0012` makes the new-user trigger tolerant of OAuth's missing role (defaults to `student`;
> the callback writes the real chosen role while `onboarding_done` is false). Providers are enabled +
> client id/secret configured in the Supabase dashboard (operator step), and the callback URL is added
> to the Supabase Auth redirect allowlist. Microsoft maps to Supabase's `azure` provider.

> **Auth transport (web + mobile):** protected endpoints accept **either** the session cookie
> (web, set by `/api/auth/login`) **or** an `Authorization: Bearer <access_token>` header (the
> robust path for Expo/React Native, where cookies are unreliable). With a Bearer token, the
> server client runs every PostgREST/Storage query under that JWT so **RLS still resolves
> `auth.uid()`** to the caller; `auth.getUser()` validates the token directly. (See `src/lib/supabase/server.ts`.) The callback's
> `next` redirect is **allowlist-validated against open redirects** (same-origin + the comma-separated
> **`OAUTH_REDIRECT_ALLOWLIST`** env prefixes); set that env to the app deep-link scheme + web origin
> when wiring the frontend.

### Onboarding write (credentials first)
```
POST  /api/onboarding      [built]   one-shot: after signup, write all collected onboarding
                                   data for the role (student/parent+children/tutor) in a
                                   single authenticated request. See §9 for the per-role payload.
```
> **DONE (0009):** `POST /api/onboarding` maps the frontend's slugs/labels → backend IDs/enums
> and persists the role's data atomically via the `complete_onboarding()` SQL function (one
> transaction = all-or-nothing). Custom subjects are skipped and reported; tutor teaching
> levels, per-subject experience and education history are now persisted (migration 0014;
> language proficiency is display-only).

### Profiles & editing
```
GET   /api/profiles/me     [built]    lives at /api/auth/me (returns { user, profile, detail })
PATCH /api/profiles/me     [built]    role-routed: common profiles fields (display_name, full_name,
                                   age, gender, avatar_url, district, preferred_language) for any
                                   role; student block (school_level, format/type, budget,
                                   preferred_languages[], preferred_districts[], interest ids
                                   full-replace); parent block (searching_for_self). Tutors edit
                                   profile via PATCH /api/tutors/[slug] + subjects/languages
                                   endpoints; a student/parent block on a tutor → 400.
DELETE /api/profiles/me    [built]    permanently delete own account (all roles). Purges the user's
                                   media via the Storage API, then runs the SECURITY DEFINER
                                   delete_own_account() (migration 0013): deletes the auth user
                                   (cascades all data) + non-cascading seeker_availability rows;
                                   clears the session. No service-role key needed.
```

### Children (parent-only)
```
GET    /api/children       [built]   list the parent's children (each with interest ids)  [auth, parent]
POST   /api/children       [built]   add a child (name + optional prefs/interests); enforces ≤6  [auth, parent]
GET    /api/children/[id]  [built]   one child (with interest ids)  [auth, owner]
PATCH  /api/children/[id]  [built]   edit any subset; interests full-replace if sent  [auth, owner]
DELETE /api/children/[id]  [built]   delete child; clears the child's availability rows first
                                  (polymorphic owner_id, no FK), then deletes (interests cascade)
```
> Same canonical input forms as `PATCH /api/profiles/me` (interest UUIDs, district enum codes,
> lowercase languages). A child's **schedule** is managed via `PUT /api/availability` with a
> `child_id` (single source of truth). Non-parent roles → 403; another parent's child → 404.

### Tutor subjects & languages (tutor-only, full-replace)
```
GET   /api/tutor/languages [built]   the tutor's teaching languages [{language, proficiency 1..4}]
PUT   /api/tutor/languages [built]   full-replace; body { languages: [{language, proficiency?}] | {lang:prof} }
GET   /api/tutor/subjects  [built]   the tutor's subjects (+ subcategory info)
PUT   /api/tutor/subjects  [built]   full-replace; body { subjects: [{subcategory_id, years_experience,
                                  hourly_rate_min, hourly_rate_max, achievements, qualifications,
                                  exam_results}] }; deduped by subcategory_id (last wins)
```
> Closes the post-onboarding gap (nothing edited `tutor_subcategories` / `tutor_languages`
> after onboarding). `PUT subjects` verifies every `subcategory_id` exists **before** the
> delete (full-replace is delete+insert) so a bad id can't wipe existing subjects. Non-tutor
> roles → 403; no tutor profile yet → 409. Tutor profile/contacts/publish stay on
> `PATCH /api/tutors/[slug]`; availability on `PUT /api/availability`.

> **Profile editing:** all roles edit their onboarding preferences from the profile
> screen. Tutors edit profile picture, bio, WhatsApp/Instagram/WeChat, categories,
> availability, rates, districts, languages, and `is_published` (self-publish/unpublish).
> Students/parents edit any onboarding preference. **DONE:** `PATCH /api/profiles/me` covers
> common profile fields + the student/parent preference blocks (incl. student interest replace);
> `GET /api/auth/me` returns the role's current detail for pre-fill. Children CRUD + tutor
> subjects/languages editing tracked separately (children + tutor-subjects/languages endpoints).

### Tutors / browse
```
GET   /api/tutors          [built]   browse: ?subcategory_id=&district=&tutoring_format=&tutoring_type=&min_rate=&max_rate=&page=
GET   /api/tutors/[slug]   [built]   single tutor (public; includes posts)
POST  /api/tutors          [built]   create tutor profile (is_published defaults false)  [auth, role=tutor]
PATCH /api/tutors/[slug]   [built]   update own profile, incl. is_published + new contact fields  [auth, owner]
```
> **DONE:** `instagram_handle` / `wechat_id` wired into `POST`/`PATCH` bodies and `GET /api/tutors/[slug]` (migration 0004).
> **DONE:** `GET /api/tutors/[slug]` also returns per-subject `achievements` / `qualifications` / `exam_results` (jsonb) and the tutor's `tutor_languages` (`language` + `proficiency`).
> **TODO:** extend `GET /api/tutors` browse filters and bodies to the remaining full set (languages, districts, etc.).

### Home Feed
```
GET   /api/feed            [built]   personalized matches for a seeker; guests/others get latest tutors
```

### Categories
```
GET   /api/categories      [built]   all categories + subcategories
```

### Availability
```
GET   /api/availability    [built]   caller's availability  [auth]
PUT   /api/availability    [built]   full-replace caller's availability (role-routed)  [auth]
```
> **DONE (0007):** request/response use precise `{ [day]: [{start,end}] }` minute ranges; parents pass a `child_id`.

### Posts
```
GET    /api/tutors/[slug]/posts   [built]  paginated, public
POST   /api/tutors/[slug]/posts   [built]  create post  [auth, owner]; optional media: [{url, media_type, sort_order?}]
                                        (url must be in the media bucket; writes post_media, rollback on failure)
DELETE /api/posts/[id]            [built]  delete own post  [auth, owner]; cascades media/likes/comments
```

### Saved Filters
```
GET   /api/filters         [built]   caller's saved filter preferences  [auth]
PUT   /api/filters         [built]   upsert (full replace)              [auth]
```

### Dormant (code exists, switched off — no UI)
```
POST  /api/tutors/[slug]/inquiries          [dormant]
GET   /api/conversations                    [dormant]
POST  /api/conversations                    [dormant]
GET   /api/conversations/[id]/messages      [dormant]
POST  /api/conversations/[id]/messages      [dormant]
(no notification / push endpoints — not built; see TODO)
```

### Uploads (Storage)
```
POST  /api/upload          [built]   body { kind: 'avatar'|'post', content_type } → returns a signed
                                  upload URL + token + path + public_url. The app uploads bytes
                                  directly to the public `media` bucket (no service-role key —
                                  createSignedUploadUrl runs under the caller's session). Files go to
                                  {auth.uid()}/{avatars|posts}/{uuid}.{ext}; bucket + owner-only write
                                  RLS in migration 0011. Avatars wired via PATCH /api/profiles/me
                                  (avatar_url); post media via POST /api/tutors/[slug]/posts (media[]).
```

### Hardening follow-ups (from code review — not blockers)
- **OAuth open redirect — FIXED (hardened):** `GET /api/auth/callback` validates `next` by **parsed
  origin** (http/https) or **scheme** (custom deep-links like `learnsum://`), against same-origin +
  `OAUTH_REDIRECT_ALLOWLIST`. Earlier prefix (`startsWith`) matching was bypassable
  (`https://trusted.com@evil.com`, `https://trusted.com.evil.com`); now rejected. Off-origin /
  protocol-relative also rejected.
- **Post media ownership — FIXED:** `POST /api/tutors/[slug]/posts` now requires each `media` url to be
  under the poster's OWN bucket path (`…/media/{tutor.id}/`), not just anywhere in the bucket.
- **`avatar_url` (TODO):** `PATCH /api/profiles/me` accepts any URL; consider validating it to the
  media-bucket prefix like post media does (prevents storing arbitrary external image URLs).
- **`saved_filter_preferences.preferred_langs` (TODO):** still validates against the legacy 3-language
  enum; align to the expanded lowercase-token set (§4.2a / 0010) for consistency with seeker prefs.
- **Atomicity (TODO):** the multi-step edit writes (profile / children / tutor subjects+languages) aren't
  transactional; fold into SQL functions if airtightness is needed (low-value data today).
- **Tests (TODO):** no automated suite — verification is live `curl`. Add an integration harness before
  the frontend depends on these contracts.

---

## 6. Matching Algorithm

`GET /api/feed` personalizes for a seeker; guests and others get the latest published
tutors (`created_at` DESC, unfiltered). Ranking runs in the Postgres RPC
`match_tutors_for_seeker(...)` (`SECURITY DEFINER`, caller via `auth.uid()`),
**reworked** in migration 0008:

**Weighting order (most → least important):**
1. **Subject / category** match
2. **Availability** match — **real time-overlap** of precise ranges (§4.3), not bucket equality
3. **Price** range match — tutor rate within the seeker's budget
4. **Preferred language** match
5. **District** match (dropped for online-only tutors)

- Weights are an **operator-tunable config** (single obvious place — the five integer
  literals in the matching migration). **No end-user-facing weight controls.**
- **Soft scoring + graceful degradation:** no hard exclusions and **never an empty state** —
  if nothing matches well, the feed still returns the closest available tutors. A dimension
  with no data on either side is dropped and the remaining weights renormalize.
- **Per child:** for parents, matching runs **per child** (each child is a seeker with its
  own interests/availability/preferences). **DONE (0008):** the RPC takes a `child_id`
  argument; a child is matchable only by its parent (else the seeker resolves to no data).
- **DECIDED (0008):** format/type are a minor **tie-breaker** (weight 3), not a hard filter;
  the 5 named factors carry the rest of the score.
- **DONE (migration 0008):** real time-overlap availability, **price** as its own weighted
  dimension, and the reordered weights (40/25/15/10/7/3, subject→district).
- **TODO (per-subject format/districts):** matching reads the tutor-**level** `tutoring_format`
  + home `district`. The app now also stores **per-subject** `format`/`districts` (migration
  `0016`); rework `match_tutors_for_seeker` to score on the per-subject values.

---

## 7. Feature status

### Built
- [x] Tutor social profile (bio + post feed with photos/video)
- [x] Tutor onboarding (credentials first) incl. per-subject experience, achievements, qualifications, pay, availability
- [x] Tutor "complete your profile" + explicit publish / self-unpublish
- [x] Public tutor browse with the **full filter set**
- [x] **Personalized weighted matching feed** (subject > availability > price > language > district), per child for parents
- [x] Guest feed — latest published tutors, `created_at` DESC, unfiltered
- [x] WhatsApp + Instagram + WeChat contact buttons
- [x] Saved filter preferences + Quick Match card
- [x] Posts: creation + feed viewer
- [x] Profile editing for all roles + account deletion
- [x] Email + password auth **and** social login (Google/Apple/Microsoft)
- [x] Phone / SMS OTP auth endpoints (need Twilio + Supabase provider wired — see TODO below / CLAUDE.md)
- [x] Schema for likes/comments (no interaction UI)

### TODO (eventually)
No launch deadline — everything below is intended for build at some point, in no fixed order.

**Pending features**
- [ ] In-app chat / messaging — `conversations`/`messages` schema + `/api/conversations*` exist but **dormant**; no real-time wiring, no UI.
- [ ] Inquiry form — `inquiries` table + `POST /api/tutors/[slug]/inquiries` exist but **dormant**; no UI.
- [ ] Post likes & comments UI — schema + counter triggers exist; build the interaction UI.
- [ ] Push notifications **and** in-app notifications — `push_tokens`/`notifications` tables exist but unused; no endpoints, no wiring.
- [ ] Email (Resend) — transactional email + email verification (currently OFF).
- [ ] Calendar / per-date availability scheduling — current design uses recurring weekday ranges only.
- [ ] Tutor onboarding sample-profile carousel — placeholder; needs real profiles first.
- [ ] University verification badge.

**Operational setup**
- [ ] Wire Twilio + the Supabase phone provider so phone OTP sends real SMS (steps in CLAUDE.md "Pending setup"). Endpoints are already built.

**Engineering / data-model follow-ups** (see also §5 "Hardening follow-ups")
- [x] A home for the tutor "relevant experience" list — `experience` jsonb on `tutor_subcategories` (migration 0014).
- [x] Single onboarding pay figure maps to both `hourly_rate_min`/`hourly_rate_max` (migration 0014).
- [ ] Capture strategy for user-typed custom subjects (no DB home today).
- [ ] Drop/relax the vestigial `profiles.preferred_language` / `profiles.district` single-enum columns.
- [ ] Validate `avatar_url` against the media-bucket prefix (like post media).
- [ ] Align `saved_filter_preferences.preferred_langs` to the expanded lowercase language set (0010).
- [ ] Make the multi-step edit writes (profile / children / tutor subjects+languages) transactional.
- [ ] Extend `GET /api/tutors` browse filters to the full set (languages, districts, etc.).
- [ ] Use **per-subject** `format`/`districts` (migration 0016) in matching/search — stored only today; the matching RPC still reads the tutor-level format + home district.
- [x] **Reconcile subject-detail shapes:** `PUT /api/tutor/subjects` now accepts array `qualifications`/`exam_results` (the app sends `achievements: {en,zh}`, `qualifications: <structured array>`, `exam_results: null`) AND persists per-subject `format` + `districts` (it had neither). Also `PATCH /api/profiles/me` now accepts the `lgbt` gender. Done as part of wiring the Profile "Change preferences" edit save (frontend `components/tutor/tutorEditStore.ts`).
- [ ] **`tutoring_type` (individual/group) is not collected** by the app → stored null, so the matching tie-breaker on type is always neutral. Decide: collect it in the app, or drop it from matching.
- [ ] Add an automated integration test suite (today verification is live `curl`).

---

## 8. Data Flow Notes

- **Guest feed:** published tutors, `created_at` DESC, no personalization.
- **Matched feed:** `match_tutors_for_seeker(...)` scores every published tutor by the
  weighted similarity in §6, `ORDER BY score DESC`; `/api/feed` hydrates full cards for the
  page. Runs per child for parents.
- **Tutor profile page** (`/tutors/[slug]`): profile + first posts; contact buttons for
  every configured method.
- **Onboarding → account:** browse freely → **sign up / log in first** (credentials first,
  all roles) → answer the role's onboarding under the live session (no email verification) →
  all onboarding data written in one shot at the end. Tutor lands unpublished with a
  "complete your profile" prompt (which is also where the tutor flow's sign-up gate lives).

---

## 9. Onboarding & Auth (credentials first)

Credentials are collected **first**. Every role (tutor, student, parent) **signs up / logs
in before answering any onboarding questions** — so the account + session exist from the
start (the tutor reaches this via the "Complete profile" prompt on the home screen). The
in-memory onboarding store (frontend `components/onboarding/onboardingStore.ts`) holds the
answers while the user is signed in, and the one-shot `POST /api/onboarding` write persists
them at the **end** of the flow. Email verification is **off**, so the account is usable
immediately. (Returning users are detected at sign-up via `is_new_user` and skip onboarding.)

**Per-role data to persist** (see the backend `CLAUDE.md` "Frontend integration notes" for
exact store keys and field shapes):

- **Student:** `school_level`; subject interests → `user_category_interests`; preferences
  (format, preferred districts[], preferred languages[], availability ranges).
- **Parent:** parent account (+ `searching_for_self`); **one `child_profiles` row per
  child** (name, `school_level`); per-child interests → `child_category_interests`; per-child
  preferences + availability.
- **Tutor:** `tutor_profiles` (`slug`, `university`, format/type, **is_published = false**);
  teaching levels; subjects → `tutor_subcategories` (years, pay, **per-subject format + districts**, achievements,
  qualifications, experience); teaching languages + proficiency; availability ranges.
  Contact details (WhatsApp/Instagram/WeChat) + bio + photo are completed on the post-
  onboarding "complete your profile" screen, then the tutor publishes.

> **DONE (0009):** `POST /api/onboarding` exists; it maps category slugs → `subcategories.id`
> and district labels → `hk_district` codes (§4.2, §4.10) server-side, then writes atomically.
> Custom subjects are skipped and reported; tutor teaching levels, per-subject experience and education history are persisted (migration 0014). Language proficiency is display-only.
