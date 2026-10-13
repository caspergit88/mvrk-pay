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

## Phase 2 — Foundation · **built 12 Oct; awaiting the Vercel project and first login**

- [x] Next.js 15 app in the weddings style: same tooling and layout, Midnight Navy palette, UI and form kits, Supabase clients, `db()` schema helper, middleware, PWA manifest.
- [x] Sign-in: domain check in the browser (location chip; "couldn't check" when offline), on the server and in the database; password; must-change-password page; `pay.sessions` row with the 22:00 expiry (admin/finance at sign-in, reception after "Who are you?").
- [x] "Who are you?": staff name + PIN → `pay.start_session`; Switch person → `pay.end_session`; expired sessions bounce to sign-in with a reason.
- [x] Launcher `/apps` from `pay.apps`; header with location, person, Apps/Settings links, Switch person, Sign out.
- [x] Settings: Locations (incl. Wi-Fi, limits, logout time, PIN rule), Desks & displays (links, regenerate key, iPad steps), Staff names (PINs, order, remove/put back), Users (create with starter password, role, reset, deactivate, lock-out guard), Apps; Providers read-only until Phase 5.
- [x] Migration 0005 (staff_names view, set_staff_pin, rotate_display_key, password_changed, end_session, desk → desk_state trigger) — applied to the shared project and recorded.
- [x] Cron `/api/cron/expire-sessions` (+ expires stale codes), `vercel.json` at 19:05 and 20:05 UTC.
- [x] Checks: typecheck, lint, production build, 40 database acceptance tests, Playwright for the public flow (domain tests run where Supabase is reachable). CI workflow runs all of it on push.
- [ ] **David:** create the Vercel project with the four environment variables (`DEPLOYMENT.md` §1), then the first admin login (§2). Until then nothing can sign in.
- [ ] Placeholders at `/pay`, `/transactions`, `/report` are filled by Phases 3–4.

## Phase 3 — Payments · **built 12 Oct; check-in 2 needs the deployed app and the N-Genius key**

- [x] `lib/providers`: interface, Network adapter ported from the Worker (token cache + 30 s backoff, HTML-error detection, orders, status, summarize), `mock` kind (the N-Genius mock gateway), stubs for Getpayin/Nomod/Stripe with `README.providers.md`, credentials from Vault (`pay.read_secret`) with env fallback.
- [x] `lib/payments`: open order → provider → `pay.open_order`; de-duplicated status checks → `pay.apply_provider_status`; clear (with one last check so a just-paid code is never called unpaid); Realtime broadcast per desk.
- [x] Routes: `/api/desks/[desk]/{state,orders,check,clear}` (staff session), `/api/display/[location]/[desk]/{state,check}` (desk key), `/api/transactions/[id]/check`, `/api/webhooks/ngenius?token=…` (verifies the per-provider token, then asks Network — never trusts the body).
- [x] Screens: `/pay` (amount, note, KiteHub booking #, Show QR with second-tap replace, live status, Copy link / Check now / Clear / New payment, Recent with Check, display link + Wi-Fi line); `/display/[location]/[desk]?key=` (idle / code / paid 15 s / expired 8 s / Wi-Fi screen with auto-return, wake lock, Realtime + polling, `?demo=1`); `/thanks` and `/cancelled` (look the order up and ask the provider).
- [x] Migration 0006 (views under RLS, `read_secret`, `desk_for_display`, 3-arg `display_snapshot`, `desk_snapshot`, `webhook_token`) — applied to the shared project.
- [x] Checks: 49 database tests, 4 adapter tests against the mock gateway (`npm run test:unit`), typecheck, lint, build; the display verified in demo mode.
- [ ] **Check-in 2 (David):** deploy (`DEPLOYMENT.md`), add the N-Genius key as a Supabase Vault secret named `NGENIUS_API_KEY` (Integrations → Vault → Add secret), sign in, open the display on an iPad, take a live €1 payment. Then register the webhook URL shown in Settings → Payment providers in the N-Genius portal.
- [x] E-receipt box on the thank-you page and late-payment flagging on reports (Phase 4).

## Phase 4 — Finance (built)

- [x] Migration 0007: `pay.report_data` (lines, totals by provider and by person, the close, payments that landed today for earlier closed days), `pay.range_totals`, `pay.unresolved_for_day`, `pay.locations_due_for_close`, `pay.is_service`, `pay.note_audit`, `pay.set_report_path`, private Storage bucket `pay-reports` — applied to the shared project.
- [x] `/report?date=…&location=…`: the terminal-style day report, Print (A4) and Print (80 mm slip), totals, by person, late payments, signature line; End of day (checks every unresolved code first, then `pay.close_day`, PDF to Storage, email to the location's finance address); Re-open with a reason (admin, finance); CSV link for the day.
- [x] `/api/cron/nightly` (19:05 and 20:05 UTC = 22:05 Cairo in winter and summer): expire sessions, expire codes, close every location that is past its logout time and has no close yet — same code path as the button, `automatic = true` on the record. `/api/cron/expire-sessions` stays for a manual tidy-up.
- [x] `/transactions`: every location (finance, admin) or their own (reception), filters for location, date range, status, person, reference, late-only; totals from the database; Re-check per unsettled code; `/transactions/export` CSV with the same filters, no row limit, logged to the audit trail.
- [x] `lib/email.ts` (Resend, one fetch, `email_log` dedupe), `lib/report.ts` (text, PDF via pdf-lib, CSV). "Email me a receipt" on the thank-you page — paid orders only, one per address per order.
- [x] Checks: 63 database tests, 7 unit tests (adapter, report text/PDF/CSV), Playwright (sign-in, protected routes incl. report and export, cron 401, thank-you page), typecheck, lint, build.
- [x] Refund state on the list and provider portal links — done in Phase 5.
- [ ] **Check-in 3 (David):** add `RESEND_API_KEY` and `RESEND_FROM_EMAIL` in Vercel and a finance email per location (Settings → Locations), close one real day and check the slip against the Network portal.

## Phase 5 — Providers and settings · **built 12–13 Oct by Claude Code; committed locally, not yet pushed**

- [x] Settings → Payment providers: grouped by location; add/edit (location fixed once added, type, name, outlet reference, live/sandbox — the realm follows it, credential name, enabled, default per location — the old default is cleared first); max five shown and enforced by the database; credential shown as "Set in Vault" / "Set in environment" / "Not found" (`credentialStatus` looks without returning the value; "Vault not checked here" where there is no service-role key); **Test connection** (`provider.testConnection()` with the cached key dropped first; the outcome, never the token, goes to the audit log as `test_connection`); the webhook URL for the N-Genius portal with Copy and Regenerate (two-step confirm; the old URL is refused at once). No migration needed.
- [x] Settings → Audit log: last 200 `pay.audit_log` rows, newest first, actor name (or System), entity and row name, a before/after summary (`lib/audit.ts`, unit-tested; keys and links show as "changed", never their value), reason; filter by entity.
- [x] `/transactions`: a refunded row shows when the refund was seen and whether Network called it partial or a reversal; finance and admin get "Check for refund" on paid rows (the webhook path already re-checks paid orders) and a portal link per provider (`portalUrlFor`, no credential lookup — N-Genius has no per-order deep link, so the tooltip names the reference to search).
- Gap: a partial refund is recorded as fully refunded (no refunded amount column), so totals overstate refunds for it. The row says so; a later migration could store the refunded amount from the order.
- Note: `providers_read` lets reception read its own location's providers, `webhook_token` included. Low risk (the webhook only triggers a re-check against Network), but a column grant or view could hide it — a candidate for a later migration.

## Phase 6 — Hardening and hand-over

- [x] Login rate limiting and the admin email one-time code — migration 0008 (`login_attempts`, `admin_codes`, four service-role-only functions, 22 acceptance tests), `lib/login-guard.ts`, `/sign-in/code`. Five wrong passwords per email or twenty per network in 15 minutes; admin code six digits, once, 10 minutes, five tries, five sends per sign-in; neither the code nor its hash reaches the audit or email log. Switches on by itself once the service-role key and Resend are set; safe to deploy before the migration (DEPLOYMENT.md §4).
- [ ] **David:** apply 0008 to the shared project (DEPLOYMENT.md §4) before or with the Phase 6 deploy.
- [x] Closing that gap (branch `admin-session-guard`, for David's review): migration 0009 makes `pay.is_admin()` and `pay.is_finance()` also require the live `pay.sessions` row for the token's own session — written only after the code step (admin) or at sign-in (finance), removed at 22:00. So an admin password alone opens nothing, even through the Data API, and the 22:00 rule binds the database too. Reception is unchanged. 89 acceptance tests. An admin part-way through sign-in is sent back to the code screen instead of being signed out.
- [ ] **David:** review and merge `admin-session-guard`, then apply 0009 after 0008 (DEPLOYMENT.md §4).
- Deferred: partial refunds are recorded as full. Network's refund format is not in the Worker or the mock gateway, and money should not be built on a guess — build it against one real refunded order (refund the first live €1 in the portal).
- [x] Playwright in CI: an `e2e` job builds the app, starts it and runs the suite (4 pass, 3 skip without a key — verified locally against a production build). Supabase-dependent tests run once the repo has `NEXT_PUBLIC_SUPABASE_ANON_KEY` as an Actions variable; the login test once `E2E_EMAIL` / `E2E_PASSWORD` (/ `E2E_PIN`) are Actions secrets.
- [x] README and DEPLOYMENT finished: migration 0008 (§4), `pay.mvrk.ae` DNS (§5), the week side by side and the cut-over note with rollback (§6).
- [ ] **David:** the Actions variable and secrets above; the week in parallel (one location on MVRK Pay, nightly check against the portal); then cut-over day per DEPLOYMENT.md §6.
- *Check-in 3: hand-over.*
