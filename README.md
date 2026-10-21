# MVRK Pay

Card payments at the desk for MVRK's reception teams: staff type a euro amount, the customer-facing iPad shows a pay-by-QR code, both screens turn green when Network International confirms the payment, and finance gets an end-of-day report to reconcile against KiteHub and the provider's portal.

Built the same way as the weddings app (Next.js 15, Supabase, Vercel) and kept apart from it: its own repo, its own Vercel project, its own `pay` schema inside the shared Supabase project. The brief, the conventions it follows and the decisions taken are in `docs/`.

## Status

Phases 1–5 are built and Phase 6 is mostly done: the `pay` schema (0001–0009) is live in the shared Supabase project and the app runs at https://mvrk-pay.vercel.app; the app has sign-in (domain rule, name + PIN, 22:00 expiry, rate limits, an emailed code for admins), the launcher, Settings (locations, desks, staff, users, payment providers with Test connection and the webhook URL, apps, the audit log), the payment screen, the customer display, the Network adapter, the end-of-day report (A4 and 80 mm slip, PDF, email), the nightly close, the transaction list with refunds, portal links and CSV export, and e-receipts. It is waiting for the N-Genius key in Supabase Vault (`DEPLOYMENT.md` §1) for a first live payment. Until then the live version is the Cloudflare Worker in `reference/mvrk-qr-desk/` (`mvrk-qr-desk.dormies.workers.dev`), which this build replaces; `DEPLOYMENT.md` §5–6 cover the domain, the week side by side and the cut-over. Progress: `docs/PLAN.md`.

## What is here

| Path | What it is |
|---|---|
| `docs/BRIEF.md` | The build brief: what MVRK Pay must do, in full |
| `docs/CONVENTIONS.md` | How it is built, mirrored from the weddings repo |
| `docs/PLAN.md` | Phases, what is done, what is next, what each check-in needs |
| `docs/DECISIONS.md` | Decisions taken between check-ins and how to reverse them |
| `supabase/migrations/` | The `pay` schema: tables, functions, RLS, seed — proven on a scratch Postgres |
| `supabase/tests/acceptance.sql` | 106 database acceptance tests; one transaction, rolls back (`npm run test:db`) |
| `tests/unit/` | The Network adapter against the mock gateway; the report text, PDF and CSV; the audit summary; the login guard (`npm run test:unit`) |
| `src/` | The Next.js app (App Router); `docs/CONVENTIONS.md` says where things go |
| `DEPLOYMENT.md` | Vercel project, environment variables, first admin login, migration 0008, `pay.mvrk.ae`, the parallel week and cut-over |
| `reference/mvrk-qr-desk/` | The working Cloudflare Worker this app ports (screens, Network client, 27 end-to-end tests) |

## Running it

```bash
npm install
cp .env.example .env.local      # fill in the Supabase values (DEPLOYMENT.md)
npm run dev                     # http://localhost:3000
npm run typecheck && npm run lint && npm run build
npm run test:unit               # the Network adapter against the mock gateway, the report text/PDF/CSV
npm run test:e2e                # Playwright, against a running app (E2E_BASE_URL); login tests need E2E_EMAIL/E2E_PASSWORD
                                # (CI runs it on every push; Supabase tests run once the repo has the publishable key as a variable)
npm run mock:gateway            # a stand-in N-Genius on :9876 for local payments (provider kind "mock")
```

## Running the database tests locally

Needs a plain Postgres (16 is fine) — no Supabase account required.

```bash
createdb mvrkpay
psql -d mvrkpay -c "alter database mvrkpay set search_path = public, extensions"
for f in supabase/tests/local-supabase-shim.sql supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -d mvrkpay -f $f; done
psql -v ON_ERROR_STOP=1 -d mvrkpay -f supabase/tests/acceptance.sql
```

No local Postgres? `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16` and `PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres npm run test:db` does the same as CI.

Every test prints `PASS`; any failure raises and stops. The shim stands in for Supabase's `auth` schema and roles; never run it on a real project.

## The real project

The `pay` schema is already applied to the shared Supabase project and exposed on its Data API (12 Oct 2026). Future migrations go in `supabase/migrations/` and are applied either through the dashboard SQL editor (with the matching `pay._migrations` row) or by `npm run setup:db` for anyone holding `DATABASE_URL`; the tracker is `pay._migrations`, separate from the weddings app's.
