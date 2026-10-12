# MVRK Pay

Card payments at the desk for MVRK's reception teams: staff type a euro amount, the customer-facing iPad shows a pay-by-QR code, both screens turn green when Network International confirms the payment, and finance gets an end-of-day report to reconcile against KiteHub and the provider's portal.

Built the same way as the weddings app (Next.js 15, Supabase, Vercel) and kept apart from it: its own repo, its own Vercel project, its own `pay` schema inside the shared Supabase project. The brief, the conventions it follows and the decisions taken are in `docs/`.

## Status

Phase 1 of 6 (plan, conventions, data model) is done and waiting for check-in 1 — see `docs/PLAN.md`. The app code starts in Phase 2. Until then the live version is the Cloudflare Worker in `reference/mvrk-qr-desk/` (deployed at `mvrk-qr-desk.dormies.workers.dev`), which this build replaces.

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

## Applying to the real project (Phase 2)

1. Supabase dashboard → Settings → API → **Exposed schemas** → add `pay`.
2. `cp .env.example .env.local`, fill in the four Supabase values (same as the weddings app's).
3. `npm run setup:db` (dry run), then `npm run setup:db -- --commit --admin-email david@mvrkhq.com --admin-name "David"`.

The setup script tracks applied migrations in `pay._migrations`, separate from the weddings app's tracker.
