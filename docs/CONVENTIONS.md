# MVRK Pay — build conventions

Extracted from the weddings repo (`../../riah-weddings`, commit `59924f3`, 12 Oct 2026) so that MVRK Pay is built the same way. Where this file and the weddings repo disagree, the weddings repo wins and this file gets corrected. Read this before adding code; the brief is `BRIEF.md`.

## Non-negotiables (the weddings app's four, translated to payments)

1. **A payment's status comes from the provider, never from typing.** `transactions.status` is only ever written by the status-check path (`applyProviderStatus` RPC) from a real answer from the provider, or by the desk state machine for `cleared` / `replaced` / `expired`. Nothing in the UI sets "paid".
2. **Money is computed, never entered as a result.** Day totals, per-cashier and per-provider sums are views over `transactions`; the report displays them and never adds up in TypeScript.
3. **Append-only audit.** Triggers on every `pay.*` table write `pay.audit_log`; the log rejects `update` and `delete` from everyone, service key included. Button presses that are not row writes (print, check, end of day) call `pay.log_action`.
4. **Guards with logged overrides.** Re-opening a closed day, replacing an unpaid code, deactivating the last admin: blocked by the database with a message written for people, surfaced verbatim; where an override exists it is admin-only with a mandatory reason.

## Stack and layout (identical to weddings)

- Next.js 15 App Router, React 19, TypeScript strict, Tailwind v4 (`@import 'tailwindcss'` + `@theme` tokens in `globals.css`), Supabase via `@supabase/ssr` and `@supabase/supabase-js`, `zod` for input validation, `pg` + `tsx` for scripts. npm, not pnpm or yarn.
- `src/app/(app)/…` — every authenticated screen; inherits nav + the auth check in `(app)/layout.tsx`.
- `src/app/display/[desk]/…`, `src/app/thanks`, `src/app/cancelled`, `src/app/apps` — public or semi-public routes with their own layouts (the weddings app does the same for `/ops`, `/couple`, `/partner`, `/calendar`).
- `src/app/api/cron/<job>/route.ts` — scheduled jobs, `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, authorised by `CRON_SECRET` (Bearer header or `?secret=`), constant-time compare, refuse to run in production without the secret, `?dryRun=1` supported.
- `src/app/api/webhooks/<provider>/route.ts` — provider callbacks (new here; no weddings equivalent).
- `src/lib/supabase/server.ts` — `createClient()` (per-request, user JWT, RLS applies) and `createServiceClient()` (service role; cron, user creation only). `src/lib/supabase/client.ts` — browser client for Realtime subscriptions.
- `src/lib/auth.ts` — `requireProfile`, `requireRole(...roles)`, `requireWrite`, `requireSettingsAdmin`, `homePathFor(role)`, capability helpers.
- `src/lib/format.ts` — `currency(value, code)`, `shortDate`, `dateTime` (Africa/Cairo), etc.
- `src/lib/types.ts` — role, status and provider enums with `*_LABELS` maps.
- `src/components/ui.tsx` — `Card`, `Stat`, `StatusChip`, `Flag`, `Table`, `Td`, `PageHeader`, `EmptyState`, `ErrorState`, `LinkButton`. `src/components/forms.tsx` — `SubmitButton`, `Field`, `inputClass`, `FormError` (client components).
- `src/middleware.ts` — refreshes the Supabase session cookie, redirects to `/sign-in?next=` unless the path is in `PUBLIC_PATHS` (exact or `path/` prefix match); matcher excludes `api/cron` (and here `api/webhooks`) so scheduler and provider calls are never bounced to sign-in.
- Server Components by default; `'use client'` only for real interactivity (the payment screen's live status, the display, forms with `useActionState`).

## Every server action follows this shape

```ts
'use server'
export async function doThing(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireRole('admin', 'reception')  // re-verify, never trust the UI
  const supabase = await createClient()                     // user's JWT → RLS applies
  const { error } = await supabase.schema('pay').rpc('...', { ... })
  if (error) return fail(error.message)                     // show the DB message as-is
  revalidatePath('/where/it/shows')
  return done('What changed, in plain English.')
}
```

Settings actions live in `actions.ts` next to their page and return `ActionState` (`{ error?: string; ok?: string } | null`, helpers `fail()` / `done()` in `settings/_lib/action-state.ts`); forms use `ActionForm` (`useActionState`) so every failure is visible and every success says what changed. `createServiceClient()` is allowed in a request path in exactly one place: creating a login (`auth.admin.createUser`) after `requireSettingsAdmin()` has run — the weddings `settings/users/actions.ts` pattern, including the "cannot lock yourself out" guard.

## Database

- Migrations: `supabase/migrations/NNNN_description.sql`, applied in order by `scripts/setup-database.ts` (`npm run setup:db` is a dry run; `-- --commit` applies; tracked by content hash in a `_migrations` table — here `pay._migrations` so the weddings tracker is untouched). The same script creates the first admin login.
- Everything lives in schema `pay`. Expose it to the API once (Supabase dashboard → Settings → API → Exposed schemas, add `pay`); the TypeScript clients call `.schema('pay')` through one helper, `db()`, so no call site names the schema.
- Helper predicates as `security definer` functions (`pay.is_admin()`, `pay.is_finance()`, `pay.my_location()`), RLS enabled and forced on every table, policies named `<table>_<who>_<verb>`.
- Enums for closed sets (`pay.app_role`, `pay.tx_status`, `pay.provider_kind`); a new enum value is its own migration because Postgres cannot use a value in the transaction that adds it.
- Money columns are integers in minor units (`amount_minor`), currency as a 3-letter code column; the weddings app's `numeric(12,2)` is for USD contract values, not card amounts.
- Timestamps `timestamptz`; `business_date` is a `date` computed at insert from the location's timezone.
- Acceptance tests as SQL in `supabase/tests/acceptance.sql` (`assert` / `assert_raises`, one transaction, rolls back) — the weddings way — plus Playwright for the screens.
- Realtime: `pay.desk_state` is added to the `supabase_realtime` publication in a migration; the display subscribes with the anon key through a security-definer read keyed by the desk's display key.

## Auth and roles

- Supabase Auth email + password; `pay.profiles` keyed to `auth.users.id` with `email`, `role`, `location_id`, `active`, `must_change_password`. A pay profile exists only for people created through MVRK Pay's Settings → Users (or the setup script); weddings logins have none and are refused with `/no-access`, and the reverse holds in the weddings app.
- Accounts are created with a password by an admin and the person must change it on first sign-in (weddings `0057`). No invite emails.
- Roles: `admin` · `finance` (read everything, write nothing but day re-opens with a reason) · `reception` (own location only). `requireProfile` is the single gate every page and action passes through; `homePathFor` sends admins to `/apps` and reception to `/`.
- The chosen cashier (staff name + PIN) and the 22:00 expiry live in `pay.sessions`, keyed by the Supabase session id, checked in `requireProfile`.

## UI voice and style

- Plain English, no jargon. A blocked action says what is missing and what would unblock it.
- Every list has an empty state; every failure is visible; mobile-first (reception works on phones).
- Palette: the weddings `stone-*` ramp is redefined to Midnight Navy in `globals.css`; MVRK Pay copies that file and keeps the three signal colours (emerald = paid, amber = needs attention, red = wrong). The customer display and the launcher are the two dark full-screen surfaces and use the navy ramp directly.
- Fonts: Public Sans body, Spectral display (loaded once in `app/layout.tsx`); the display screen uses the system stack for crisp large numerals.

## Email and jobs

- Transactional email through Resend with one `fetch`, no SDK (`lib/email.ts`): the log row (`pay.email_log`) is written first, `dedupe_key` is unique and is the whole idempotency story, a missing `RESEND_API_KEY` is not an error (logged as `no_provider`).
- Vercel cron in `vercel.json`; schedules in UTC (22:00 Cairo = `0 19 * * *` in winter, `0 20 * * *` with DST — the job itself checks the location's local time and no-ops otherwise, so one schedule per hour between 18:00 and 20:00 UTC is fine).

## Environment

`.env.example` is committed and documents every variable; `.env.local` never is. Phase-ordered: Supabase values first, then `CRON_SECRET`, `RESEND_*`, then provider credentials (which can also live in Supabase Vault — see `BRIEF.md`).

## Repo hygiene

- `README.md` (what it is, how to run it), `DEPLOYMENT.md` (Supabase → local → Vercel, step by step, written for David), `docs/` for the brief, plan, decisions and this file.
- One-off maintenance scripts are `scripts/_*.ts` and git-ignored. Real data never enters git.
- Commit messages say what changed for the business, in a sentence ("A caterer earns on what they supplied, not on the whole wedding" is the weddings style).
