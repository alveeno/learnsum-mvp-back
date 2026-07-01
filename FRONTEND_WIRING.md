# Frontend ↔ Backend Wiring Map

A plain-English guide to connecting the LearnSum app (`learnsum-mvp-expo-app`)
to this backend. Written for a non-technical reader; a developer can use the
endpoint names directly.

> **Mental model:** the app (phone) is the *dining room*; this backend is the
> *kitchen*; Supabase is the *filing cabinet*. "Wiring" = installing the *waiter*
> who carries orders between them. The kitchen is already built — every endpoint
> below exists. The job is hiring the waiter for each screen.

---

## ⭐ Build order — wire the *core loop* first

Don't wire screens in file order. Wire the **core loop** — the chain that makes the
marketplace actually work — top to bottom, and leave everything else on mock data until
it's proven:

> **A tutor signs up → onboards → publishes → appears in a seeker's feed → the seeker opens
> the profile → taps WhatsApp / Instagram / WeChat.**

**🟢 Tier 1 — the core loop (wire first, in this order):**
1. **Auth + token helper** (§1) — replaces the mock "DEV · Logged in" state; everything depends on it.
2. **Sign up / log in** (§3.2–3.3) — `POST /api/auth/signup` / `login`. **Credentials come first (all roles).**
3. **Subject pickers** — `GET /api/categories` (so subjects map to real IDs).
4. **Onboarding one-shot save** (§3.3) — `POST /api/onboarding` (where the tutor's levels/experience/education land).
5. **Tutor publish** (§3.5) — `PATCH /api/tutors/[slug]` `is_published:true` (else the profile is invisible).
6. **Home feed** (§3.4) — `GET /api/feed`.
7. **Public tutor profile + contact** (§3.7) — `GET /api/tutors/[slug]` + the contact buttons (the loop closes here).
8. **Posts — view then create** (§3.6) — `GET`/`POST /api/tutors/[slug]/posts` (+ `POST /api/upload`).

**🟡 Tier 2 — wire right after** (the loop works without them): profile editing + account
deletion (§3.8). ✅ **Done (Jun 26):** seeker **search + real filters**, **saved tutors**, and post
**likes** (§3.7).

**⚪ Tier 3 — leave as mock / don't wire** (no backend, or deferred): Analytics,
Premium/payments, Stories, "Tutors you may know", Qualified badge, followers/ratings filters,
notifications. (See `BACKEND_GAP_ANALYSIS.md`.) *(Chat moved to ✅ wired — Jun 27.)*

The day Tier 1 works end-to-end you have a real, functioning marketplace — even with every
Tier-2/3 screen still on mock data. That's the milestone.

---

## 0. How to read each entry

- **What the user does** — the button/screen.
- **Call** — which kitchen hatch (endpoint) the app knocks on.
- **Sends** — what the app hands over.
- **Gets back** — what the kitchen returns to draw on screen.
- **Note** — plain-English gotchas.

Endpoints are written `METHOD /path` — e.g. `POST /api/onboarding`. `POST` = "save
something new", `GET` = "give me something", `PATCH`/`PUT` = "update something",
`DELETE` = "remove something".

---

## 1. One-time setup (do this once, before any screen)

Two foundational pieces the whole app shares:

1. **The backend's address (base URL).** The app needs to know where the kitchen
   is. In development that's `http://localhost:3000`; in production it's your
   Vercel URL. Store it in one place so every call uses it.

2. **The wristband rule (token).** After login the app receives a **token** (a
   festival wristband). Every protected call must flash it as a header:
   `Authorization: Bearer <token>`. Build **one** helper that automatically
   attaches it to every request — then no individual screen has to remember.

> ⚠️ **The "DEV · Logged in" badge is a dev-only toggle** that flips the app between the
> **logged-in** and **logged-out** views (e.g. "Tutors you may know" only shows when logged
> in, since it keys off the signed-in tutor's own education record). It runs on mock state
> today — **nothing currently reaches this backend.** Step 1 replaces that mock with a real
> session + token.

---

## 2. Fix these backend gaps FIRST (or accept the consequence)

These are places where a screen collects something the backend can't yet store
or serve. Decide each before wiring the affected screen:

| Gap | What happens today | Options |
|---|---|---|
| **Teaching levels** + **education history** + **per-subject experience** | ✅ **Now stored** (migration 0014): `tutor_profiles.teaching_levels` / `education` / `current_studies`, `tutor_subcategories.experience`. | Done — the app just needs to *send* them (see §3.3). |
| **Gender `lgbtq`/`na`, first/last name** | ✅ **Now handled** (0014 + `/api/onboarding`): `lgbtq`→`lgbt`, `na`→prefer-not-to-say, first+last→`full_name`. | Done — just send them. |
| **Subject slugs ↔ database** | ✅ **Resolved (migration 0015):** the database taxonomy is seeded to mirror the app's subject slugs (frontend = source of truth), so onboarding maps every subject by slug. | Done — to add subjects later, update the app **and** re-seed (or have the app fetch `GET /api/categories`). |
| **Chat tab** | ✅ **Wired (Jun 27)** — real conversations over REST **polling** (the app has no live connection). Reachable from the tutor **Chat tab**, the seeker **Account → Messages**, and a **Message** button on each tutor profile. | Done. Upgrade to instant Realtime later by adding the Supabase client. |
| **Analytics tab (padlock)** | **No analytics in the backend at all.** | Keep as a placeholder. |
| **Stories / "Your story" circles** | Backend stores *posts*, not 24-hour *stories*. | Treat circles as decorative, or repurpose them to show posts. |
| **"Qualified" badge** | **No verification system** (TODO). | Cosmetic/hardcoded for now. |

---

## 3. The wiring map, screen by screen

### 3.1 Welcome screen — "I am a… Student / Parent / Tutor" + Continue
- **What the user does:** picks a role, taps Continue.
- **Call:** *(none yet)* — just remember the chosen role on the phone.
- **Note:** Picking a role just routes into that role's flow. **The account is created up
  front — the first step of the flow is sign-up / log-in (credentials first, all roles)** —
  not at the end. (Tutors reach this via the "Complete profile" prompt on the home screen; see 3.3.)

### 3.2 "Log in now" (returning users)
- **What the user does:** enters email + password (or taps a social/phone option).
- **Call:** `POST /api/auth/login` — or `POST /api/auth/oauth` (Google/Apple/
  Microsoft) / `POST /api/auth/phone` then `POST /api/auth/phone/verify` (SMS code).
- **Sends:** `{ email, password }` (or provider / phone number).
- **Gets back:** a session **token** + `is_new_user`. Store the token (step 1).
- **Note:** `is_new_user = false` → skip onboarding, go straight to home.
- **Staying logged in:** the app stores the session's **`refresh_token`** too and, on a 401 (the ~1h
  access token expired), calls **`POST /api/auth/refresh` `{ refresh_token }`** to mint a fresh session —
  so a returning user isn't forced to log in every launch. The route does
  `supabase.auth.refreshSession({ refresh_token })`; a rejected token returns 401 and the app logs out.

### 3.3 Onboarding flow → create account first, then save everything  ⭐ THE BIG ONE
This is the heart of it. **Credentials come first (all roles):**

1. **Sign-up / log-in is the FIRST step.** **Call `POST /api/auth/signup`** — Sends
   `{ email, password, role }`. Gets back a live token. *(The account now exists; store the
   token — §1.)* A returning user logs in instead (`is_new_user = false` → skip onboarding).
   Tutors reach this gate via the home-screen "Complete profile" prompt.
2. **Then they answer the onboarding questions** (levels, subjects, rates, languages,
   districts, availability…). Each screen writes into a **temporary notebook in the phone's
   memory** while the user is already signed in.
3. **On the final step, call `POST /api/onboarding`** (with the token) — Sends the whole
   notebook in one parcel. The backend sorts it into the right drawers and translates the
   app's words into database codes automatically.

**What the tutor parcel looks like** (plain shape):
```
{
  "profile": { "first_name": "Jane", "last_name": "Wong", "gender": "lgbtq", "age": 0 },
  "tutor": {
    "slug": "jane-wong",                       // their public URL: /tutors/jane-wong
    "university": "HKU",
    "format": "both",                          // online | in_person | both
    "type": "individual",                      // individual | group | both
    "levels": ["high", "university"],          // which levels they teach (A1)
    "education": { "university": [{ "institution": "HKU", "qualification": "BSc", "score": "First" }] },
    "current_studies": [{ "institution": "HKU", "programme": "MPhil" }],
    "subjects": [
      { "subcategory": "mathematics", "years": "5", "pay": 350, "format": "in_person", "districts": ["central", "causeway_bay"],
        "achievements": ["..."], "qualifications": {...}, "exam_results": {...},
        "experiences": [{ "text": "...", "kind": "duration", "dur": "2", "unit": "years", "ongoing": true }] }
    ],
    "languages": { "english": 4, "cantonese": 3 },   // language → 1..4 proficiency
    "availability": { "mon": [{ "start": 540, "end": 720 }] }  // minutes from midnight
  }
}
```
- **Gets back:** `{ ok: true, role, skipped }`. **Watch the `skipped` field** — it
  lists anything the backend couldn't store (today: the "levels" + "experience").
- **Note (student/parent):** same idea with a `student` block, or a `parent` block
  containing a `children` array (1–6 kids, each with their own prefs). After save,
  a tutor lands **unpublished** → see 3.5.

### 3.4 Tutor home feed (the story circles + posts)
- **What the user does:** opens Home.
- **Call:** `GET /api/feed`.
- **Gets back:** `{ feed: [ { slug, display_name, avatar_url, district, bio,
  categories[], score? } ], personalized, pagination }`. Draw each item as a card.
- **Note:** Guests and brand-new tutors get the **latest tutors**; seekers with
  interests get a **personalized ranked** list. The circles/posts are these items.

### 3.5 "Complete profile" → fill details → Publish
- **What the user does:** taps "Complete profile", adds photo, bio, WhatsApp /
  Instagram / WeChat, then publishes.
- **Calls:**
  - First time the tutor profile is created (if not already): `POST /api/tutors`.
  - Save edits: `PATCH /api/tutors/<slug>` — Sends any of `{ bio, avatar_url,
    whatsapp_number, instagram_handle, wechat_id, is_published }`.
  - **Publish** = the same PATCH with `{ "is_published": true }`. Unpublish = `false`.
- **Note:** Until `is_published` is true, **no one else can see the profile** — this
  is why a fresh tutor isn't in others' feeds yet.

### 3.6 Posts (the "+" button / post feed)
- **Create:** `POST /api/tutors/<slug>/posts` — Sends `{ content, content_zh?,
  post_type, media?: [{ url, media_type }] }`. (Media URLs come from 3.9 first.)
- **View:** `GET /api/tutors/<slug>/posts` (public, paginated).
- **Delete own:** `DELETE /api/posts/<id>`.

### 3.7 Search / browse + viewing another tutor  ✅ **both Search tabs wired (seeker Jun 26, tutor Jun 27)**
- **Browse / Search tab:** `GET /api/tutors?subcategory_id=&subdistrict=&tutoring_format=&tutoring_type=&min_rate=&max_rate=&min_age=&max_age=&gender=&language=`.
  - **Both** the seeker and tutor **Search** tabs are now real: the FilterSheet's price/age/lesson-mode/
    location/gender map to these params. **Location is `subdistrict`** — a comma-separated list of
    subdistrict slugs (e.g. `causeway_bay`); a tutor matches if ANY of their per-subject
    `tutor_subcategories.districts` overlaps the set (migration `0021`). `gender`/`subdistrict`/`language`
    accept comma-separated lists → match ANY. Each card now returns a `subdistricts: string[]`. There's **no free-text search** on the backend, so the typed
    query narrows the fetched cards on the device. Rating/years/sessions/followers have no backend filter —
    hidden in both sheets. A tutor only appears once **published**.
- **Tap a tutor:** `GET /api/tutors/<slug>` → full profile + their posts + contact
  buttons. The **WhatsApp/WeChat** buttons just open those apps with the
  saved number/handle — no backend call needed to "contact".
- **Save / bookmark a tutor:** ✅ **wired** — `GET`/`POST /api/saved`, `DELETE /api/saved/<slug|id>`
  (the Saved tab). Saving a tutor that isn't published / doesn't exist returns 404 (sample Home tutors).
- **Like a post:** ✅ **wired** on the tutor profile's post feed — `POST`/`DELETE /api/posts/<id>/likes`;
  the posts list (`GET /api/tutors/<slug>/posts`) returns `liked_by_me` for the initial heart state.
- **Message a tutor:** ✅ **wired** — a **Message** button on the real tutor profile calls
  `POST /api/conversations` then opens the thread. Works from both the seeker and tutor sides (a tutor's
  Search → a real tutor → Message), so **tutor↔tutor and seeker→tutor** chat both work.

> **Still sample data (deferred):** only the seeker **Home** feed + its like/save buttons (the H2
> "leave Home as-is" call). Both Search tabs, Saved, the profile post-feed likes, and chat are real.

### 3.8 Profile & account editing (Profile tab)
- **Load current values:** `GET /api/auth/me` → `{ user, profile, detail }`.
- **Edit common + student/parent prefs:** `PATCH /api/profiles/me`. Now also takes the **seeker
  profile** fields from the `SeekerAbout` screen — `bio`, `phone` (profiles, migration 0022) and, for
  students, the `student` block's `school_level` + `education` (full school history jsonb, migration
  0023). Onboarding sends the same via the `POST /api/onboarding` `profile` block + `student.education`.
- **Account information (Profile/Account tab):** the new "Account information" section also edits the
  seeker's **`wechat_id`** via `PATCH /api/profiles/me` (`profiles.wechat_id`, **migration 0031** — a
  shared column; tutors keep their own `tutor_profiles.wechat_id` edited via `PATCH /api/tutors/[slug]`).
  `GET /api/auth/me` returns it for free (`select('*')`). Scope: this is the seeker's own self-view/edit
  only — `get_seeker_for_tutor` (0029) still returns `wechat → NULL`, so it isn't exposed to tutors yet.
  (No backend **change-password** endpoint exists — that part of the section is UI-only / not wired.)
- **Tutor subjects:** `PUT /api/tutor/subjects` · **languages:** `PUT /api/tutor/languages`.
- **Children (parents):** `GET/POST /api/children`, `PATCH/DELETE /api/children/<id>`.
- **Weekly availability:** `GET/PUT /api/availability` (parents add `?child_id=`).
- **Saved filters / Quick Match:** `GET/PUT /api/filters`.
- **Delete account:** `DELETE /api/profiles/me` (wipes their data + uploaded files).

### 3.9 Photo / video uploads (avatar, post media)
Two-step, because files are big:
1. **Ask for a drop-off slot:** `POST /api/upload` — Sends `{ kind: "avatar"|"post",
   content_type }`. Gets back a **signed upload URL** + the file's future `public_url`.
2. **Upload the bytes** to that URL, then **save the `public_url`** wherever it
   belongs — avatar via `PATCH /api/profiles/me`, post image via the post's `media`.

### 3.10 Bottom navigation — backend status at a glance
| Tab | Backend | Wire it? |
|---|---|---|
| **Home** | `GET /api/feed` | ✅ yes |
| **Search** | `GET /api/tutors` | ✅ yes |
| **Chat** | `GET/POST /api/conversations` + messages (REST polling) | ✅ **wired** |
| **Analytics** | **doesn't exist** | ⏸ placeholder |
| **Profile** | `GET /api/auth/me` + edit endpoints | ✅ yes |

---

## 4. Endpoint cheat-sheet

| Job | Endpoint |
|---|---|
| Sign up (email) | `POST /api/auth/signup` |
| Log in | `POST /api/auth/login` |
| Refresh session | `POST /api/auth/refresh` `{ refresh_token }` → `{ user, session }` |
| Log out | `POST /api/auth/logout` |
| Social login | `POST /api/auth/oauth` → `GET /api/auth/callback` |
| Phone code | `POST /api/auth/phone` → `POST /api/auth/phone/verify` |
| Who am I (prefill) | `GET /api/auth/me` |
| Save all onboarding | `POST /api/onboarding` |
| Edit account/prefs | `PATCH /api/profiles/me` |
| Delete account | `DELETE /api/profiles/me` |
| Categories list | `GET /api/categories` |
| Home feed | `GET /api/feed` |
| Browse tutors | `GET /api/tutors` |
| One tutor (+posts) | `GET /api/tutors/<slug>` |
| Create/edit tutor profile | `POST /api/tutors` · `PATCH /api/tutors/<slug>` |
| Tutor subjects / languages | `PUT /api/tutor/subjects` · `PUT /api/tutor/languages` |
| Availability | `GET/PUT /api/availability` |
| Children (parent) | `/api/children` · `/api/children/<id>` |
| Saved filters | `GET/PUT /api/filters` |
| Posts | `GET/POST /api/tutors/<slug>/posts` · `DELETE /api/posts/<id>` |
| Like / unlike a post | `GET/POST/DELETE /api/posts/<id>/likes` |
| Saved / bookmarked tutors | `GET/POST /api/saved` · `DELETE /api/saved/<slug\|id>` |
| Upload media | `POST /api/upload` |
| In-app chat ✅ wired (REST polling) | `GET/POST /api/conversations` · `GET/POST/PATCH /api/conversations/<id>/messages` |

*(Dormant, not wired: `/api/tutors/<slug>/inquiries`.)*

---

## 5. Suggested order to wire it up

1. **Auth + token helper** (section 1) — replaces the fake DEV login. Everything
   else depends on this.
2. **Login** (3.2) — quickest way to prove the connection works end to end.
3. **Onboarding → signup + save** (3.3) — the core flow; decide the section-2 gaps first.
4. **Home feed** (3.4) — turns the placeholder feed into real data.
5. **Complete profile + publish** (3.5), then **posts** (3.6).
6. **Browse + tutor profile** (3.7), **profile editing** (3.8), **uploads** (3.9).
7. Leave **Chat** and **Analytics** as placeholders until you choose to build them.

> The screen edits in steps 2–9 happen in the **`learnsum-mvp-expo-app`** repo.
> The section-2 gap fixes happen **here** in the backend.
