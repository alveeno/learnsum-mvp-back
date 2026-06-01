# MVP Launch Roadmap
## Hong Kong Tutoring Marketplace (Learnsum)

This document is the single source of truth for building this MVP. All Claude Code sessions and new claude.ai chats should reference this file alongside PLAN.md and CLAUDE.md.

---

## Project Summary

A Hong Kong-based two-sided tutoring marketplace with a social media twist. Parents and students can browse tutors across academic subjects, sports, culinary arts, creative arts, and more. Tutors — especially university students looking for side income — build Instagram-style profiles with posts, showcases, and content that markets their personality and skills, not just their qualifications.

**Key differentiator:** Unlike existing platforms like HKTA, tutor profiles work like social media — with a bio section and a scrollable post feed below it.

**Three user types:** Parents, Students, Tutors — each with different permissions, profile fields, and home feed experiences.

**Tech stack:** Next.js 14 (App Router, API only) + Supabase (Postgres) + TypeScript — deployed to Vercel as an API server. Frontend is React Native + Expo in a separate repository (`learnsum-app`). There is no UI code in this repository.

**Language support:** English and Traditional Chinese throughout.

**Location context:** All location filtering based on Hong Kong's 18 districts.

---

## Agent Roster

| Agent | Role | When to Use |
|---|---|---|
| ⚡ Rapid Prototyper | Fast iteration, quick fixes | Tweaks, small changes, unblocking errors fast |
| 🏗️ Backend Architect | API design, database, schema | Any backend, database, or API work |
| 🎨 Frontend Developer | React components, UI, pages | Building screens, components, layouts |
| 🚀 Growth Hacker | User acquisition, marketing | Launch strategy, landing pages, growth tactics |
| 🔍 Reality Checker | Quality gates, bug detection | Pre-launch review, catching critical issues |

**How to activate an agent in Claude Code:**
Start your prompt with: *"Activate [Agent Name] mode. Read CLAUDE.md, PLAN.md, and ROADMAP.md before starting."*

---

## How to Use This Roadmap

**Starting a new claude.ai chat:**
Paste this at the top of every new chat:
> "I am building a Hong Kong-based tutoring marketplace MVP called Learnsum. My roadmap is in ROADMAP.md, architecture decisions are in PLAN.md, and project conventions are in CLAUDE.md. I am currently on [Phase X, Step Y]. My question is: [your question]"

**Starting a new Claude Code session:**
Always begin with:
> "Read CLAUDE.md, PLAN.md, and ROADMAP.md before starting. I am currently working on [describe task]. Do not deviate from the stack and decisions documented in those files."

**Golden rule:** Claude Code has no memory between sessions. The three .md files are its only persistent memory. Always reference them explicitly.

---

## Current Status

Update this section as you complete each step.

- [x] Setup — Agents installed, project folder created
- [x] Phase 1, Step 1 — App described to Rapid Prototyper, 3 core features confirmed
- [x] Phase 1, Step 2 — Backend Architect produced schema and API structure, saved to PLAN.md
- [x] Phase 2, Step 1 — Next.js + Supabase scaffold complete, migrations applied, app loads on localhost:3000
- [x] Phase 2, Step 2 — Build first API endpoint
- [x] Phase 2, Step 3 — Commit working endpoints
- [ ] Phase 3, Step 1 — Scaffold React app screens
- [ ] Phase 3, Step 2 — Build screens one at a time
- [ ] Phase 3, Step 3 — Quick iterations with Rapid Prototyper
- [ ] Phase 4, Step 1 — Growth Hacker go-to-market plan
- [ ] Phase 4, Step 2 — Waitlist or landing page
- [ ] Phase 4, Step 3 — Save GROWTH.md
- [ ] Phase 5, Step 1 — Reality Checker review
- [ ] Phase 5, Step 2 — Fix critical blockers only
- [ ] Phase 5, Step 3 — Deploy to Render.com or Railway.app
- [ ] Phase 5, Step 4 — Final commit and push

---

## Setup (One Time)
**Duration:** ~30 minutes

### What was done
1. Forked and cloned msitarzewski/agency-agents from GitHub
2. Created ~/.claude/agents/ folder on Windows 11
3. Copied 5 MVP agent files into that folder:
   - engineering/engineering-frontend-developer.md
   - engineering/engineering-backend-architect.md
   - marketing/marketing-growth-hacker.md
   - engineering/engineering-rapid-prototyper.md
   - testing/testing-reality-checker.md
4. Created the learnsum-mvp project repository in GitHub Desktop
5. Opened project in VS Code and launched Claude Code with `claude`

---

## Phase 1 — Define What You Are Building
**Duration:** Day 1
**Agents:** ⚡ Rapid Prototyper, 🏗️ Backend Architect

### Step 1 — Describe your idea to the Rapid Prototyper
Activate Rapid Prototyper mode and describe the app in 2–3 sentences covering:
- What it does (the core action)
- Who it is for (the target user)
- The problem it solves

**App description used:**
> "My app is a Hong Kong-based tutoring marketplace where parents and students can browse tutors across academic subjects, sports, culinary arts, creative arts, and more. Unlike existing platforms like HKTA, tutors — especially university students looking for side income — can build a profile that works like social media, with posts, showcases, and content that markets their personality and skills, not just their qualifications. The core problem it solves is that parents struggle to find trustworthy, engaging tutors across diverse skill areas, while talented young tutors have no good platform to find students and stand out."

Ask for: 3 core MVP features and the simplest possible tech stack.

### Step 2 — Get your database plan from the Backend Architect
Use the full detailed prompt covering:
- Three user types (parent, student, tutor) with different permissions
- Low-friction onboarding — no long question lists upfront
- Non-blocking profile setup section for slow-changing info
- Tutor onboarding with sample profile carousel, category/subcategory selection, and per-subcategory fields (experience, pricing, achievements, qualifications, results)
- Student and parent profiles browseable by tutors on their home feed
- Instagram-style tutor profiles — bio at top, scrollable post feed below
- Posts supporting text, photos, and videos with likes and comments in schema even if not built in MVP
- Two-sided matching based on category interests, Hong Kong district, and preferred language
- Advanced search filters: language, district, group/individual, online/physical, category, subcategory, price range, availability by day and time
- Saved filter preferences for logged-in users
- Direct messaging with real-time support
- Push and in-app notification system
- Public browsing without account — account required only for saving preferences, profile info, and chat
- English and Traditional Chinese language support
- All 18 Hong Kong districts for location filtering

Save full output to PLAN.md.

**Follow-up prompts to run in the same session:**
1. *"Which parts of this schema are most likely to cause problems when we add likes, comments, and bilingual content later? What should we future-proof now?"*
2. *"Given everything in PLAN.md, what are the 3 most important things to build first in the MVP, and what should we cut or defer to version two?"*

### What to check in PLAN.md before moving on
- Full database tables and their relationships
- List of API endpoints grouped by feature area
- Confirmed 3 core MVP features
- Tech stack recommendation

---

## Phase 2 — Build the Backend
**Duration:** Days 2–4
**Agent:** 🏗️ Backend Architect

### Before starting each session
Run `/init` if not already done. Confirm PLAN.md and CLAUDE.md are in the project root. Start every session with:
> "Read CLAUDE.md, PLAN.md, and ROADMAP.md before starting. Do not make assumptions about the tech stack or schema — use only what is documented there."

### Step 1 — Set up the project foundation
**Status: Complete**

What was completed:
- Next.js 14 App Router scaffold with TypeScript, Tailwind, ESLint
- Supabase client configured (src/lib/supabase/client.ts)
- Supabase server client configured (src/lib/supabase/server.ts)
- Session refresh middleware (src/middleware.ts)
- shadcn/ui installed
- Migration files created (0001_initial_schema.sql, 0002_rls.sql)
- Migrations applied manually via Supabase SQL editor
- .env.local configured with Supabase URL, anon key, and service role key
- .env.local confirmed in .gitignore
- App confirmed loading on localhost:3000

**Security rules established:**
- Service role key must only appear in server-side files (Route Handlers, server actions)
- Never use NEXT_PUBLIC_ prefix for service role key
- Never import service role key into any component file

### Step 2 — Build API endpoints one at a time
Prompt pattern to use for each endpoint:
> "Activate Backend Architect mode. Read CLAUDE.md and PLAN.md. Build the [name] endpoint. Show me how to test it when done."

**Recommended build order for MVP:**
1. User authentication (sign up, sign in, sign out) — covers all three user types
2. User type selection and basic profile creation
3. Tutor profile read endpoint (public, no auth required)
4. Category and subcategory listing endpoint
5. Home feed matching endpoint (filtered by user type, district, language, categories)
6. Advanced search and filter endpoint
7. Save filter preferences endpoint (authenticated users only)
8. Tutor post creation and retrieval endpoints
9. Direct messaging endpoints
10. Notification endpoints

### Step 3 — Commit after each working endpoint
After each endpoint is confirmed working:
1. Open GitHub Desktop
2. Write a commit message describing the endpoint (e.g. "Add user authentication endpoints")
3. Click Commit to main

---

## Phase 3 — Build the Frontend
**Duration:** Days 5–8
**Agents:** 🎨 Frontend Developer, ⚡ Rapid Prototyper

> **Note:** All frontend work for Phase 3 is done in the `learnsum-app` repository (React Native + Expo), not this repository. This repo provides the API that the app consumes.

### Step 1 — Scaffold the core screens
Prompt:
> "Activate Frontend Developer mode. Read CLAUDE.md, PLAN.md, and ROADMAP.md. Create the core screen structure for the app. Start with: welcome screen with user type selection (parent, student, tutor), home feed page showing matched profiles, and a basic tutor profile page. Connect these to the backend endpoints already built. Do not build any other screens yet."

### Step 2 — Build screens one at a time
Recommended screen build order:
1. Welcome screen — user type selection (parent / student / tutor)
2. Home feed — tutor cards for parents and students, student listings for tutors
3. Tutor profile page — Instagram-style layout (bio top, post feed below)
4. Advanced search and filter panel
5. Profile setup section — "Set up your profile to get better matches"
6. Tutor onboarding — sample profile carousel, category selection, per-subcategory fields
7. Direct messaging screen
8. Notification centre

**Rule for each screen:** Test it in the browser before moving to the next one. If something looks broken, describe what you see and paste any error messages into Claude Code.

### Step 3 — Quick iterations with Rapid Prototyper
For small tweaks, layout adjustments, and fast fixes use:
> "Activate Rapid Prototyper mode. Quick fix: [describe the specific change]."

**Note:** Do not worry about polish in this phase. Get screens working first. Visual refinement comes after launch.

---

## Phase 4 — Plan Your Growth Strategy
**Duration:** Day 9 (can run in parallel with Phase 3 polishing)
**Agent:** 🚀 Growth Hacker

### Step 1 — Create your go-to-market plan
Prompt:
> "Activate Growth Hacker mode. My app is a Hong Kong-based tutoring marketplace called Learnsum. Tutor profiles work like Instagram — bio at the top, post feed below. There are three user types: parents, students, and tutors (mainly university students). Who are my first 100 target users and what are 3 zero-budget ways to reach them in the first week after launch? Focus specifically on Hong Kong channels."

### Step 2 — Set up a waitlist or landing page
Prompt:
> "Design a simple one-page landing with a waitlist email capture form for Learnsum. What free tools can I use to set this up without building a backend? Recommend something that works well for a Hong Kong audience."

Suggested free tools: Carrd.co for the page, Mailchimp or Beehiiv for email capture.

### Step 3 — Save the growth plan
Ask Claude Code to save everything to GROWTH.md and commit it with the message "Add go-to-market plan".

---

## Phase 5 — Quality Check and Launch
**Duration:** Day 10
**Agent:** 🔍 Reality Checker

### Step 1 — Run the Reality Checker
Prompt:
> "Activate Reality Checker mode. Read CLAUDE.md, PLAN.md, and ROADMAP.md. Review the codebase we have built. List the 5 most critical issues that could break the app or create a bad experience for a real user on day one. Focus on: authentication flows, data security, the tutor profile page, the home feed matching, and the chat feature."

### Step 2 — Fix blockers only
Fix only the critical blockers identified. Use the Rapid Prototyper for each fix:
> "Activate Rapid Prototyper mode. Fix this critical issue: [paste the specific issue from Reality Checker output]."

Save cosmetic issues, missing features, and nice-to-haves for version two.

### Step 3 — Deploy to free hosting
Prompt:
> "Activate Backend Architect mode. How do I deploy this Next.js and Supabase app to Vercel for free? Walk me through every step assuming I am using GitHub Desktop on Windows 11 and have no prior deployment experience."

**Why Vercel over Render/Railway for this stack:** Next.js is made by Vercel and deploys with zero configuration from a GitHub repository. It is the simplest option for a Next.js app.

### Step 4 — Final commit and push
In GitHub Desktop:
1. Commit all final changes with message "v0.1 MVP launch"
2. Click Push to origin
3. Confirm deployment is live on Vercel

---

## Key Decisions and Conventions

### Security
- `.env.local` is in `.gitignore` — never commit credentials
- `SUPABASE_SERVICE_ROLE_KEY` only in server-side files, never client-side
- `NEXT_PUBLIC_` prefix only for the anon key, never for the service role key
- RLS policies applied to all tables via 0002_rls.sql

### Database
- All UUIDs use `gen_random_uuid()` not `uuid_generate_v4()`
- Migrations live in `supabase/migrations/`
- Applied manually via Supabase SQL editor if CLI auth fails

### Code conventions
- TypeScript throughout — no plain JavaScript files
- All location data uses Hong Kong's 18 districts
- Bilingual content (English and Traditional Chinese) must be accounted for in all user-facing text fields

### What is deferred to version two
- Likes and comments on tutor posts (schema exists, interactions not built)
- In-app payments and booking system
- Review and rating system
- Advanced recommendation algorithm
- Verified tutor badges
- Group tutoring session management

---

## Troubleshooting Reference

### Claude Code has no memory between sessions
Always start sessions with: *"Read CLAUDE.md, PLAN.md, and ROADMAP.md before starting."*

### API Error 500 from Claude Code
Not a code problem — it is a server hiccup. Commit what exists, restart Claude Code with `claude`, then ask it to assess what was completed and what still needs to be done.

### Migration fails with uuid_generate_v4() error
Replace all instances of `uuid_generate_v4()` with `gen_random_uuid()` in the migration file. Supabase uses the latter.

### Migration auth fails via CLI
Run the migration manually: go to Supabase dashboard → SQL Editor → paste the contents of each migration file in order and run them.

### Conflicting stack between CLAUDE.md and prompt
Always trust CLAUDE.md and PLAN.md over any generic prompt. If a conflict appears, tell Claude Code to follow the documented files and ignore the conflicting instruction in the prompt.
