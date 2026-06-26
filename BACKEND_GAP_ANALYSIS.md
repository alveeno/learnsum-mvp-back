# Backend Gap Analysis — frontend features the backend doesn't support yet

Produced by reading the **actual frontend code** (`learnsum-mvp-expo-app`) and
comparing it to this backend. Nothing has been built. This is a decision sheet:
for each gap I give a recommendation, and **you make the final call** (✅ build /
🕓 defer / ❌ skip) in the right-hand column.

> **The key framing:** the frontend's own docs say the tutor-home shell is a
> **prototype with sample data** (`tutorData.ts` is "sample/placeholder content,
> NOT a backend shape"). So a feature appearing on screen does **not** mean it was
> meant to be a real product feature. The hard part isn't listing them — it's you
> deciding which prototype ideas become real. That's what this doc is for.

**Effort key:** S = small (hours) · M = medium (a day or two) · L = large (a
project of its own). **Depends on** = can't be built until that other gap is.

---

> ✅ **Group A (A1–A5) is now BUILT and LIVE** — migration `0014_tutor_profile_extras.sql`
> (applied) + updates to `/api/onboarding`, `/api/tutor/subjects`, and `/api/tutors/[slug]`.
> **Also built since** (during frontend wiring): `0015` (taxonomy reseeded to mirror the app's
> subject slugs) and `0016` (per-subject lesson `format`/`districts` — stored now; **TODO:** use
> it in matching). Frontend wiring of all this is underway — see `FRONTEND_WIRING.md`.
>
> **Found during wiring (recorded in `plan.md §7`):** (1) ~~the subject *edit* endpoint
> `PUT /api/tutor/subjects` still expects `{en,zh}` objects, but the app sends arrays for
> `achievements`/`qualifications` — editing subjects would reject them~~ **FIXED** (profile-edit
> wiring): `PUT /api/tutor/subjects` now accepts array `qualifications`/`exam_results` AND persists
> per-subject `format` + `districts` (it had neither), and `PATCH /api/profiles/me` now accepts the
> `lgbt` gender — so the Profile "Change preferences" edit save is lossless; (2) `tutoring_type`
> (individual/group) isn't collected by the app, so it's stored null.

---

> 🗓️ **Update (Jun 25) — the frontend moved well past this doc.** Since it was written, the frontend
> built the **seeker (student/parent) app shell** (`/feed`: an Instagram-style **post feed**, Search +
> Quick Match, Saved, Account — all **sample data**), a real public **`/tutors/[slug]`** route (reuses
> the existing `GET /api/tutors/[slug]` — **no new gap**), the **student/parent final account step**
> (`CreateAccount` → `POST /api/onboarding`), plus sound effects and a tutor logout button (no backend).
> New/changed gaps are collected in **Group H** below.
>
> **Key correction:** `POST /api/onboarding` **already fully supports `student` and `parent`** (it
> branches by role and writes via the `complete_onboarding` RPC, migration 0009) — so seeker onboarding
> is a **frontend payload-shape fix (H1), NOT a backend gap.** Also **Instagram was dropped** from
> contact (WhatsApp + WeChat only) — any "IG" mention below is stale.

## Summary table (my recommendation — you decide)

| # | Gap | My rec | Effort | Your call |
|---|---|---|---|---|
| **A. Onboarding data you already collect but the backend throws away** | | | | |
| A1 | Tutor **teaching levels** (Kindergarten…Adult) | ✅ Build | S | ✅ **Build** |
| A2 | Per-subject **"relevant experience"** list | ✅ Build | S | ✅ **Build** |
| A3 | **Education history** (multi-school per level) + "currently studying" | 🕓 Decide | M | ✅ **Build** — store full history as jsonb |
| A4 | **Gender** value mismatch (`lgbtq`/`na` vs backend enum) | ✅ Build | S | ✅ **Build** — add `lgbt`, map `na`→prefer_not_to_say |
| A5 | First/last name vs single `full_name` | ✅ Build | S | ✅ **Build** |
| **B. Engagement that ALREADY has backend schema (just switch on)** | | | | |
| B1 | Post **likes** (UI exists; schema+triggers exist) | ✅ Build | S | ☐ |
| B2 | **In-app chat** (backend built but dormant) | 🕓 Defer | M | ☐ |
| **C. Social-graph / vanity features (prototype — are they real?)** | | | | |
| C1 | **Follows / "Connect" / follower counts** | 🕓 Defer | L | ☐ |
| C2 | **Stories** (24-hour ephemeral) | ❌ Skip | M | ☐ |
| C3 | **"Tutors you may know"** (university peers) | 🕓 Defer | M | ☐ |
| C4 | **Ratings & reviews** | 🕓 Defer | L | ☐ |
| C5 | **"Successful sessions" count** | ❌ Skip | L | ☐ |
| C6 | **"Qualified" verification badge** | 🕓 Defer | M | ☐ |
| **D. Search / browse filters** | | | | |
| D1 | Filter by tutor **age** | ✅ Build | S | ☐ |
| D2 | Filter by tutor **gender** | ✅ Build | S | ☐ |
| D3 | Filters for **rating / years / sessions / followers** | 🕓 Depends on C | M | ☐ |
| D4 | Extend browse to the **full filter set** (price, district, mode, subject) | ✅ Build | M | ☐ |
| **E. Analytics & payments** | | | | |
| E1 | **Analytics dashboard** (views, reach, who viewed you) | 🕓 Defer | L | ☐ |
| E2 | **Premium / in-app payments** | 🕓 Defer | L | ☐ |
| **F. Notifications** | | | | |
| F1 | Activity feed / notifications | ❌ Skip (already out) | L | ☐ |
| **G. Minor shape mismatches** | | | | |
| G1 | Post kinds `whiteboard`/`quote` vs `image`/`video` | ❌ Skip | S | ☐ |
| **H. Seeker (student/parent) app — new since this doc (Jun 25)** | | | | |
| H1 | Student/parent onboarding persistence (backend already supports it; frontend payload was wrong) | ✅ Frontend fix | S | ✅ **DONE** (frontend; verify e2e) |
| H2 | Seeker **post-feed** endpoint (Home shows a post stream; `/api/feed` returns tutor cards) | 🕓 Decide | M | ☐ |
| H3 | **Saved / bookmarked tutors** (Saved tab; in-memory) | 🕓 Defer | S | ☐ |
| H4 | Seeker **saved search filters** (device-local today) | ❌ Skip / optional | S | ☐ |

---

## A. Onboarding data you already collect but the backend discards

These are the most important, because a tutor **fills them in today and the answers
vanish on save**. You're already asking for them — the only question is whether to
keep them.

### A1 — Tutor teaching levels  ·  ✅ Build (S)
- **Frontend:** `TutorTeachLevels` screen ("Who do you teach?") — multi-select of the
  6 levels, stored as `tutor:levels`. `TutorSD` even shows them on its review screen.
- **Backend:** no column/table. `POST /api/onboarding` explicitly reports them as
  *"no DB home yet"* and drops them.
- **Why build:** which levels a tutor teaches is core info for display and matching.
  Cheap to add (a `tutor_levels` table or a `text[]` column).

### A2 — Per-subject "relevant experience" list  ·  ✅ Build (S)
- **Frontend:** `TutorSD` collects, per subject, an `experiences[]` list (text +
  duration/event + ongoing flag + year).
- **Backend:** no column; onboarding drops it.
- **Why build:** it's part of the tutor's selling story (already on the "Strengths &
  Details" screen). Add a `jsonb` column on `tutor_subcategories`. *(Alternative: ❌
  remove the field from the screen if you've decided it's clutter.)*

### A3 — Education history + "currently studying"  ·  🕓 Decide (M)
- **Frontend:** `TutorAbout` collects a **multi-school** education history (one block
  per level — kindergarten/primary/secondary/university — each with institution +
  qualification + score) **plus** a "currently studying" list (institution + programme).
- **Backend:** only a single `tutor_profiles.university` text field.
- **Decision:** the frontend is much richer than the backend here. Either (a) store the
  whole history as `jsonb` on `tutor_profiles` (keeps the screen), or (b) simplify the
  screen to one "university" field (drops the richness). My lean: **(a) jsonb**, since
  the screen is already built and education is a credibility signal.

### A4 — Gender value mismatch  ·  ✅ Build (S)
- **Frontend:** offers `male / female / lgbtq / na`.
- **Backend:** enum is `male / female / other / prefer_not_to_say`.
- **Fix:** either add `lgbt` to the backend enum (if you want it as a real category) or
  map `lgbtq→other`, `na→prefer_not_to_say`. A product/wording decision, tiny to do.

### A5 — First/last name vs single name  ·  ✅ Build (S)
- **Frontend:** `TutorAbout` collects **first name + last name** separately (both required).
- **Backend:** has `full_name` and `display_name`.
- **Fix:** the save step should combine them (e.g. `full_name = "First Last"`). Trivial,
  but needs deciding so names actually persist.

---

## B. Engagement that already has backend schema (switch on)

### B1 — Post likes  ·  ✅ Build (S)
- **Frontend:** the feed has a working like button (red pop + count) in `FeedScreen`.
- **Backend:** `post_likes` table + `likes_count` triggers **already exist** — but there's
  no like/unlike endpoint wired.
- **Why build:** small (one endpoint), and the UI is already there. *(Note: the frontend
  removed comments; backend comment schema can stay dormant.)*

### B2 — In-app chat  ·  🕓 Defer (M)
- **Frontend:** `ChatScreen` is a full conversation UI (sample data).
- **Backend:** `conversations`/`messages` + endpoints **exist but are dormant**, no
  real-time.
- **Why defer:** it's built but switched off by choice. Turn on when you want messaging
  to be real — your call on timing. (Until then, contact stays WhatsApp + WeChat.)

---

## C. Social-graph / vanity features — prototype, decide if real

This whole group is the prototype's "make it feel like Instagram" layer. None of it
exists in the backend, and each is a meaningful new system. **These are genuine product
decisions, not just engineering.**

### C1 — Follows / "Connect" / follower counts  ·  🕓 Defer (L)
- **Frontend:** "Connect" buttons, `following` state, `followers` counts everywhere.
- **Backend:** no follow/social graph at all.
- **Why defer:** following changes the product model (a social network vs a directory).
  Decide whether tutors following each other is actually a goal before building it.

### C2 — Stories (24-hour)  ·  ❌ Skip (M)
- **Frontend:** "Your story" + a stories row.
- **Backend:** stores permanent **posts**, not ephemeral stories.
- **Why skip:** posts already cover "share content." Ephemeral stories add an expiry/
  media system for little marketplace value. Revisit only if engagement needs it.

### C3 — "Tutors you may know"  ·  🕓 Defer (M)
- **Frontend:** a strip suggesting other tutors from your **university** (+ `mutual` count).
- **Backend:** matching is seeker→tutor by subject/etc — no tutor→tutor suggestions.
- **Why defer:** depends on C1 (follows) to be meaningful; low priority.

### C4 — Ratings & reviews  ·  🕓 Defer (L)
- **Frontend:** every tutor has a `rating` (e.g. 4.7★) and a min-rating filter.
- **Backend:** no reviews/ratings.
- **Why defer (but important):** trust is central to a marketplace, so this matters
  eventually — but it needs rules (who can review? after what? moderation?). Worth a
  dedicated design later, not a quick add.

### C5 — "Successful sessions" count  ·  ❌ Skip (L)
- **Frontend:** a `sessions` stat + filter (e.g. "280 sessions").
- **Backend:** no bookings/sessions exist (contact is off-platform via WhatsApp).
- **Why skip:** you can't count sessions you don't broker. Only revisit if you add
  in-app booking.

### C6 — "Qualified" verification badge  ·  🕓 Defer (M)
- **Frontend:** a green "Qualified" badge ("earned through LearnSum's own verification").
- **Backend:** no verification system (already on your TODO).
- **Why defer:** needs a real review/approval flow. Until then the badge is cosmetic.

---

## D. Search / browse filters

The frontend's advanced filter sheet (`FilterSheet`) offers: **price, age, rating,
years, sessions, followers, mode, districts, gender**. The backend's `GET /api/tutors`
currently filters only by subcategory, district, format, type, and rate.

### D1 — Filter by age  ·  ✅ Build (S) — you already store `age`; just expose it.
### D2 — Filter by gender  ·  ✅ Build (S) — you already store `gender`; expose it (after A4).
### D3 — Rating / years / sessions / followers filters  ·  🕓 Depends on C — these can't
work until ratings (C4), follows (C1) and sessions (C5) exist. (Years-of-experience is
partial — derivable from per-subject data.)
### D4 — Extend browse to the full set  ·  ✅ Build (M) — already a known backend TODO;
add the remaining real filters (price range, district multi, mode, subject).

---

## E. Analytics & payments

### E1 — Analytics dashboard  ·  🕓 Defer (L)
- **Frontend:** `AnalyticsScreen` shows profile views, post reach, new followers, and a
  "who viewed you" list (all behind a premium paywall).
- **Backend:** none of this — no view tracking, no event analytics, no follower counts.
- **Why defer:** needs an event-tracking system + the social counts from group C. Big.

### E2 — Premium / in-app payments  ·  🕓 Defer (L)
- **Frontend:** the Analytics tab is gated behind an "Upgrade to Premium" paywall.
- **Backend:** no payments, no subscriptions, no entitlements.
- **Why defer:** a major project (Stripe / Apple-Google IAP, billing, entitlement
  checks). Decide the business model before any of it.

---

## F. Notifications

### F1 — Activity / notifications  ·  ❌ Skip (already out)
- **Frontend:** a heart icon with a red activity dot (no `/notifications` route).
- **Backend:** `push_tokens`/`notifications` tables exist but unused; explicitly out.
- **Why skip:** already a deliberate non-feature. Leave the dot cosmetic.

---

## G. Minor shape mismatches

### G1 — Post kinds  ·  ❌ Skip / tiny
- **Frontend:** post media kinds include `whiteboard` and `quote`.
- **Backend:** `post_media.media_type` is `image`/`video`; `post_type` is
  `update`/`showcase`/`result`.
- **Fix:** map `whiteboard`→image and `quote`→a text post, or ignore — purely cosmetic.

---

## H. Seeker (student/parent) app — new since this doc (Jun 25)

The frontend's `/feed` is no longer a placeholder — it's a 4-tab seeker shell (Home post-feed /
Search + Quick Match / Saved / Account), built front-end-only with **sample data** (it reuses the
tutor prototype's `tutorData.ts`). As with the tutor-home shell, "on screen" ≠ "a committed product
feature" — these are the decisions.

### H1 — Student/parent onboarding persistence  ·  ✅ Frontend fix — DONE (S)
- **Status:** ✅ **Fixed on the frontend** (`seekerOnboardingPayload.ts`). The `CreateAccount` step
  creates the account and then `POST /api/onboarding` saves the answers — now in the correct shape, so
  on success it **persists with no backend change**. *(Still worth one real end-to-end test against the
  live backend — sign up a new student, complete onboarding, confirm the rows land.)*
- **What was wrong (NOT a backend gap):** `POST /api/onboarding` already handles `student` and `parent`
  in full (writes prefs + interests + availability, and for parents the child rows, via
  `complete_onboarding`). The frontend payload had the **wrong shape**, so the (best-effort) save
  silently failed. Corrected:
  - `education_level` → **`school_level`**.
  - `interests` were objects `{subcategory, category, label}` → now an array of subject **slug strings**
    (e.g. `["mathematics", "basketball"]` — slugs match since migration 0015).
  - parent payload nested top-level `children` → now **`parent: { searching_for_self, children: [...] }`**.
- *(Budget isn't collected in seeker onboarding, so `budget_max_per_hour` stays null — fine.)*

### H2 — Seeker post-feed endpoint  ·  🕓 Decide (M)
- **Frontend:** the seeker **Home** tab is an Instagram-style stream of tutor **posts** (sample data).
- **Backend:** `GET /api/feed` returns **tutor cards** (display name / subjects / district, either
  personalized via `match_tutors_for_seeker` or latest-first), **not** a stream of posts. No cross-tutor
  post-stream endpoint exists.
- **Decision:** either (a) build a post-stream feed (aggregate published tutors' posts), or (b) make the
  seeker Home a **tutor-card** feed off the existing `/api/feed` and keep post browsing on each tutor's
  profile. My lean: **(b)** for now — `/api/feed` already exists with real matching, a post-stream is a
  bigger build, and the post-feed is the deferred browse surface.

### H3 — Saved / bookmarked tutors  ·  🕓 Defer (S)
- **Frontend:** a **Saved** tab bookmarks tutors (in-memory, session-only via a small store).
- **Backend:** no saved/bookmarks table or endpoint.
- **Why defer:** nice-to-have; cheap when wanted (a `saved_tutors` table + save/unsave/list endpoints).
  Until then it's session-only on the device.

### H4 — Seeker saved search filters  ·  ❌ Skip / optional (S)
- **Frontend:** the Search tab's advanced filters now persist across restarts via **AsyncStorage**
  (device-local) — no backend needed.
- **Backend:** a `/api/filters` route already exists if you ever want filters synced across devices.
- **Why skip:** device-local is fine for a single-device user; only wire it to the backend if
  cross-device sync becomes a goal.

---

## My overall recommendation (if you want a default path)

1. **Build group A now** (A1, A2, A4, A5; decide A3) — you're already collecting this
   data and currently losing it. Highest value, lowest effort.
2. **Build B1 (likes) and D1/D2/D4 (real search filters)** next — small, and the UI
   already expects them.
3. **Turn on B2 (chat) when you're ready** for messaging to be real.
4. **Park groups C, E, F** as product decisions — most are prototype polish (stories,
   follows, analytics, payments) that need a business call before any engineering. C4
   (reviews) and C6 (verification) are the two worth scheduling deliberately later.

Mark the "Your call" column and I'll build the ✅ items.
