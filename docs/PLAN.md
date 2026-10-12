# Plan

Status of the build against `BRIEF.md`. Updated at every step; the check-ins are where David reviews.

## Phase 1 — Read and plan · **done; check-in 1 passed**

- [x] Weddings repo read (`../../riah-weddings` @ `59924f3`): stack, auth, settings, cron, email, migrations, UI kit, voice.
- [x] Reference Worker copied to `reference/mvrk-qr-desk/` (27 end-to-end tests, mock gateway, screens).
- [x] `docs/CONVENTIONS.md` — how MVRK Pay is built, mirrored from weddings.
- [x] `docs/DECISIONS.md` — shared Supabase project with a `pay` schema (David), desk state as a table, status-check strategy, sessions table, business day.
- [x] Data model as migration drafts: `supabase/migrations/0001_schema.sql`, `0002_functions.sql`, `0003_rls.sql`, `0004_seed.sql`, plus `supabase/tests/acceptance.sql` skeleton.
- [x] `.env.example`, `README.md`, `.gitignore`.

**Check-in 1 — done 12 Oct 2026, evening:**

- [x] GitHub repo `caspergit88/mvrk-pay` created by David; Phase 1 pushed to `main`.
- [x] Migrations 0001–0004 applied to the shared Supabase project (`rsjjsrpjwxuxuvoysiwx`, "Weddings App") through the dashboard SQL editor; `pay._migrations` records all four with their content hashes, so `npm run setup:db` will skip them. Verified live: 13 tables with RLS, 26 functions, 19 policies, 4 locations, 4 desks, 1 provider, `desk_state` in the realtime publication.
- [x] `pay` added to Data API → Exposed schemas (David's approval). Verified from a browser with the publishable key: `rpc/location_for_domain` answers, anon cannot read `locations` directly (RLS), `display_snapshot` refuses a wrong key with 403.
- [x] Project URL and publishable key in `.env.local` (public values). Still with David, for Vercel only: service-role key, `CRON_SECRET`, Resend keys, N-Genius key.
- [ ] Weddings app URL for the launcher tile — a Settings → Apps row, whenever convenient.

## Phase 2 — Foundation · next

- [ ] `create-next-app` with the weddings options (TypeScript, Tailwind v4, App Router, `@/*` alias, ESLint), copy `globals.css`, fonts, `ui.tsx`, `forms.tsx`, `supabase/*`, `auth.ts`, `format.ts`, `middleware.ts`, `scripts/setup-database.ts` (tracker table → `pay._migrations`).
- [x] Migrations 0001–0004 applied (check-in 1). 
- [ ] Create the admin login (`npm run setup:db -- --commit --admin-email …` once the service-role key is in Vercel, or Settings → Users from a first admin created by hand).
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
