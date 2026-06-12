---

# LearnSum MVP — Product & Technical Plan

> **Repo naming:** this backend repo is `learnsum-mvp-back`; the React Native + Expo
> frontend is `learnsum-mvp-expo-app`. (Folders are being renamed to these; treat
> them as canonical in all docs.)
>
> **This document is the source of truth for the backend schema + API.** It reflects
> the v1 product decisions agreed for the current build. Where a decision implies
> schema/API work that is not yet written, it is called out inline with **TODO**.

## 1. Product Overview

Hong Kong-based two-sided tutoring marketplace with a social media layer.

**Three user types:** Parent · Student · Tutor

**Core philosophy:**
- **Browse is public, account is created at the end.** A guest can browse the whole
  app. Onboarding collects everything *first*; **email + password are collected on the
  final step** ("Option A" — see §9). Submitting credentials creates the account and
  writes all collected onboarding data in one shot.
- Tutor profiles work like Instagram — bio block + scrollable post feed.
- Two-way discovery — parents/students find tutors via a personalized, weighted feed.
- **Contact is WhatsApp / Instagram / WeChat** (all optional, any combination). No
  in-app inquiry form, no in-app chat in v1.

---

## 2. Three Core Features (v1)

**1. Tutor Social Profile** — supply-side value proposition
Bio block: photo, display name, university, categories, pricing, personal description,
plus per-subject achievements / qualifications / experience. Below: scrollable post feed
(text, photos, video). A tutor's profile is **not auto-published**: after onboarding
`is_published` stays `false` and the tutor home screen shows a persistent "complete your
profile" prompt leading to a dedicated screen (bio, photo, WhatsApp, Instagram, WeChat,
remaining details) where they explicitly publish. Tutors can later unpublish themselves.

**2. Public Browse + Full Filters + Personalized Feed** — demand-side discovery + SEO
Public browse of published tutors. The home feed is **personalized by a weighted matching
algorithm** for seekers (see §6). Filters in v1 are the **full saved-filter set**:
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

No inquiry form and no backend booking logic in v1. (The `inquiries` table and its
endpoint remain in the codebase but are **dormant** — see §4.6 / §5.)

---

## 3. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Backend API | Next.js 16 (App Router) | API routes only — no frontend pages or UI in this repo. Dynamic route handlers must `await params` (Promise in Next 15+). |
| Frontend | React Native + Expo (separate repo: `learnsum-mvp-expo-app`) | Mobile-first UI, separate from the API server |
| Backend + DB | Supabase | Auth + Postgres + Storage |
| Email | Resend (transactional) | **Not wired in v1** — email verification is OFF and notifications are out of scope; reserved for v1.1+ |
| Deploy | Vercel | API server only — zero-config, Next.js native |

> **Out of the stack for v1:** Supabase Realtime / chat (v2), Expo Push / FCM (out — no
> push notifications in v1).

---

## 4. Database Schema

> Migrations live in `supabase/migrations/`, applied manually via the Supabase SQL editor.
> Current files: `0001_initial_schema.sql`, `0002_rls.sql` (canonical RLS), `0003_seeker_availability_and_matching.sql`,
> `0004_tutor_contact_columns.sql`, `0005_school_level_six_values.sql`, `0006_child_profiles.sql`, `0007_precise_availability.sql`, `0008_matching_rpc_rework.sql`, `0009_complete_onboarding.sql`, `0010_language_refinement.sql`. (The stale `0002_rls_policies.sql`
> duplicate has been removed; 0003 is superseded by 0007/0008.) **Done:** 0004 (contact columns), 0005 (6-value education enum), 0006 (per-child seeker tables), 0007 (precise availability), 0008 (reworked matching RPC), 0009 (atomic onboarding writer), 0010 (multi-language model).
> **All v1 schema migrations are now written (0004–0010).**

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
> **Changed for v1:** per-person *preferred languages* and *preferred districts* are now
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

> **Frontend mismatch (TODO):** onboarding currently uses **hardcoded string slugs**
> (`"sports"`, `"basketball"`, plus user-typed `custom-…`) and never calls
> `/api/categories`. For matching to work, onboarding selections must be mapped to real
> `subcategories.id` UUIDs (either seed the DB to match the frontend slugs, or have the
> app fetch `/api/categories`). User-typed custom subjects need a capture strategy.

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
achievements        jsonb  {"en": "...", "zh": "..."}   — v1 (collected in onboarding)
qualifications      jsonb  {"en": "...", "zh": "..."}   — v1 (collected in onboarding)
exam_results        jsonb  {"en": "HKDSE Maths 5**", "zh": "..."} — v1
```
> **Changed for v1:** `achievements` / `qualifications` / `exam_results` are now **v1**
> (the tutor "Strengths & Details" screen already collects them). The onboarding also
> collects a free-text **"relevant experience"** list and a single **preferred pay**
> figure per subject. **TODO (migration / mapping):** add a home for "experience"
> (e.g. an `experience` jsonb/array on `tutor_subcategories`); decide how the single
> pay figure maps to `hourly_rate_min`/`hourly_rate_max` (e.g. set both, or treat as min).

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

v1 stores **precise start/end time ranges per weekday**, not coarse morning/afternoon/
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

### 4.4 Social Posts (Tutor Feed) — v1

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

**`post_likes`** / **`post_comments`** — schema only; **likes/comments UI is out of v1**
(tables + triggers exist so the data model is ready; do not build the interaction UI).
```
post_likes     (id, post_id, profile_id, created_at, UNIQUE(post_id, profile_id))
post_comments  (id, post_id, profile_id, parent_comment_id, content, deleted_at, created_at)
```

> **v1 scope:** tutors can **create posts** and the tutor profile shows a **scrollable
> post feed** (bio at top, posts below, Instagram-style). Post creation + feed viewer are
> built; likes/comments remain schema-only.

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
button. There is **no inquiry form** in v1.

### 4.6 Inquiries — DORMANT (kept in schema, not wired)
```
inquiries (id, tutor_id, sender_profile_id, sender_name, sender_email, sender_phone,
           message, preferred_schedule, status 'new'|'read'|'replied', created_at)
```
> The table and `POST /api/tutors/[slug]/inquiries` still exist but are **out of v1** —
> do not build UI against them. Marked dormant for possible future use.

### 4.7 Chat & Messaging — DORMANT / v2 (kept in schema, not wired)
```
conversations (id, participant_a, participant_b, last_message_at, created_at,
               UNIQUE(participant_a, participant_b), CHECK (participant_a < participant_b))
messages      (id, conversation_id, sender_id, content, is_read, created_at)
```
> Canonical ordering: always insert the smaller UUID in `participant_a`. The
> `/api/conversations*` endpoints exist but are **dormant** — chat is a planned v2 feature.
> No real-time wiring in v1.

### 4.8 Notifications & Push — OUT OF v1 (dormant schema)
```
push_tokens   (id, profile_id, token, platform, created_at, UNIQUE(profile_id, token))
notifications (id, recipient_id, type, title_en/zh, body_en/zh, data, is_read, push_sent, created_at)
```
> **Fully out of v1:** no push tokens registered, no notifications written, no notification
> endpoints. Tables remain but are unused.

---

### 4.9 Saved Filter Preferences — v1 (auth-gated)
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
> built. **TODO:** align the `availability` jsonb shape with the precise-range redesign (§4.3).

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

Legend: **[v1]** built/active · **[dormant]** exists but out of v1 · **[todo]** to build.

### Auth
```
POST  /api/auth/signup     [v1]  email + password + role; creates auth user (trigger makes profiles row)
POST  /api/auth/login      [v1]
POST  /api/auth/logout     [v1]
GET   /api/auth/me         [v1]  returns { user, profile }
```
> **Email verification is OFF** in Supabase Auth, so `signup` returns a live session and
> the app can immediately write onboarding data under the new user (Option A, §9). No
> service-role key is required for that path.
> **Social login (Google / Apple / Microsoft) is in v1.** **TODO:** add OAuth sign-in
> (Supabase OAuth providers) to back the social buttons in the login sheet.

### Onboarding write (Option A) — **TODO**
```
POST  /api/onboarding      [v1]   one-shot: after signup, write all collected onboarding
                                   data for the role (student/parent+children/tutor) in a
                                   single authenticated request. See §9 for the per-role payload.
```
> **DONE (0009):** `POST /api/onboarding` maps the frontend's slugs/labels → backend IDs/enums
> and persists the role's data atomically via the `complete_onboarding()` SQL function (one
> transaction = all-or-nothing). Custom subjects + tutor levels/proficiency/experience are
> skipped and reported (no DB home yet); seeker language/district go into the single
> `profiles` columns for now (multi-value lists pending a later migration).

### Profiles & editing
```
GET   /api/profiles/me     [todo]  (currently only PATCH exists; GET lives at /api/auth/me)
PATCH /api/profiles/me     [v1]    display_name + (TODO: role-specific preference fields)
DELETE /api/profiles/me    [todo]  delete own account (all three roles)
```
> **Profile editing (v1):** all roles edit their onboarding preferences from the profile
> screen. Tutors edit profile picture, bio, WhatsApp/Instagram/WeChat, categories,
> availability, rates, districts, languages, and `is_published` (self-publish/unpublish).
> Students/parents edit any onboarding preference. **TODO:** extend `PATCH /api/profiles/me`
> (and the tutor/child endpoints) to cover all editable fields.

### Tutors / browse
```
GET   /api/tutors          [v1]   browse: ?subcategory_id=&district=&tutoring_format=&tutoring_type=&min_rate=&max_rate=&page=
GET   /api/tutors/[slug]   [v1]   single tutor (public; includes posts)
POST  /api/tutors          [v1]   create tutor profile (is_published defaults false)  [auth, role=tutor]
PATCH /api/tutors/[slug]   [v1]   update own profile, incl. is_published + new contact fields  [auth, owner]
```
> **DONE:** `instagram_handle` / `wechat_id` wired into `POST`/`PATCH` bodies and `GET /api/tutors/[slug]` (migration 0004).
> **DONE:** `GET /api/tutors/[slug]` also returns per-subject `achievements` / `qualifications` / `exam_results` (jsonb) and the tutor's `tutor_languages` (`language` + `proficiency`).
> **TODO:** extend `GET /api/tutors` browse filters and bodies to the remaining v1 set (languages, districts, etc.).

### Home Feed
```
GET   /api/feed            [v1]   personalized matches for a seeker; guests/others get latest tutors
```

### Categories
```
GET   /api/categories      [v1]   all categories + subcategories
```

### Availability
```
GET   /api/availability    [v1]   caller's availability  [auth]
PUT   /api/availability    [v1]   full-replace caller's availability (role-routed)  [auth]
```
> **DONE (0007):** request/response use precise `{ [day]: [{start,end}] }` minute ranges; parents pass a `child_id`.

### Posts
```
GET    /api/tutors/[slug]/posts   [v1]  paginated, public
POST   /api/tutors/[slug]/posts   [v1]  create post  [auth, owner]
DELETE /api/posts/[id]            [todo]
```

### Saved Filters
```
GET   /api/filters         [v1]   caller's saved filter preferences  [auth]
PUT   /api/filters         [v1]   upsert (full replace)              [auth]
```

### Dormant / out of v1 (exist but not wired — do not build UI)
```
POST  /api/tutors/[slug]/inquiries          [dormant]
GET   /api/conversations                    [dormant]
POST  /api/conversations                    [dormant]
GET   /api/conversations/[id]/messages      [dormant]
POST  /api/conversations/[id]/messages      [dormant]
(no notification / push endpoints — out of v1)
(no /api/upload yet — Storage upload path is TODO for posts/avatars)
```

---

## 6. Matching Algorithm (v1)

`GET /api/feed` personalizes for a seeker; guests and others get the latest published
tutors (`created_at` DESC, unfiltered). Ranking runs in the Postgres RPC
`match_tutors_for_seeker(...)` (`SECURITY DEFINER`, caller via `auth.uid()`), to be
**reworked** for v1:

**Weighting order (most → least important):**
1. **Subject / category** match
2. **Availability** match — **real time-overlap** of precise ranges (§4.3), not bucket equality
3. **Price** range match — tutor rate within the seeker's budget
4. **Preferred language** match
5. **District** match (dropped for online-only tutors)

- Weights are an **operator-tunable config** (single obvious place — the five integer
  literals in the matching migration). **No end-user-facing weight controls in v1.**
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

---

## 7. MVP vs out-of-scope

### Build in v1
- [x] Tutor social profile (bio + post feed with photos/video)
- [x] Tutor onboarding (Option A) incl. per-subject experience, achievements, qualifications, pay, availability
- [x] Tutor "complete your profile" + explicit publish / self-unpublish
- [x] Public tutor browse with the **full filter set**
- [x] **Personalized weighted matching feed** (subject > availability > price > language > district), per child for parents
- [x] Guest feed — latest published tutors, `created_at` DESC, unfiltered
- [x] WhatsApp + Instagram + WeChat contact buttons
- [x] Saved filter preferences + Quick Match card
- [x] Posts: creation + feed viewer
- [x] Profile editing for all roles + account deletion
- [x] Email + password auth **and** social login (Google/Apple/Microsoft)
- [x] Schema for likes/comments (no interaction UI)

### Explicitly OUT of v1
- [ ] In-app chat / messaging (schema + endpoints exist, **dormant**; planned v2)
- [ ] Inquiry form (schema + endpoint exist, **dormant**)
- [ ] Push notifications **and** in-app notifications (fully out)
- [ ] Post likes & comments UI (schema only)
- [ ] Calendar / per-date scheduling (availability is recurring weekday ranges only)
- [ ] Tutor onboarding sample-profile carousel (placeholder only — needs real profiles)
- [ ] University verification badge

---

## 8. Data Flow Notes

- **Guest feed:** published tutors, `created_at` DESC, no personalization.
- **Matched feed:** `match_tutors_for_seeker(...)` scores every published tutor by the
  weighted similarity in §6, `ORDER BY score DESC`; `/api/feed` hydrates full cards for the
  page. Runs per child for parents.
- **Tutor profile page** (`/tutors/[slug]`): profile + first posts; contact buttons for
  every configured method.
- **Onboarding → account:** browse freely → fill role onboarding → enter email + password
  on the final step → account created (session live, no email verification) → all onboarding
  data written in one shot. Tutor lands unpublished with a "complete your profile" prompt.

---

## 9. Onboarding & Auth (Option A)

Credentials are collected **last**. The in-memory onboarding store (frontend
`components/onboarding/onboardingStore.ts`) holds everything until then; on credential
submit the app creates the account and persists the store. Email verification is **off**
so the new account is immediately usable.

**Per-role data to persist** (see the backend `CLAUDE.md` "Frontend integration notes" for
exact store keys and field shapes):

- **Student:** `school_level`; subject interests → `user_category_interests`; preferences
  (format, preferred districts[], preferred languages[], availability ranges).
- **Parent:** parent account (+ `searching_for_self`); **one `child_profiles` row per
  child** (name, `school_level`); per-child interests → `child_category_interests`; per-child
  preferences + availability.
- **Tutor:** `tutor_profiles` (`slug`, `university`, format/type, **is_published = false**);
  teaching levels; subjects → `tutor_subcategories` (years, pay, achievements,
  qualifications, experience); teaching languages + proficiency; availability ranges.
  Contact details (WhatsApp/Instagram/WeChat) + bio + photo are completed on the post-
  onboarding "complete your profile" screen, then the tutor publishes.

> **DONE (0009):** `POST /api/onboarding` exists; it maps category slugs → `subcategories.id`
> and district labels → `hk_district` codes (§4.2, §4.10) server-side, then writes atomically.
> Custom subjects + tutor levels/proficiency/experience are skipped and reported (no DB home yet).
