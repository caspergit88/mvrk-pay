# Plan

Status of the build against `BRIEF.md`. Updated at every step; the check-ins are where David reviews.

## Phase 1 — Read and plan · **done, awaiting check-in 1**

- [x] Weddings repo read (`../../riah-weddings` @ `59924f3`): stack, auth, settings, cron, email, migrations, UI kit, voice.
- [x] Reference Worker copied to `reference/mvrk-qr-desk/` (27 end-to-end tests, mock gateway, screens).
- [x] `docs/CONVENTIONS.md` — how MVRK Pay is built, mirrored from weddings.
- [x] `docs/DECISIONS.md` — shared Supabase project with a `pay` schema (David), desk state as a table, status-check strategy, sessions table, business day.
- [x] Data model as migration drafts: `supabase/migrations/0001_schema.sql`, `0002_functions.sql`, `0003_rls.sql`, `0004_seed.sql`, plus `supabase/tests/acceptance.sql` skeleton.
- [x] `.env.example`, `README.md`, `.gitignore`.

**Check-in 1 asks David for:** (1) the Supabase project's URL, anon key, service-role key and database connection string (same ones the weddings app uses — `.env.local` of that repo); (2) a one-click dashboard change: Settings → API → Exposed schemas → add `pay`; (3) an empty private GitHub repo `mvrk-pay` so the code can be pushed; (4) the weddings app's URL for the launcher tile (can come later, it is a settings row).

## Phase 2 — Foundation · next

- [ ] `create-next-app` with the weddings options (TypeScript, Tailwind v4, App Router, `@/*` alias, ESLint), copy `globals.css`, fonts, `ui.tsx`, `forms.tsx`, `supabase/*`, `auth.ts`, `format.ts`, `middleware.ts`, `scripts/setup-database.ts` (tracker table → `pay._migrations`).
- [ ] Apply migrations 0001–0004 to the shared project; create the admin login with `npm run setup:db -- --commit --admin-email …`.
- [ ] Sign-in: domain check (client + server + DB), location chip, password, "Who are you?" step with staff name + PIN, `pay.sessions` row with 22:00 expiry, Switch person, sign out.
- [ ] Launcher `/apps` (admin), header "Apps" link.
- [ ] Settings: Locations, Desks (display link + regenerate key), Staff (names, PIN, order), Users (create with password, role, location, reset, deactivate, lock-out guard), Apps.
- [ ] Cron: `/api/cron/expire-sessions` (22:00 local), `vercel.json`.
- [ ] Vercel project `mvrk-pay` with env vars; CI (lint, typecheck) on push.
- [ ] Acceptance SQL for roles, domain rule, session expiry.

## Phase 3 — Payments

- [ ] `lib/providers`: interface, `ngenius.ts` (port of `reference/.../ngenius.js`: token cache + 30 s backoff, HTML-error detection, orders, status, summarize), `mock.ts`, stubs `getpayin.ts` / `nomod.ts` / `stripe.ts` with READMEs; `credentials.ts` (Vault by name → env fallback).
- [ ] `pay.open_order`, `pay.apply_provider_status`, `pay.clear_desk`; `/api/desks/[desk]/{state,check,orders,clear,recent-check}`; de-duplicated server-side status checks; webhooks `/api/webhooks/ngenius` (verify, then fetch the order).
- [ ] Staff screen (`/`), customer display (`/display/[desk]`, Realtime + polling fallback, wake lock, Wi-Fi screen), `/thanks` and `/cancelled` with e-receipt box, Recent with Check, late-payment handling.
- [ ] Mock gateway for local/CI; Playwright: login, take payment → display green, clear/replace, check, declined attempt, outage.
- *Check-in 2: live €1 payment on the euro outlet with the display turning green.*

## Phase 4 — Finance

- [ ] `/report?date=…&location=…` with A4 and 80 mm print layouts; `pay.v_day_totals`.
- [ ] End of day: check all open, confirm, `pay.close_day`, PDF to Storage (`pay-reports`), Resend email to the location's finance address; automatic close at 22:00 (`/api/cron/close-day`); re-open with reason (admin, finance).
- [ ] `/transactions` for admin and finance with filters and CSV export; refund state from Check and webhook; provider portal deep links.

## Phase 5 — Providers and settings

- [ ] Settings → Payment providers (max five, default per location, credentials "set"/"not set", Test connection, webhook URL shown).
- [ ] Settings → Apps, audit log view.

## Phase 6 — Hardening and hand-over

- [ ] Login rate limiting, admin email one-time code.
- [ ] Playwright suite green in CI; README and DEPLOYMENT finished; `pay.mvrk.ae` DNS instructions; a week in parallel with the Cloudflare Worker; cut-over note.
- *Check-in 3: hand-over.*
