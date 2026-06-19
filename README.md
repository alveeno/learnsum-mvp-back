# LearnSum — Backend API

The backend API for **LearnSum**, a Hong Kong two-sided tutoring marketplace. This repo is
**API routes only** (Next.js App Router) — there are no UI pages here. The mobile app lives
in a separate repo, `learnsum-mvp-expo-app`.

- **Stack:** Next.js (App Router, API routes only) · Supabase (Auth, Postgres, Storage) ·
  TypeScript · deployed on Vercel.
- **What it does:** auth (email/password, phone OTP, social login), one-shot onboarding,
  tutor profiles + posts, a personalized matching feed, browse/search, saved filters, file
  uploads, and full profile editing / account deletion.

## Docs (start here, not this file)
- **`CLAUDE.md`** — conventions + architecture decisions.
- **`plan.md`** — authoritative schema + API reference.
- **`ROADMAP.md`** — build roadmap and status.
- **`FRONTEND_WIRING.md`** — how each app screen maps to an endpoint.
- **`BACKEND_GAP_ANALYSIS.md`** — frontend features vs backend support (build / skip / defer).

## Run it
```bash
npm install
npm run dev   # http://localhost:3000
```
Requires a `.env.local` with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
(see `CLAUDE.md`). Database migrations live in `supabase/migrations/` and are applied
manually via the Supabase SQL editor.
