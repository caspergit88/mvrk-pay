# MVRK Pay — notes for Claude Code

Card payments at the desk for MVRK's reception teams. Next.js 15 / React 19 / Supabase (shared project, schema `pay`) / Vercel. Built to the weddings app's standard and kept apart from it.

Read, in this order, before changing anything: `docs/BRIEF.md` (what it must do), `docs/CONVENTIONS.md` (how it is built), `docs/PLAN.md` (what is done, what is next, what each check-in needs), `docs/DECISIONS.md` (why things are the way they are). `DEPLOYMENT.md` is for David.

## Commands

```bash
npm install
npm run dev                      # http://localhost:3000 — needs .env.local (public Supabase values are already there)
npm run typecheck && npm run lint && npm run build
npm run test:unit                # adapter against the mock gateway; report text/PDF/CSV
npm run test:db                  # 63 acceptance tests on a scratch Postgres (PGHOST/PGUSER set; never a real project)
npm run test:e2e                 # Playwright against a running app (E2E_BASE_URL); login tests need E2E_EMAIL/E2E_PASSWORD
npm run mock:gateway             # stand-in N-Genius on :9876 (provider kind "mock")
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit, build and the database tests on every push.

## Rules that are not negotiable

- **Secrets never pass through chat, code or the audit log.** Service-role key, `CRON_SECRET`, Resend keys go in Vercel / `.env.local` by David. The N-Genius key is a Supabase Vault secret named by `providers.credential_ref` (`NGENIUS_API_KEY`), read only by `pay.read_secret` (service role). `.env.local` is git-ignored; `.env.example` documents every variable.
- **Euro only.** No AED anywhere; the Network outlet is a euro account.
- **A payment's status comes from the provider, never from typing** — `pay.apply_provider_status` is the only path to `paid`. Money is summed in SQL (views, `report_data`, `range_totals`), never in TypeScript.
- **Audit log is append-only.** Triggers cover row writes; `pay.note_audit` / `pay.log_action` for button presses.
- **Rows are deactivated, never deleted.**
- `reference/mvrk-qr-desk/` is the Cloudflare Worker this app replaces — read it for behaviour, never edit it.

## Migrations

`supabase/migrations/NNNN_name.sql`, applied in order, tracked by content hash in `pay._migrations`. 0001–0007 are live in the shared project; 0008 (login protection) is written and tested but not yet applied — DEPLOYMENT.md §4. A new migration is applied either by `npm run setup:db -- --commit` (needs `DATABASE_URL`) or by pasting the file into the Supabase SQL editor followed by its tracker row:

```sql
insert into pay._migrations (name, sha256) values ('0008_name.sql', '<sha256sum of the file>');
```

Never edit an applied migration; write the next one. Add acceptance tests for every new function in `supabase/tests/acceptance.sql` (one transaction, rolls back).

## Where things are

- `src/lib/providers/` — the adapter interface, the Network (N-Genius) adapter, stubs for Getpayin/Nomod/Stripe (`README.providers.md` says how to add one).
- `src/lib/payments.ts` — open / check / clear, de-duplicated status checks, Realtime broadcast per desk.
- `src/lib/report.ts`, `src/lib/email.ts` — the day report (text, PDF, CSV), Resend with `email_log` dedupe.
- `src/lib/auth.ts` — `requireProfile` (session + 22:00 expiry), `requireRole`, `requireSettingsAdmin`, `requireDesk`.
- Screens: `/sign-in` → `/who` (name + PIN) → `/pay`; `/display/[location]/[desk]?key=` (the iPad); `/report`; `/transactions`; `/settings/*` (admin); `/apps` (launcher).
- Jobs: `/api/cron/nightly` (22:05 Cairo: sign out, expire codes, close the day), `/api/webhooks/ngenius?token=`.

## Gotchas

- Supabase JS: always `db(client)` (= `client.schema('pay')`).
- Do not name a React prop `ref` (React 19 refuses it on server components) — bit us once on the thank-you page.
- Cron routes must refuse to run in production without `CRON_SECRET` (`src/lib/cron.ts`).
- Timezones: everything is `Africa/Cairo` per location (`locations.timezone`); business date and logout time are computed in SQL (`pay.business_date_for`, `pay.next_logout_at`).

## Next

`docs/PLAN.md` → Phase 6 (login rate limiting, admin email code, Playwright in CI, cut-over from the Worker). Check-ins 2 and 3 need David: Vercel project, Vault secret, first live €1, Resend values.
