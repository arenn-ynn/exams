# Audit report

Scope: full audit of the original archive (Vite + React + TypeScript + Supabase + Vercel functions). Baseline: the original passed `tsc`, `vitest` and `vite build`, so the defects were behavioural and were found by running the app in Chromium against a real Postgres (migrations + RLS + RPC functions) behind PostgREST.

## Problems found
| # | Problem | Impact |
|---|---------|--------|
| 1 | `generate_my_reminders()` — `'text' || x->>'title'` parses as `('text' || x) ->> 'title'` (same operator precedence) → `invalid input syntax for type json` | HTTP 400 on **every page load** for every user; reminders never worked |
| 2 | Grids without a single-column track + long unbroken text (class/exam names, emails) | 8 pages overflowed at 320–390 px (up to 1303 px wide) |
| 3 | The fixed bottom nav is `inset-x-0`; on an overflowing page the layout viewport widens | Nav tabs pushed off-screen — the "disappearing nav" symptom. Root cause was overflow, not the nav |
| 4 | Join-display code: `md:text-9xl` ≈ 966 px wide on a 768 px screen; overflow on phones | Unreadable/overflowing projector page |
| 5 | `TakeExam`: effect cleanup cleared the debounced-save timer whenever the parent re-rendered; clock re-rendered the whole question UI twice a second | Possible dropped answer saves; wasted CPU on mid-range phones |
| 6 | Results tables forced `min-w-[820px]` / sideways scrolling | Poor mobile presentation |
| 7 | Settings → name empty on direct load; "My Results" cards linked to `#`; assign dialog listed joined (non-owned) classrooms; announcement delete and several loads failed silently; toasts painted *behind* open modals; avatar upload used `upsert` without a SELECT policy; auth provider re-rendered the app on every tab focus; unread effect re-ran on every token refresh; duplicate `assignments` query; un-debounced realtime refetch; AI status fetched on every editor visit; no logout outside Settings; unsaved editor changes lost on in-app navigation | Correctness / UX / performance |
| 9 | **Exam screen crashed with "insertBefore … not a child of this node"** when the student's browser auto-translated the page (Chrome/Edge/Google Translate wrap text nodes in `<font>`; React's next update then throws). My own data-router change also had no `errorElement`, so the crash showed React Router's default "Unexpected Application Error!" page instead of the app's error page | Student could not finish an exam; attempt stayed `in_progress` |
| 8 | `api/ai-generate`: no timeout, no per-user throttle, raw provider error body returned to the browser, bad `mode` → 502 | Credit burn, hanging requests, information leakage |

## Fixes
* Translation crash: a global guard in `src/main.tsx` (skips a DOM operation whose reference node was moved by a translator), `translate="no"` on the live exam numbers (timer, counters), and a router-level `errorElement` (`RouteError` in `ui.tsx`) that shows the app's error page with Reload / Back to dashboard. Reproduced first with a simulated translator (`tests/e2e/journey_translate.py`), then verified fixed.
* Dependencies: upgraded the runtime packages that had advisories: `jspdf` 2→4, `jspdf-autotable` 3→5, `react-router-dom` 6→7 (verified: type-check, all journeys, real CSV and PDF export). Remaining `npm audit` items are build/dev tools (vite, vitest, `@vercel/node`/tar, etc.) whose fixes are major upgrades; they are not part of the shipped browser bundle. Review with `npm audit`.
Each problem above was fixed at its root cause (not hidden), with a code comment explaining the reason where it isn't obvious. Database fixes are in `supabase/migrations/20260101000004_fixes.sql` (idempotent) with a regression test in `tests/db/smoke.sql`.

## Test results (what was actually run)
* `npx tsc -b` — clean (app, `api/`, config). `npm test` — 8/8. `npm run build` — OK.
* `tests/db/run.sh` — all checks pass, including the new reminder regression test (verified to **fail** on the original migrations).
* Browser audit (`tests/e2e/audit.py`): teacher ×17 routes + student ×10 routes × 10 widths = **270 checks, 0 issues** on the final build (original: failures on 8 pages at 320–390 px).
* Journeys (`journey_*.py`): student exam start→autosave→resume→30 answers→submit→graded 30/30; nav pinned during slow loading, tab switching and scroll sequences; More menu, sign-out; Settings prefill; toast visible above modal; unsaved-changes guard (cancel / save / discard); assign dialog owner filter; new exam save; modals and in-exam screen at 320 px.

## Not tested / external requirements
Live Supabase Auth (email OTP, password recovery), Realtime, Storage upload, Vercel functions, live AI provider calls, PDF/CSV downloads, physical devices. Details in README §11.

## Trade-offs
* Moving to `createBrowserRouter` (needed for `useBlocker`) increased the main bundle by ~15 kB gzipped (122 → 137 kB). It buys protection against silent loss of unsaved exam edits.
* Bundle: router v7 + jsPDF 4 raise the main bundle to ~147 kB gzipped (original 122 kB).
* Tab strips (`Tabs`) remain horizontally swipeable inside their own container; the page itself never scrolls sideways.
