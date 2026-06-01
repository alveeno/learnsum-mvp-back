
---

# LearnSum MVP — Product & Technical Plan

## 1. Product Overview

Hong Kong-based two-sided tutoring marketplace with a social media layer.

**Three user types:** Parent · Student · Tutor

**Core philosophy:**
- Zero friction onboarding — user type selection → home feed immediately, no setup gates
- Browse is public — account required only for saving preferences, profile info, and chat
- Tutor profiles work like Instagram — bio block + scrollable post feed
- Two-way discovery — parents/students find tutors AND tutors find students

---

## 2. Three Core Features (v1)

**1. Tutor Social Profile** — supply-side value proposition
Bio block: photo, display name, university, age, gender, categories, pricing, personal description. Below: scrollable post feed (text, photos, video) marketing teaching style, student results, personality. Everything else depends on this existing first.

**2. Public Browse + Category / District Filter** — demand-side discovery + SEO
Browse grid filtered by category and district. SSR tutor profile pages at `/tutors/[slug]` indexed by Google from day one. Price/format/language filters added in v1.1 once there is signal on what parents actually use.

**3. WhatsApp Redirect / Inquiry Form** — closes the marketplace loop
WhatsApp redirect is the primary path (standard in HK). Inquiry form as fallback for tutors who prefer not to expose their number. No backend booking logic required.

---

## 3. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Backend API | Next.js 14 (App Router) | API routes only — no frontend pages or UI in this repo |
| Frontend | React Native + Expo (separate repo: `learnsum-mvp-expo-app`) | Mobile-first UI, separate from the API server |
| Backend + DB | Supabase | Auth + Postgres + Storage + Realtime in one |
| Real-time chat | Supabase Realtime | Built on WebSockets, no separate infra |
| Email | Resend | Transactional notifications |
| Push notifications | Expo Push / FCM | Mobile push via Expo in `learnsum-mvp-expo-app` |
| Deploy | Vercel | API server only — zero-config, Next.js native |

---

## 4. Database Schema

### 4.1 Auth & Core Profiles

**`profiles`** — extends `auth.users`, one row per account
```
id                  uuid        PK  FK → auth.users
role                enum        'parent' | 'student' | 'tutor'
full_name           text
display_name        text
avatar_url          text
preferred_language  enum        'english' | 'cantonese' | 'mandarin'
district            enum        (see §4.7 — 18 HK districts)
age                 int
gender              enum        'male' | 'female' | 'other' | 'prefer_not_to_say'
school_name         text        (students and parents)
onboarding_done     bool        default false
created_at          timestamptz
updated_at          timestamptz
```

**`student_profiles`** — one-to-one with profiles where role = 'student'
```
id                      uuid   PK  FK → profiles
school_level            enum   'primary' | 'secondary' | 'university' | 'adult'
tutoring_format_pref    enum   'online' | 'in_person' | 'both'
tutoring_type_pref      enum   'individual' | 'group' | 'both'
budget_max_per_hour     int    HKD
```

**`parent_profiles`** — one-to-one with profiles where role = 'parent'
```
id                      uuid   PK  FK → profiles
searching_for_self      bool   default false
tutoring_format_pref    enum   'online' | 'in_person' | 'both'
tutoring_type_pref      enum   'individual' | 'group' | 'both'
budget_max_per_hour     int    HKD
```

**`tutor_profiles`** — one-to-one with profiles where role = 'tutor'
```
id                  uuid   PK  FK → profiles
slug                text   UNIQUE  (SEO: /tutors/[slug])
bio                 text
bio_zh              text   Traditional Chinese bio
university          text
tutoring_format     enum   'online' | 'in_person' | 'both'
tutoring_type       enum   'individual' | 'group' | 'both'
whatsapp_number     text
is_published        bool   default false
created_at          timestamptz
updated_at          timestamptz
```

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

**`user_category_interests`** — categories parents/students care about (drives feed matching)
```
id              uuid  PK
profile_id      uuid  FK → profiles
subcategory_id  uuid  FK → subcategories
UNIQUE(profile_id, subcategory_id)
```

**`tutor_subcategories`** — what a tutor teaches, with per-subject detail
```
id                  uuid   PK
tutor_id            uuid   FK → tutor_profiles
subcategory_id      uuid   FK → subcategories
years_experience    int
hourly_rate_min     int    HKD
hourly_rate_max     int    HKD
achievements        jsonb  {"en": "...", "zh": "..."}  — v1.1, do not surface in onboarding form
qualifications      jsonb  {"en": "...", "zh": "..."}  — v1.1, do not surface in onboarding form
exam_results        jsonb  {"en": "HKDSE Maths 5**", "zh": "..."}  — v1.1, do not surface in onboarding form
```
> v1 onboarding collects only: subcategory, years_experience, hourly_rate_min/max. Detail fields are schema-ready but hidden until v1.1.

**`tutor_availability`** — when tutor is available to teach
```
id             uuid  PK
tutor_id       uuid  FK → tutor_profiles
day_of_week    enum  'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
time_slot      enum  'morning' | 'afternoon' | 'evening'
UNIQUE(tutor_id, day_of_week, time_slot)
```

---

### 4.3 Social Posts (Tutor Feed)

**`posts`**
```
id              uuid  PK
tutor_id        uuid  FK → tutor_profiles
content         text
content_zh      text
post_type       enum  'update' | 'showcase' | 'result'
likes_count     int   default 0  (denormalised — maintained by trigger, see §4.3a)
comments_count  int   default 0  (denormalised — maintained by trigger, see §4.3a)
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

**`post_likes`** — schema only; interactions not built in MVP
```
id          uuid  PK
post_id     uuid  FK → posts  ON DELETE CASCADE
profile_id  uuid  FK → profiles
created_at  timestamptz
UNIQUE(post_id, profile_id)
```

**`post_comments`** — schema only; not built in MVP
```
id                 uuid  PK
post_id            uuid  FK → posts  ON DELETE CASCADE
profile_id         uuid  FK → profiles
parent_comment_id  uuid  FK → post_comments  NULL  (reply threading)
content            text
deleted_at         timestamptz  NULL  (soft delete — preserves reply threads)
created_at         timestamptz
```

#### §4.3a — Required counter triggers
These must be created alongside the tables. Without them `likes_count` and `comments_count` are permanently 0.
```sql
-- after INSERT on post_likes  → UPDATE posts SET likes_count    = likes_count    + 1 WHERE id = NEW.post_id
-- after DELETE on post_likes  → UPDATE posts SET likes_count    = likes_count    - 1 WHERE id = OLD.post_id
-- after INSERT on post_comments (where deleted_at IS NULL) → UPDATE posts SET comments_count = comments_count + 1
-- after UPDATE on post_comments (deleted_at set)           → UPDATE posts SET comments_count = comments_count - 1
```

---

### 4.4 Inquiries (MVP contact flow)

```
id                 uuid  PK
tutor_id           uuid  FK → tutor_profiles
sender_profile_id  uuid  FK → profiles  (nullable — unauthenticated senders)
sender_name        text
sender_email       text
sender_phone       text
message            text
preferred_schedule text  (free-form: "Weekday evenings, Sat mornings")
status             enum  'new' | 'read' | 'replied'  default 'new'
created_at         timestamptz
```

---

### 4.5 Chat & Messaging

**`conversations`**
```
id               uuid  PK
participant_a    uuid  FK → profiles
participant_b    uuid  FK → profiles
last_message_at  timestamptz
created_at       timestamptz
UNIQUE(participant_a, participant_b)
CHECK (participant_a < participant_b)   -- canonical ordering prevents duplicate conversations
```
> Always insert with the smaller UUID in `participant_a`. The CHECK prevents `(Alice, Bob)` and `(Bob, Alice)` from coexisting as separate rows.

**`messages`**
```
id               uuid  PK
conversation_id  uuid  FK → conversations
sender_id        uuid  FK → profiles
content          text
is_read          bool  default false
created_at       timestamptz
```

**`push_tokens`** — device tokens for push notifications
```
id          uuid  PK
profile_id  uuid  FK → profiles
token       text
platform    enum  'ios' | 'android' | 'web'
created_at  timestamptz
UNIQUE(profile_id, token)
```

---

### 4.6 Notifications

**`notifications`**
```
id            uuid  PK
recipient_id  uuid  FK → profiles
type          enum  'new_message' | 'new_match' | 'post_like' | 'post_comment'
title_en      text
title_zh      text
body_en       text
body_zh       text
data          jsonb  (flexible payload: {message_id, post_id, tutor_slug, ...})
is_read       bool   default false
push_sent     bool   default false
created_at    timestamptz
```

---

### 4.7 Saved Filter Preferences

```
id                profile_id  uuid  FK → profiles  UNIQUE
preferred_langs   text[]      (array of language enums)
districts         text[]      (array of district enums)
tutoring_format   enum        'online' | 'in_person' | 'both'
tutoring_type     enum        'individual' | 'group' | 'both'
subcategory_ids   uuid[]      (no FK enforcement — acceptable since categories are pre-seeded and stable)
price_min         int         HKD (tutors setting floor)
price_max         int         HKD (parents/students setting ceiling)
availability      jsonb       ({mon: ["morning","evening"], sat: ["afternoon"]})
updated_at        timestamptz
```

---

### 4.8 HK Districts Enum (18 districts)
```
CentralWestern | WanChai | Eastern | Southern
YauTsimMong | ShamshuiPo | KowloonCity | WongTaiSin | KwunTong
KwaiTsing | TsuenWan | TuenMun | YuenLong | North | TaiPo | SaiKung | ShaTin | Islands
```

---

### 4.9 Key RLS Policies
| Table | Public SELECT | Write |
|---|---|---|
| `tutor_profiles` | `is_published = true` only | Owner only |
| `posts` + `post_media` | All rows | Owner only |
| `student_profiles`, `parent_profiles` | All rows (tutors browse these) | Owner only |
| `inquiries` | Tutor sees their own | Anyone can INSERT; tutor can UPDATE status |
| `conversations`, `messages` | Participants only | Participants only |
| `notifications` | Recipient only | System / triggers only |

---

## 5. API Routes

### Auth
```
POST  /api/auth/signup
POST  /api/auth/login
POST  /api/auth/logout
GET   /api/auth/me
```

### Profiles
```
GET   /api/profiles/me
PATCH /api/profiles/me
GET   /api/tutors                    # Browse tutors: ?category=&district=&lang=&minRate=&maxRate=&format=&type=&day=&slot=
GET   /api/tutors/[slug]             # Single tutor (SSR, public)
POST  /api/tutors                    # Create tutor profile       [auth]
PATCH /api/tutors/[slug]             # Update own profile         [auth, owner]
GET   /api/students                  # Tutors browse student/parent listings [auth, tutor]
```

### Home Feed
```
GET   /api/feed                      # Personalised matches for current user [auth optional]
                                     # Guests: returns unfiltered recent tutors
```

### Categories
```
GET   /api/categories                # All categories + subcategories (for dropdowns)
```

### Tutor Subjects
```
GET    /api/tutors/[slug]/subjects
POST   /api/tutors/[slug]/subjects          [auth, owner]
PATCH  /api/tutors/[slug]/subjects/[id]     [auth, owner]
DELETE /api/tutors/[slug]/subjects/[id]     [auth, owner]
```

### Tutor Availability
```
GET   /api/tutors/[slug]/availability
PUT   /api/tutors/[slug]/availability       [auth, owner] — replaces full availability set
```

### Posts
```
GET    /api/tutors/[slug]/posts             # Paginated, public
POST   /api/tutors/[slug]/posts             [auth, owner]
DELETE /api/posts/[id]                      [auth, owner]
POST   /api/posts/[id]/likes                [auth]        — v2, schema ready
GET    /api/posts/[id]/comments             — v2, schema ready
POST   /api/posts/[id]/comments             [auth]        — v2, schema ready
```

### Inquiries
```
POST  /api/tutors/[slug]/inquiries          # No auth required
GET   /api/inquiries                        [auth, tutor — own received inquiries]
PATCH /api/inquiries/[id]                   [auth, tutor — update status]
```

### Chat
```
GET   /api/conversations                    [auth]
POST  /api/conversations                    [auth] — start conversation
GET   /api/conversations/[id]/messages      [auth, participant]
POST  /api/conversations/[id]/messages      [auth, participant]
```
Real-time: subscribe via Supabase Realtime channel on `messages` table filtered by `conversation_id`.

### Notifications
```
GET   /api/notifications                    [auth]
PATCH /api/notifications/[id]               [auth — mark read]
PATCH /api/notifications/read-all           [auth]
POST  /api/push-tokens                      [auth — register device]
DELETE /api/push-tokens/[id]                [auth]
```

### Saved Filters
```
GET   /api/filters                          [auth]
PUT   /api/filters                          [auth — upsert]
```

### Upload
```
POST  /api/upload                           [auth — returns Supabase Storage URL]
```

---

## 6. MVP vs V2 Flags

### Build in MVP
- [x] Tutor social profile (bio + post feed with photos)
- [x] Public tutor browse — category + district filter only
- [x] WhatsApp redirect + inquiry form contact
- [x] Tutor account creation + profile setup
- [x] Guest home feed — latest published tutors, no personalisation
- [x] Categories + subcategories (category, subcategory, years experience, hourly rate only)
- [x] Schema for likes/comments (build UI later)

### Defer to V2
- [ ] **Personalised home feed matching** — guest feed is indistinguishable from matched feed at early tutor volumes; build once usage data shows what attributes matter
- [ ] **Student and parent accounts** — parents can browse and contact without an account; defer until chat ships, which is the first feature requiring login
- [ ] **Tutor onboarding carousel** — requires real profiles to populate; build after 10–15 tutors are live
- [ ] **Per-subject achievements, qualifications, exam results** — too heavy for tutor onboarding in v1; show category + subcategory + experience + rate only; add detail fields in v1.1
- [ ] **Real-time chat** — use WhatsApp + inquiry form for v1
- [ ] **Push notifications** — use Resend email for v1; add FCM/APNs with mobile app
- [ ] **Reverse matching feed** (tutors browsing students) — student profiles must exist first
- [ ] **Post likes & comments** — schema is ready; hold UI until post volume justifies it
- [ ] **Full bilingual content** — start English-only; ZH bio is optional for tutors
- [ ] **Saved filter preferences** — low priority until there are enough tutors to warrant repeat filtering
- [ ] **Per-day availability scheduling** — use a free-text availability notes field in v1
- [ ] **Advanced search** (price, format, language, time slot) — add in v1.1 once category + district are validated
- [ ] **University verification badge** — manual process; defer until tutor volume justifies it

---

## 7. Data Flow Notes

- **Guest home feed**: Returns recently published tutors, ordered by created_at. No personalisation until profile setup is done.
- **Matched home feed**: `SELECT tutor_profiles JOIN tutor_subcategories JOIN profiles WHERE subcategory_id IN (user's interests) AND district = user's district AND preferred_language = user's language ORDER BY relevance score`.
- **Tutor profile page** (`/tutors/[slug]`): SSR with `revalidate = 60`. Fetches profile + first 10 posts server-side for SEO. Posts paginate client-side.
- **WhatsApp fallback**: If tutor has `whatsapp_number` set, inquiry button opens `https://wa.me/[number]?text=Hi, I found you on LearnSum...` instead of submitting the form.
- **Tutor onboarding**: Signup → `profiles` row auto-created via Supabase trigger → shown sample carousel → fills `tutor_profiles` + subjects → `is_published = true` makes discoverable.
- **Chat real-time**: Supabase Realtime — client subscribes to channel `conversation:[id]`, server inserts to `messages`, broadcast triggers client update. On new message, server function inserts a `notifications` row and (v2) sends push via FCM.
