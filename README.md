# MVRK Pay

Card payments at the desk for MVRK's reception teams: staff type a euro amount, the customer-facing iPad shows a pay-by-QR code, both screens turn green when Network International confirms the payment, and finance gets an end-of-day report to reconcile against KiteHub and the provider's portal.

Built the same way as the weddings app (Next.js 15, Supabase, Vercel) and kept apart from it: its own repo, its own Vercel project, its own `pay` schema inside the shared Supabase project. The brief, the conventions it follows and the decisions taken are in `docs/`.

## Status

Phase 1 of 6 (plan, conventions, data model) is done and check-in 1 has passed: the `pay` schema is live in the shared Supabase project — see `docs/PLAN.md`. The app code starts in Phase 2. Until then the live version is the Cloudflare Worker in `reference/mvrk-qr-desk/` (deployed at `mvrk-qr-desk.dormies.workers.dev`), which this build replaces.

## What is here

| Path | What it is |
|---|---|
| `docs/BRIEF.md` | The build brief: what MVRK Pay must do, in full |
| `docs/CONVENTIONS.md` | How it is built, mirrored from the weddings repo |
| `docs/PLAN.md` | Phases, what is done, what is next, what each check-in needs |
| `docs/DECISIONS.md` | Decisions taken between check-ins and how to reverse them |
| `supabase/migrations/` | The `pay` schema: tables, functions, RLS, seed — proven on a scratch Postgres |
| `supabase/tests/acceptance.sql` | 29 database acceptance tests; one transaction, rolls back |
| `reference/mvrk-qr-desk/` | The working Cloudflare Worker this app ports (screens, Network client, 27 end-to-end tests) |

## Running the database tests locally

Needs a plain Postgres (16 is fine) — no Supabase account required.

```bash
createdb mvrkpay
psql -d mvrkpay -c "alter database mvrkpay set search_path = public, extensions"
for f in supabase/tests/local-supabase-shim.sql supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -d mvrkpay -f $f; done
psql -v ON_ERROR_STOP=1 -d mvrkpay -f supabase/tests/acceptance.sql
```

Every test prints `PASS`; any failure raises and stops. The shim stands in for Supabase's `auth` schema and roles; never run it on a real project.

## The real project

The `pay` schema is already applied to the shared Supabase project and exposed on its Data API (12 Oct 2026). Future migrations go in `supabase/migrations/` and are applied either through the dashboard SQL editor (with the matching `pay._migrations` row) or by `npm run setup:db` for anyone holding `DATABASE_URL`; the tracker is `pay._migrations`, separate from the weddings app's.
