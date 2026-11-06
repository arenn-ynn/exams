# EXAMINA — Examination Management Platform

EXAMINA is a web app for creating examinations, running them online, grading automatically and analysing results. It is inspired by Google Classroom: **there are no separate teacher/student accounts** — every user can create exams and classrooms *and* join other people's classrooms. What you can do in a classroom depends on your relationship to it (owner or member).

> **Read this first — what has and has not been tested** (see also [Testing status](#testing-status)).
> The database (all migrations, security policies, grading, timer, release, extra attempts) was tested against a real PostgreSQL 16. The finished web app was also driven in a real Chromium browser against that database (real RLS and RPC functions, via PostgREST; see `tests/e2e/` and `AUDIT.md`): 270 page×viewport checks, exam-taking, navigation and editor journeys. **It has not been run against a live Supabase project** (Auth emails, Realtime, Storage, Vercel functions and live AI calls need your credentials), so follow section 6 to verify those yourself.

---

## 1. What is in the box

| Area | Features |
|---|---|
| Accounts | Register with email verification by one-time code · login with remembered sessions · forgot password (email code → new password) · change password (needs current password) · change email (code sent to new address) · profile picture · log out / log out from all devices · delete account |
| Examinations | Independent of classrooms · statuses Draft / Published / Archived · editor with add/edit/delete/duplicate/reorder/preview · 3 question types: **single choice, multiple choice, matching** · points, duration, passing grade, random answer-option order (question order is never changed), free navigation switch |
| Creating exams | **AI generator** (guided form, server-side, provider/model configurable) · per-question AI regeneration · natural-language refinement with undo · **JSON import** with template download, copyable external-AI prompt, strict versioned schema, validation messages, preview |
| Classrooms | Persistent and reusable · unique joining code, invitation link, copy, regenerate, close enrollment, fullscreen projector view with QR code · members · announcements · archive |
| Assignments | Assign an existing published exam to a classroom with its own date/time window · the same exam can go to many classrooms on different dates · each assignment keeps the exact exam version (editing the exam later never changes it) |
| Taking exams | One question at a time, question grid, free navigation, answered/unanswered, server-validated timer, **autosave** (survives refresh, closed browser, offline periods), confirmation before submit, duplicate-submit protection, auto-submit at the server deadline, mobile-first layout |
| Grading & release | Automatic grading · teacher sees grades immediately · **students see nothing until the teacher clicks "Release results"** (with a warning if some have not submitted) · correct answers are never sent to a student before that |
| Extra attempts | Teacher grants an additional attempt to one student, with a recorded reason; previous attempts and grades are kept; no reset button exists anywhere |
| Analytics | Not started / started / submitted · average, highest, lowest, pass rate, average time · per-student table with detail view · per-question statistics with bars · live progress via Realtime · **CSV** (Excel-friendly) and **PDF** export |
| Other | Dashboard · My Results · History (created vs taken) · notifications with unread badge · light/dark/system theme · 7 accent colors saved to your account · responsive desktop + mobile · keyboard and screen-reader friendly · reduced-motion support |

**Not included:** the optional *Question Bank* section, and email notifications (in-app notifications only).

### Design decisions you should know about

* **Scoring:** a question earns full points only if the answer is completely right — single choice: the right option; multiple choice: exactly the correct set (no missing, no extra); matching: every pair correct. No negative marking, no partial credit.
* **A student's grade** = their best submitted attempt (highest percentage; ties → latest). All attempts remain stored and visible to the teacher.
* **Schedule:** an assignment has an *opens* time and a *window closes* time (default: opens + exam duration). A student must start inside the window and gets the exam's duration from the moment they start, but never beyond the window end. Additional attempts granted by the teacher ignore the window and get the full duration.
* **Timer:** the deadline is stored on the server when the attempt starts. The browser clock is display-only. Late saves are rejected; expired attempts are graded and submitted by the server the next time anyone touches them (the student reloading, the teacher opening results, etc.). No cron job is required.
* **Reminders** ("exam starts within 24 h") are created when a user opens the app. There is no background scheduler.

---

## 2. Architecture

```
Browser (React + Vite + Tailwind)
   │  supabase-js (user's JWT, Row Level Security applies to everything)
   ├──────────────► Supabase Auth   (email + password, one-time email codes)
   ├──────────────► Supabase Postgres
   │                  • tables with RLS
   │                  • SECURITY DEFINER functions = the "server side" for exams:
   │                    start_attempt, save_answer, submit_attempt (timer + grading),
   │                    release_results, grant_attempt, assign_exam, …
   ├──────────────► Supabase Storage (avatars)   and Realtime (live progress, notifications)
   │
   └─► /api/* on Vercel (Node serverless functions, secrets stay here)
          • /api/ai-generate    → Anthropic or OpenAI-compatible API
          • /api/delete-account → Supabase Admin API (service-role key)
```

Security model in one paragraph: students have **no read access** to exam content, attempts, answers or grades tables. They only use database functions that return the exam *without* correct answers (matching right-hand items use opaque per-attempt tokens so ids can't reveal the pairing) and hand back grades only after release. Teachers read attempts through RLS policies that check classroom ownership. The service-role key exists only in the `/api/delete-account` function.

### Folder structure

```
examina/
├── api/                       Vercel serverless functions (ai-generate, delete-account)
├── src/
│   ├── components/            UI kit, layout, question renderer, dialogs
│   ├── lib/                   supabase client, auth, theme, JSON schema/validator, analytics, exports
│   └── pages/                 one file per screen
├── supabase/
│   ├── migrations/            1 schema · 2 security (RLS) · 3 functions · 4 fixes — run in this order
│   ├── templates/             email templates containing the one-time code
│   └── config.toml            optional Supabase CLI configuration
├── tests/                     unit tests (vitest) and database tests (tests/db)
├── .env.example               every environment variable, explained
├── vercel.json                build settings + SPA rewrite
└── package.json
```

---

## 3. Prerequisites

* **Node.js 20 or newer** (https://nodejs.org — choose "LTS"). Check with `node -v`.
* A free **Supabase** account (https://supabase.com).
* A free **Vercel** account (https://vercel.com) and a **GitHub** account (to deploy).
* *Optional:* an **Anthropic** (https://console.anthropic.com) or **OpenAI** API key for the AI generator. Without it everything else works and the AI page tells you how to configure it. JSON import needs no key.

---

## 4. Supabase setup (do this once)

### 4.1 Create the project
1. Supabase dashboard → **New project**. Pick a name, a strong database password (save it) and a region near your users.
2. Wait until it finishes provisioning.

### 4.2 Run the database migrations
1. Open **SQL Editor → New query**.
2. Open `supabase/migrations/20260101000001_schema.sql`, copy everything, paste, click **Run**. Expect "Success".
3. Repeat with `…000002_security.sql`, `…000003_functions.sql`, then `…000004_fixes.sql`. **Keep this order.** Each file must finish without errors before the next.

Migration 2 enables Row Level Security on every table, creates the policies, restricts table privileges, creates the public `avatars` storage bucket and adds `attempts` + `notifications` to the Realtime publication. Migration 3 creates all the server-side functions. Migration 4 fixes the reminder function (it always failed with a JSON cast error) and adds a storage SELECT policy so avatars can be replaced and cleaned up; it is safe to run on a database that already has migrations 1–3.

(If you use the CLI instead: `npx supabase link --project-ref <ref>` then `npx supabase db push`.)

### 4.3 Configure authentication (email codes)
Dashboard → **Authentication**:

1. **Providers → Email**: enabled, **Confirm email = ON**, **Secure email change = OFF**, **Secure password change = OFF**. (Turning "Confirm email" off would let people skip verification — EXAMINA detects this and refuses to register.)
2. **Email Templates**: open each template below, replace its body with the matching file from `supabase/templates/`, and save. The templates must contain **`{{ .Token }}`** — that is what puts the numeric code in the email instead of a link.
   * *Confirm signup* → `confirmation.html`
   * *Reset password* → `recovery.html`
   * *Change email address* → `email_change.html`
3. **Authentication → Sign In / Providers → Email** (or "Auth settings"): keep the OTP length at 6 (EXAMINA accepts 6–10 digits) and a reasonable expiry (e.g. 3600 s).
4. **URL Configuration**:
   * **Site URL**: `http://localhost:5173` while developing; change to your real URL after deploying.
   * **Redirect URLs**: add `http://localhost:5173` and, later, `https://YOUR-APP.vercel.app` (and your custom domain).
5. **Email sending limits:** Supabase's built-in mailer is for testing only and allows very few emails per hour. For real use configure your own SMTP server under **Project Settings → Authentication → SMTP Settings** (Resend, Postmark, SendGrid, Gmail SMTP, …).

### 4.4 Collect your keys
Dashboard → **Project Settings → API** (or "API Keys"):
* **Project URL** → `VITE_SUPABASE_URL`
* **anon / publishable key** → `VITE_SUPABASE_ANON_KEY` (safe in the browser)
* **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (**secret** — server only, never commit it)

### 4.5 Storage and Realtime
Nothing more to do: the avatar bucket/policies and the realtime publication are created by migration 2. If **Database → Replication/Publications** shows `attempts` and `notifications` under `supabase_realtime`, live progress works.

---

## 5. Run it locally

```bash
# 1. Unzip the archive, then open a terminal in the examina folder
cd examina

# 2. Install dependencies
npm install

# 3. Create your environment file and fill in the values
cp .env.example .env        # Windows: copy .env.example .env
#    edit .env: at minimum VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

# 4a. Start the app (everything except /api features)
npm run dev
#     → open http://localhost:5173

# 4b. OR start with the serverless functions too (AI generator + delete account)
npx vercel dev              # first run asks you to log in / link a project; use the defaults
```

`npm run dev` serves only the frontend: registration, exams, classrooms, taking exams, analytics, exports, JSON import and settings all work. The **AI generator** and **account deletion** call `/api/*`, which only exist under `vercel dev` or on Vercel.

Other commands: `npm run build` (production build into `dist/`), `npm run typecheck`, `npm test` (unit tests).

---

## 6. Verify everything works (checklist)

Use two browsers (or one normal + one private window) so you can be teacher and student at once.

1. **Register** account A (check your inbox for the code), verify, land on the dashboard. Log out and in again; refresh the page (session persists).
2. **Forgot password**: log out → Forgot password → code → new password → log in.
3. **Settings → Security**: change password with the current password; try a wrong current password (must fail).
4. **Examinations → Create → Import JSON**: download the template, upload it, preview, import, **Save**, **Publish**. Also try breaking the JSON to see the validation messages.
5. **Classrooms → Create** "Class 10A". Open fullscreen code view.
6. **Register account B** in the other browser → **Join classroom** with the code.
7. As A: classroom → **Assign examination** → open now. Create a second classroom and assign the *same* exam with a different date.
8. As B: Examinations → Assigned to me → start. Answer, refresh the page (answers return), toggle airplane mode for a moment (status shows *Offline*, then re-syncs), submit.
9. As A: **Analytics** → the assignment shows B as submitted with the grade; B sees **no grade**. Click **Release results**; B now sees the result and correct answers.
10. As A: **Grant attempt** to B; B can start a second attempt; the first result is preserved.
11. Export **CSV** and **PDF**. Check **Notifications**, **Settings → Appearance** (theme + accent persist after reload), and resize/phone-test the exam screen.
12. AI generator (after section 8): create an exam, edit it, regenerate a question, refine it.

If something fails, see [Troubleshooting](#10-troubleshooting).

---

## 7. Deploy to Vercel

1. **Push to GitHub.** Create an empty repository on github.com, then in the project folder:
   ```bash
   git init && git add . && git commit -m "EXAMINA"
   git branch -M main
   git remote add origin https://github.com/YOUR-NAME/examina.git
   git push -u origin main
   ```
   (`.env` is in `.gitignore`; your secrets are not uploaded.)
2. Vercel → **Add New → Project → Import** your repository.
3. Settings (these are also in `vercel.json`, so they should be pre-filled):
   * **Framework Preset:** Vite
   * **Install Command:** `npm install`
   * **Build Command:** `npm run build`
   * **Output Directory:** `dist`
4. **Environment Variables** (Project → Settings → Environment Variables, for Production *and* Preview): add everything from `.env.example`:
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `AI_PROVIDER`, `AI_MODEL` (optional), `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`, `OPENAI_BASE_URL` (optional).
5. Click **Deploy**. When it finishes you get `https://YOUR-APP.vercel.app`.
6. **Production domain:** Project → Settings → Domains → add your domain and follow Vercel's DNS instructions.
7. **Tell Supabase about the live URL:** Authentication → URL Configuration → set **Site URL** to the live URL and add it (and the custom domain) to **Redirect URLs**.
8. **Updating later:** change the code, `git add . && git commit -m "…" && git push`. Vercel rebuilds automatically. If you add/change an environment variable, click **Redeploy**. Database changes go in a *new* numbered file in `supabase/migrations/` that you run in the SQL editor.

---

## 8. AI configuration

The AI generator runs only on the server (`api/ai-generate.ts`); keys never reach the browser. Set, in Vercel (or `.env` for `vercel dev`):

| Variable | Meaning |
|---|---|
| `AI_PROVIDER` | `anthropic` (default) or `openai` (also works for any OpenAI-compatible API) |
| `AI_MODEL` | Optional model name. Defaults: `claude-sonnet-5-5` / `gpt-4o-mini` |
| `ANTHROPIC_API_KEY` | Needed when `AI_PROVIDER=anthropic` |
| `OPENAI_API_KEY` | Needed when `AI_PROVIDER=openai` |
| `OPENAI_BASE_URL` | Optional, e.g. `https://openrouter.ai/api/v1` |

If no key is set, the AI pages say so and explain what to configure — nothing is faked. All AI output is validated with the same strict schema as JSON import; invalid output is rejected with an error. AI-generated exams open as **unsaved drafts** and are never published automatically.

---

## 9. JSON schema (version 1.0)

Download a working example from **Examinations → Create → Import JSON → Download JSON template**. Summary:

```jsonc
{
  "schemaVersion": "1.0",            // required; any 1.x is accepted
  "title": "…", "description": "…",  // title required
  "durationMinutes": 45,             // integer 1–600
  "passingGrade": 60,                // 0–100 (percent)
  "randomizeOptions": true,          // optional
  "freeNavigation": true,            // optional
  "questions": [                     // 1–200 items, ids unique
    { "id": "q1", "type": "single_choice", "text": "…", "points": 2,
      "options": [{ "id": "q1a", "text": "…" }, …],  "correctOptionIds": ["q1a"] },
    { "id": "q2", "type": "multiple_choice", "text": "…", "points": 3,
      "options": [ … ], "correctOptionIds": ["q2a", "q2b"] },
    { "id": "q3", "type": "matching", "text": "…", "points": 4,
      "pairs": [{ "id": "q3p1", "left": "…", "right": "…" }, …] }   // 2–10 pairs
  ]
}
```
Any problem (missing field, wrong type, duplicate id, a correct-answer id that doesn't exist, 0 points, a matching question with one pair, an unsupported question type…) rejects the whole file with a list of understandable messages; nothing is silently dropped. Future schema versions will bump the number, and older versions keep being readable.

---

## 10. Troubleshooting

| Problem | Fix |
|---|---|
| `npm install` fails / "command not found" | Install Node 20+ and reopen the terminal. Delete `node_modules` and `package-lock.json`, run `npm install` again. |
| Page shows "EXAMINA is not configured yet" | `.env` is missing or has placeholder values. Fill `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, **restart** `npm run dev`. On Vercel add them and **Redeploy**. |
| Build fails on Vercel | Open the build log. Usually a missing env var is *not* the cause (they're read at runtime); check Node version (Project → Settings → General → Node 20/22) and that `npm run build` works locally. |
| Registration says "Email confirmation is disabled" | Turn on **Confirm email** (section 4.3). |
| No verification email arrives | Check spam; Supabase's built-in mailer is heavily rate-limited — configure custom SMTP (4.3.5). Check that templates contain `{{ .Token }}`. |
| Email contains a link, not a code | The template wasn't updated (4.3.2). |
| "Invalid or expired code" | Codes expire and only the newest works. Request a new one. |
| Changing email asks for two codes / nothing happens | Turn **Secure email change OFF**. |
| `permission denied` / empty lists / RLS errors | Migration 2 or 3 wasn't run, or was run out of order. Re-run all three on a fresh project (or fix the failing one). Never disable RLS to "fix" it. |
| Migration error "already exists" | You ran a file twice. Reset the database (Project Settings → Database → reset) or drop the objects it names, then run 1→2→3 once. |
| Migration 2 error about `storage` | Storage must be enabled (it is by default on new projects). |
| AI: "not configured" | Section 8. Remember to redeploy after adding variables, and use `npx vercel dev` locally. |
| AI: 404 on `/api/ai-generate` locally | `npm run dev` doesn't serve `/api`; use `npx vercel dev`. |
| AI: "invalid" output | Models occasionally break the format; just click Generate again or try a stronger model. |
| Live progress isn't updating | Check that `attempts` is in the `supabase_realtime` publication (4.5). The page also reloads on refresh. |
| Deleting an account fails | `SUPABASE_SERVICE_ROLE_KEY` isn't set on the server (Vercel env var, redeploy). |
| Blank page after refresh on a deployed sub-route | `vercel.json` rewrite is missing — keep that file. |

---

## 11. Testing status

Everything below was actually run while building this project:

* ✅ **Database tests** (`tests/db/run.sh`, 64 checks, PostgreSQL 16 with a small stand-in for Supabase's `auth`/`storage` schemas): migrations apply in order; profile triggers; join codes and no duplicate membership; closed/invalid codes; same exam assigned to several classrooms; versioning when an exam is edited after assignment; students cannot read exams/answers/attempts/other students' data; attempt payload contains no correct-answer flags; autosave + restore; submit (idempotent) with unsynced answers; grading for all three types and pass/fail; one attempt by default; grading of expired attempts and rejected late saves; release warning and forced release; results hidden before / visible after release; additional attempts preserve history; privilege escalation attempts (student releasing results, granting attempts, editing classrooms, posting announcements, writing notifications) all blocked.
* ✅ **Unit tests** (`npm test`): JSON import validation (valid file, bad version, duplicate ids, unsupported types, bad correct ids, points, matching structure) and analytics calculations.
* ✅ **TypeScript** type-check (app, `api/` and config) and **production build** (`npm run build`).
* ✅ **Browser audit** (`tests/e2e/`, Chromium via Playwright against Postgres + PostgREST with the real migrations; GoTrue replaced by locally signed JWTs): every route as teacher and as student at 320, 360, 375, 390, 430, 768, 1024, 1280, 1440 and 1920 px — no horizontal overflow, no overflowing element, mobile bottom nav pinned after scrolling down and up, last element clear of the nav, no console errors; modals inside a 320 px viewport; a full student exam (autosave, resume, 30 answers, submit, server-side grading), the same exam under a simulated browser auto-translator, CSV/PDF export, the router error page; nav persistence during slow loading; sign-out; unsaved-changes guard; assign dialog filtering.

**Not tested (needs your Supabase project or real devices):** real Supabase Auth emails and codes (OTP/password recovery), Realtime subscriptions, Storage uploads (the avatar policy was reviewed, not run), the Vercel functions and live AI calls, CSV/PDF downloads, and physical iOS/Android devices (safe-area and collapsing browser chrome were emulated, not observed). These are implemented, but please run the checklist in section 6 and report anything that misbehaves. `supabase/config.toml` was not run through the Supabase CLI.

To re-run the database tests yourself you need a local PostgreSQL ≥ 14: `PGUSER=postgres PGPASSWORD=… PGHOST=localhost ./tests/db/run.sh` (it creates and replaces a database named `examina_test`).

## 12. Known limitations
* Reminder notifications are generated when the user opens the app (no background job).
* The mobile bottom navigation is present on every in-app page. It is intentionally absent on the exam-taking screen (a focused full-screen mode) and on the classroom projector display.
* The AI endpoint's per-user throttle is in-memory (per warm serverless instance): it limits abuse but is not a hard global quota.
* No email notifications and no Question Bank.
* The "free navigation = off" mode is enforced by the exam screen (the server still accepts answers for any question).
* Deleting a classroom owner's account deletes their classrooms and the attempts inside them.
