# Frontend ↔ Backend Wiring Map

A plain-English guide to connecting the LearnSum app (`learnsum-mvp-expo-app`)
to this backend. Written for a non-technical reader; a developer can use the
endpoint names directly.

> **Mental model:** the app (phone) is the *dining room*; this backend is the
> *kitchen*; Supabase is the *filing cabinet*. "Wiring" = installing the *waiter*
> who carries orders between them. The kitchen is already built — every endpoint
> below exists. The job is hiring the waiter for each screen.

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

> ⚠️ **Today the app uses a fake "DEV · Logged in" session** (the badge in the
> tutor home screenshot). Nothing currently reaches this backend. Step 1 is what
> replaces that mock with a real connection.

---

## 2. Fix these backend gaps FIRST (or accept the consequence)

These are places where a screen collects something the backend can't yet store
or serve. Decide each before wiring the affected screen:

| Gap | What happens today | Options |
|---|---|---|
| **"Who do you teach?" levels** (Kindergarten…Adult) | `POST /api/onboarding` **throws these away** (code reports `"tutor teaching levels … no DB home yet"`). | Add a small table/column to store them, **or** accept they aren't saved. |
| **Tutor "relevant experience" list** | Also thrown away (no column). | Add a column on `tutor_subcategories`, or drop the field from the screen. |
| **Subject slugs ↔ database** | Onboarding maps the app's subject words (e.g. `"mathematics"`) to database IDs. If the app's hardcoded words don't match the seeded database words, the subject is silently skipped. | Either seed the database to match the app's words, **or** have the app fetch `GET /api/categories` and use the real IDs. |
| **Chat tab** | Backend chat is built but **switched off** (TODO). | Leave the tab as "coming soon" until you turn chat on. |
| **Analytics tab (padlock)** | **No analytics in the backend at all.** | Keep as a placeholder. |
| **Stories / "Your story" circles** | Backend stores *posts*, not 24-hour *stories*. | Treat circles as decorative, or repurpose them to show posts. |
| **"Qualified" badge** | **No verification system** (TODO). | Cosmetic/hardcoded for now. |

---

## 3. The wiring map, screen by screen

### 3.1 Welcome screen — "I am a… Student / Parent / Tutor" + Continue
- **What the user does:** picks a role, taps Continue.
- **Call:** *(none yet)* — just remember the chosen role on the phone.
- **Note:** By design (your "Option A"), **the account is created at the very end
  of onboarding**, not here. So Continue only moves to the first onboarding screen.

### 3.2 "Log in now" (returning users)
- **What the user does:** enters email + password (or taps a social/phone option).
- **Call:** `POST /api/auth/login` — or `POST /api/auth/oauth` (Google/Apple/
  Microsoft) / `POST /api/auth/phone` then `POST /api/auth/phone/verify` (SMS code).
- **Sends:** `{ email, password }` (or provider / phone number).
- **Gets back:** a session **token** + `is_new_user`. Store the token (step 1).
- **Note:** `is_new_user = false` → skip onboarding, go straight to home.

### 3.3 Onboarding flow → create account + save everything  ⭐ THE BIG ONE
This is the heart of it. Every onboarding screen (role, levels, subjects, rates,
languages, districts, availability…) writes into a **temporary notebook in the
phone's memory** — *nothing is sent to the backend yet*. Then the final screen
does it all at once:

1. **Final screen collects email + password.**
2. **Call `POST /api/auth/signup`** — Sends `{ email, password, role }`. Gets back
   a live token. *(The account now exists.)*
3. **Immediately call `POST /api/onboarding`** (with the token) — Sends the whole
   notebook in one parcel. The backend sorts it into the right drawers and
   translates the app's words into database codes automatically.

**What the tutor parcel looks like** (plain shape):
```
{
  "profile": { "display_name": "...", "full_name": "...", "age": 0, "gender": "..." },
  "tutor": {
    "slug": "jane-wong",                       // their public URL: /tutors/jane-wong
    "university": "HKU",
    "format": "both",                          // online | in_person | both
    "type": "individual",                      // individual | group | both
    "subjects": [
      { "subcategory": "mathematics", "years": "5", "pay": 350,
        "achievements": ["..."], "qualifications": {...}, "exam_results": {...} }
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

### 3.7 Search / browse + viewing another tutor
- **Browse / Search tab:** `GET /api/tutors?subcategory_id=&district=&min_rate=&…`.
- **Tap a tutor:** `GET /api/tutors/<slug>` → full profile + their posts + contact
  buttons. The **WhatsApp/Instagram/WeChat** buttons just open those apps with the
  saved number/handle — no backend call needed to "contact".

### 3.8 Profile & account editing (Profile tab)
- **Load current values:** `GET /api/auth/me` → `{ user, profile, detail }`.
- **Edit common + student/parent prefs:** `PATCH /api/profiles/me`.
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
| **Chat** | built but **switched off** (TODO) | ⏸ leave as placeholder |
| **Analytics** | **doesn't exist** | ⏸ placeholder |
| **Profile** | `GET /api/auth/me` + edit endpoints | ✅ yes |

---

## 4. Endpoint cheat-sheet

| Job | Endpoint |
|---|---|
| Sign up (email) | `POST /api/auth/signup` |
| Log in | `POST /api/auth/login` |
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
| Upload media | `POST /api/upload` |

*(Dormant, not wired: `/api/conversations*` chat, `/api/tutors/<slug>/inquiries`.)*

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
