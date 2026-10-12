# MVRK Pay — build brief

12 Oct 2026 · David Cassidy

*This is the brief the build follows. `CONVENTIONS.md`, `PLAN.md` and `DECISIONS.md` sit beside it; the reference implementation is in `../reference/mvrk-qr-desk/`; the weddings repo this app mirrors is the sibling folder `../../riah-weddings` (read-only).*

## Mission and context

Build **MVRK Pay**, a production web app for MVRK's reception teams, to the same structure and quality as the weddings app. Staff type a euro amount, a pay-by-QR code appears on a customer-facing iPad or monitor, and both screens turn green when the payment provider confirms it. Finance gets a printable end-of-day report to reconcile against KiteHub and the payment provider's portal.

A working version already exists as a Cloudflare Worker (`mvrk-qr-desk`, live and taking real payments). Treat it as the functional spec: port its behaviour, screens and provider logic rather than re-inventing them. The new build adds proper accounts, locations, several payment providers, reports and settings, on Supabase.

Two different teams use the two apps: reception uses MVRK Pay; the wedding and finance teams use the weddings app. The weddings app must not gain any payment capability, and MVRK Pay must not depend on weddings code or data. What they share is the way they are built.

## Ground rules

1. **Same conventions as the weddings app.** Before writing any code, read the weddings repo end to end and write `docs/CONVENTIONS.md` in the new repo: folder layout, auth pattern, Supabase client setup, migrations and seeding, server actions vs route handlers, validation (zod or whatever it uses), UI kit and styling, error handling, logging, testing, CI, deployment. MVRK Pay follows every one of those. Where the weddings app has a helper that fits, copy it (do not import it across repos).
2. **Kept apart.** New repo, new Vercel project, own environment variables. The Supabase *project* is the one the weddings app uses (David's decision, 12 Oct 2026: one project, one login for the admin, trivial single sign-on later), but MVRK Pay lives entirely in its own Postgres schema `pay` — its own tables, its own RLS, its own migrations tracker (`pay._migrations`), its own storage bucket. No shared tables, no shared settings, no code imports between the two apps, nothing in the weddings `public` schema is read or written. A login that exists only for MVRK Pay has no weddings profile and the weddings app refuses it (verified: its `auth.users` trigger only updates existing weddings profiles). The only link is the admin launcher (below), which is a page of links.
3. **Euro only.** The Network account is a euro merchant account. Currency is a per-provider setting so other providers can use other currencies later, but nothing in the UI asks reception to choose a currency.
4. **Secrets never enter the repo or the browser.** Provider API keys live in Vercel environment variables or Supabase Vault and are only read on the server. Card data is never stored; keep only scheme and last four digits as the provider returns them.
5. **Simple interface.** Reception should never need training. Match the current app's screens; add nothing to the payment screen that is not needed to take a payment.
6. **Ask at the check-in points only** (see "Order of work"). Between them, take the decision, note it in `docs/DECISIONS.md`, and carry on.

## Architecture and stack

Same stack as the weddings app: Next.js (App Router, TypeScript strict) on Vercel, Supabase for Postgres, Auth, Realtime and Storage, with row-level security on every table. Use the same package manager, lint, format and test tooling the weddings repo uses.

- **Staff screen** (phone or laptop): logged-in reception user, picks their name, types the amount, taps once. Subscribes to the desk's live state over Supabase Realtime.
- **Customer display** (iPad or monitor): a long-lived page opened once per desk with a display key in the URL, no login. Subscribes to the same desk state over Realtime and renders idle / QR / paid / expired / Wi-Fi screens. Must survive a day of being left open: reconnect, resync on visibility change, wake lock, polling fallback if Realtime drops.
- **Server** (route handlers and server actions): creates the payment with the provider, stores the transaction, updates desk state, runs status checks, receives provider webhooks, builds reports.
- **Provider adapters** (`lib/providers/*`): one module per provider behind a single interface (see "Payment providers"). Network International (N-Genius) is the first and only live one at launch.
- **Desk state** lives in a `pay.desk_state` table (one row per desk) instead of the Worker's Durable Object. Every change is one row update; Realtime fans it out to the screens.
- **Scheduled jobs** (Vercel Cron): expire stale payment links, close the day at 22:00 local time per location and send the end-of-day report, and expire sessions.
- **Hosting**: Vercel project `mvrk-pay`, custom domain `pay.mvrk.ae` (David will point DNS when told what to add). Keep the Cloudflare version running untouched until the new one has processed a week of real payments.

## Users, login and the 22:00 logout

Login is Supabase Auth with email and password. The email domain decides the location; the person then picks their own name from that location's staff list.

**Allowed domains and locations** (seed these; editable in Settings):

| Email domain | Location | Timezone |
| --- | --- | --- |
| kitepeople.com | KitePeople | Africa/Cairo |
| mvrkhq.com | MVRK HQ | Africa/Cairo |
| waspoclub.com | Waspo Club | Africa/Cairo |
| riahkiteacademy.com | Riah Kite Academy | Africa/Cairo |

**Login screen flow**

1. Email field. On blur or after the `@`, validate the domain against the allowed list. Any other domain is refused with "This email isn't on an MVRK team domain" and no password field appears. Enforce the same rule server-side and in Supabase (an Auth hook or a `before insert` check on profiles) so a user cannot be created on another domain at all.
2. Once the domain is recognised, show the location as a read-only chip ("KitePeople") above the password field.
3. Password, sign in.
4. **Who are you?** A dropdown of the active staff names for that location (from Settings → Staff). The chosen name is the `cashier` stamped on every payment and shown on the report. A "Switch person" button on the staff screen reopens only this step, for shift changes.
5. Land on the staff payment screen (or the launcher, for admins).

**Roles**: `admin` (David: everything, every location, Settings), `reception` (take payments and print the day's report for their own location), `finance` (sees every location's transactions and reports but cannot take payments or change settings — details under "Additional requirements").

**Automatic logout at 22:00 local time.** Every session has an `expires_at` set at login to the next 22:00 in the location's timezone. Middleware rejects expired sessions and sends the user back to the login screen; the chosen cashier name is cleared with the session. A Vercel Cron job at 22:00 Cairo time also revokes any remaining sessions server-side so a tab left open overnight cannot keep working. Admin sessions follow the same rule. The customer display is not a user session and stays up.

## Admin launcher

After login, an `admin` lands on `/apps`: a dark full-screen grid of large app tiles in the style of the Odoo home screen (icon, name underneath, generous spacing), one tile per app the user may open. For now that is two tiles: **MVRK Pay** (opens the staff screen in this app) and **Weddings** (a plain link to the weddings app's URL, configured in Settings → Apps). Reception users skip the launcher and go straight to the payment screen; a small "Apps" link in the header brings an admin back to it.

Build the launcher so a third tile is one row in a settings table, not a code change. Single sign-on between the two apps is not in scope now: an admin who opens Weddings signs in there as today (with the same email and password, since both apps share one Supabase Auth).

## Screens

Port the look and behaviour of the current app (`reference/mvrk-qr-desk/src/pages/*.html`); the screenshots in the zip's README show the intended result. Rebuild them as components in the weddings app's UI kit, but keep them this plain.

**Staff payment screen** (`/`): location and desk in the header, the person's name, Sign out, Switch person. One card: amount box (numeric keypad on phones), optional note ("guest name, KiteHub booking number, or what it's for"), one big button **Show QR on customer display**. Below it the status card: small copy of the QR, amount, note, live state (Waiting for customer / Card declined, try again / Paid with scheme and last four / Expired / Status check failing), buttons Copy pay link, Check now, Clear display, New payment. Tapping Show QR while an unpaid code is already up asks for a second tap before replacing it. Then the Recent list and a collapsed "Customer display setup" section with the display link, copy and open buttons, iPad tips and the Wi-Fi status line.

**Customer display** (`/display/[desk]?key=…`): full-screen, no chrome, brand label at the top, idle text; on an order: amount, note, the QR large enough to scan from a metre away, the hint "Open your phone camera, point it at the code, then tap the link to pay", a declined line when an attempt fails, and a "No internet? Tap here to join our free Wi-Fi" button that opens a full Wi-Fi screen (join QR, network name and password, Back to payment, auto-return after 45 s, and immediate return when the payment lands). Green "Paid — thank you" screen for 15 s, then idle. "This code has expired" for 8 s, then idle. Only when the location has Wi-Fi details set does the idle screen show a Wi-Fi card and the pay screen the button.

**Customer landing page** (`/thanks`, `/cancelled`): the page the customer's phone lands on after the provider's hosted page: Payment received / Almost there / Not completed / Cancelled, with the amount. No login.

**Recent** (on the staff screen, and `/transactions` for admin and finance): the last orders on this desk today — time, amount, note, cashier, status badge (Paid, Declined, Not confirmed, Unpaid, Expired, Replaced), last four digits, and a **Check** button that re-queries the provider for anything not yet paid. Admin and finance get the full list with filters (location, date range, status, cashier) and CSV export.

**Daily report / End of day**: see its own section.

**Settings**: see its own section.

## Payment providers

Up to five payment-link providers can be configured in Settings; Network International (N-Genius Online) is live from day one, Getpayin, Nomod and Stripe are to be added later. Build one adapter interface and make Network the first implementation, ported from `reference/mvrk-qr-desk/src/ngenius.js`.

```ts
export interface PaymentProvider {
  kind: 'ngenius' | 'getpayin' | 'nomod' | 'stripe';
  createPaymentLink(input: { amountMinor: number; currency: string; merchantRef: string; note?: string;
    customerName?: string; email: string; redirectUrl: string; cancelUrl: string;
    metadata: Record<string, string> }): Promise<{ providerRef: string; payUrl: string; expiresAt?: Date }>;
  getStatus(providerRef: string): Promise<{ state: 'pending' | 'paid' | 'failed' | 'expired' | 'cancelled' | 'refunded';
    failedAttempts: number; card?: { scheme: string; last4: string }; raw: unknown }>;
  parseWebhook?(req: Request): Promise<{ providerRef: string } | null>;   // verify signature, return which order to re-check
  portalUrl?(providerRef: string): string;   // deep link into the provider's own portal for finance
}
```

- A provider row has: name, kind, location, currency, enabled, default-for-location, and a credentials JSON stored encrypted (Supabase Vault) or referenced by environment-variable name. The UI shows only which fields are set, never the values.
- Each location has one default provider; the payment screen uses it without asking. If a location has more than one enabled provider, show a small chooser above the amount; otherwise show nothing.
- Enforce the maximum of five providers in the database (check constraint or trigger) and in the UI.
- Ship Getpayin, Nomod and Stripe as typed stubs that throw "not configured yet", each with a short `README` of the API endpoints to implement, so adding one later is a contained task. Stripe's adapter should use Payment Links or Checkout Sessions with a webhook.
- Payment status is detected two ways: a webhook endpoint per provider (`/api/webhooks/[kind]`) that verifies the call and then fetches the order from the provider before trusting it, and polling as a fallback while an order is waiting (every 4 s from the open screens through the server, backing off to 15 s on errors, never more often). Never mark an order paid from a webhook body alone.

## Data model

Supabase Postgres, schema `pay`, migrations in `supabase/migrations`, RLS on every table, `updated_at` triggers, a seed script for local development. Suggested tables; adjust names to the weddings conventions.

| Table | Holds | Notes |
| --- | --- | --- |
| `locations` | name, slug, email domain, timezone, brand label, idle text, wifi_ssid, wifi_password, wifi_security, logout_time (default 22:00), max_amount, order_expiry_min | One row per site |
| `desks` | location, name (desk-1, desk-2), display_key | A location can have several desks; the key is what the display URL carries |
| `profiles` | auth user id, email, location, role (admin / reception / finance), active | Created on first login from the email domain; admins can pre-create |
| `staff` | location, display name, active, sort order | The names in the login dropdown; no login of their own |
| `providers` | location, kind, name, currency, enabled, is_default, credential_ref | Max five rows in total |
| `transactions` | location, desk, provider, provider_ref, merchant_ref, amount_minor, currency, note, cashier (staff id and name), created_by (profile), status, provider_state, failed_attempts, card_scheme, card_last4, pay_url, paid_at, closed_reason (done / cleared / replaced / expired), last_checked_at, last_error, business_date | The record finance reconciles; never deleted |
| `desk_state` | desk, current transaction id, version, updated_at | One row per desk; Realtime subscription target |
| `day_closes` | location, business_date, closed_at, closed_by, totals JSON, report PDF path | Written by End of day |
| `sessions` | profile, cashier staff id, expires_at | Or store cashier and expiry in the Supabase session's app metadata if the weddings app does it that way |
| `audit_log` | who, what, transaction or setting, before/after, at | Every create, clear, replace, settings change |

`business_date` is the calendar date in the location's timezone at creation; reports and End of day group by it. RLS: reception reads and writes only rows of their own location; finance reads all; admin everything; the display reads `desk_state` and the current transaction's public fields (amount, note, QR, status) through a security-definer function keyed by the desk's display key, never with a logged-in session.

## Daily report and End of day

Reception needs to hand finance a report that reads like a card terminal's end-of-day (Z) report, so finance can tick transactions off against KiteHub and the provider's portal or bank. Build it as a page (`/report?date=…`) with a print stylesheet and a **Print** button; the same page is what End of day emails.

**Report content**, one per location per business day:

- Header: MVRK Pay, location, business date, printed at, printed by, desks included.
- One line per transaction in time order: time, merchant reference, provider, cashier, note, amount, status (Paid / Declined / Not confirmed / Unpaid / Expired / Replaced), scheme and last four for paid ones.
- Totals: paid count and total, declined count, unpaid or not-confirmed count (these need a Check before closing), totals per provider, totals per cashier.
- Footer: a line for a signature and a "matches KiteHub / portal" tick box, and the day-close number once closed.

**Print**: an A4 layout and an 80 mm receipt layout (`@media print` with a page-size switch in the print dialog); monospace columns on the receipt version so it looks like the terminal slip. No colour dependence — status must read in black and white.

**End of day** button (reception and admin): runs Check on every not-yet-paid transaction of the day, shows the report, asks for one confirmation, then writes a `day_closes` row, stores the report as a PDF in Supabase Storage, and emails it to the finance address set for the location. A day can be re-opened only by admin; a later payment that lands after close is flagged on the next day's report as "late — belongs to <date>" so finance is never surprised. If nobody presses the button, the 22:00 cron closes the day the same way and marks the close as automatic.

**Export**: admin and finance can download any date range as CSV (and XLSX if the weddings app already has an export helper) with the same columns plus provider reference.

## Settings (admin only)

A plain settings area with one tab per topic, all stored in the tables above and all editable without a redeploy:

- **Locations**: name, email domain, timezone, brand label and idle text for the display, finance email for the end-of-day report, max amount per payment, link expiry (default 20 min), logout time (default 22:00), Wi-Fi network name, password and security type (blank = no Wi-Fi screen).
- **Desks**: add or rename desks per location, show and regenerate each desk's display link.
- **Staff**: names per location for the login dropdown; activate, deactivate, reorder. Deactivated names disappear from the dropdown but stay on old transactions.
- **Users**: create a user with email and password (server action using the Supabase service role; the email must be on an allowed domain), set role and location, reset password, deactivate. Deactivated users lose access on their next request.
- **Payment providers**: add up to five (kind, name, location, currency, credentials entered once and then shown only as "set"), enable or disable, choose the default per location, and a **Test connection** button that requests a token or equivalent without creating a payment.
- **Apps**: the launcher tiles (name, URL, icon, which roles see it).

Every settings change writes an `audit_log` row.

## Lessons from the live Worker (carry every one of these over)

These were learned the hard way against Network's live API; `reference/mvrk-qr-desk/src/ngenius.js` and `desk.js` implement them.

- **Token**: `POST /identity/auth/access-token` with `Content-Type` and `Accept` `application/vnd.ni-identity.v1+json`, `Authorization: Basic <API key>`, body `{"realmName":"NetworkInternational"}` for live (`"ni"` for sandbox). Live base `https://api-gateway.ngenius-payments.com`. Cache the token for its `expires_in` (about 5 min); one token request at a time; after a failure wait 30 s before asking again.
- **Never hammer Network.** Their edge (Akamai) blocked an egress location for hours after a burst of malformed requests. A request without the JSON body returns an HTML "Access Denied" page; detect HTML bodies and surface "Network edge returned an error page" instead of retrying.
- **Orders**: `POST /transactions/outlets/{outletRef}/orders`, `application/vnd.ni-payment.v2+json`, `action: PURCHASE`, amount in minor units, `emailAddress` required, `billingAddress.firstName/lastName`, `merchantOrderReference` letters, digits and hyphens only, `paymentAttempts: 3`, `merchantAttributes.redirectUrl / cancelUrl / skipConfirmationPage: true`, `merchantDefinedData` for desk, cashier and note (these show in the portal's order details). The pay URL is `_links.payment.href`; QR-encode that.
- **Status**: `GET /transactions/outlets/{outletRef}/orders/{ref}`; the last entry of `_embedded.payment[]` carries `state`: `PURCHASED`, `CAPTURED` or `AUTHORISED` mean paid, `FAILED` or `DECLINED` mean a failed attempt (the link stays usable until attempts run out). Card scheme and masked PAN are in `paymentMethod`.
- **Outlet** (euro): `85c6ced8-572f-4b64-934b-3861f4552cab`. Store it on the provider row, not in code.
- **Honest statuses.** An order is "unpaid" only after a clean answer from the provider; if the last check errored or never ran, show "Not confirmed" and keep a Check button. Never tell staff "not paid" on a guess.
- **Redirect pages** get `?ref=<order>` appended by Network; look the order up to show the right outcome.
- **Display resilience**: the iPad must resync on `visibilitychange`, reconnect with backoff, fall back to polling, and hold a screen wake lock.

## Quality bar, testing and deployment

Match the weddings repo on every point, and in any case:

- TypeScript strict, zod (or the weddings equivalent) on every input, server-only secrets, no `any`.
- Migrations and seed runnable from scratch: `npm run setup:db` gives a working local app with one location, one desk, two staff names, an admin user and a mock provider.
- A **mock provider** adapter and a tiny mock gateway (port `reference/mvrk-qr-desk/test/mock-ngenius.mjs`) so the whole flow runs locally and in CI without Network credentials, including declined attempts, outages and late payments.
- Tests: unit tests for adapters and the day-close totals; Playwright end-to-end for login (domain refusal, location chip, name dropdown), take a payment and see the display turn green, Clear and Replace, Check on a recent order, print report renders, End of day closes and emails, 22:00 logout.
- Same CI pipeline as weddings (lint, typecheck, tests) on every push; preview deployments on Vercel for branches.
- README covering local setup, environment variables, how to add a provider, how to add a location, and the iPad display setup (Add to Home Screen, Auto-Lock Never, Guided Access).
- Accessibility basics: the payment screen works with large text, the display reads in bright daylight (high contrast), buttons are at least 44 px.
- PWA manifest so the staff screen can be added to a phone's Home Screen.

## Order of work and check-ins

Work in phases; stop for David's review at the end of each phase and at nothing else. Keep `docs/PLAN.md` current with what is done and what is next. Slot the "Additional requirements" into these phases: finance role and staff PIN in 2; webhooks, e-receipt and late payments in 3; finance email, refund state and exports in 4; login protection in 6.

1. **Read and plan.** Read the weddings repo and the reference Worker. Write `docs/CONVENTIONS.md`, `docs/PLAN.md` and the data model as a migration draft. *Check-in 1: show the plan and any decisions taken.*
2. **Foundation.** New repo, `pay` schema in the shared Supabase project, Vercel project, CI. Auth with domain rule, location chip, name dropdown, roles, 22:00 expiry. Launcher. Settings for locations, desks, staff, users.
3. **Payments.** Provider interface, Network adapter, mock adapter, transaction and desk state, staff screen, customer display (including Wi-Fi screen), landing pages, webhooks and polling, Recent with Check. *Check-in 2: a live €1 payment on the test outlet, display turning green.*
4. **Finance.** Report page with both print layouts, End of day with email and PDF, day-close cron, CSV export, admin and finance transaction list with filters.
5. **Providers and settings.** Provider settings UI with Test connection, provider stubs for Getpayin, Nomod and Stripe, Apps settings, audit log views.
6. **Hardening and hand-over.** Playwright suite green in CI, README, custom domain instructions, a week of parallel running next to the Cloudflare version, then a short cut-over note. *Check-in 3: hand-over.*

## Additional requirements (confirmed — build all of these)

These are part of the scope, not options. Where one touches a section above, the section above still applies and this list adds to it.

- **Finance role**: read-only access to every location's transactions, reports and exports, so the finance team never needs a reception login. Finance can also re-open and re-close a day with a reason.
- **Staff PIN**: a 4-digit PIN per name in the login dropdown, set in Settings → Staff, so nobody can take payments under another person's name. Admin can turn the PIN requirement off per location.
- **Reference field**: a dedicated "KiteHub booking #" box next to the note, stored on the transaction, searchable, printed on the report and in the CSV, so finance matches line by line.
- **Provider webhooks**: a verified webhook endpoint per provider so the display turns green the moment Network confirms, with polling kept only as the fallback. Print the webhook URL in Settings → Payment providers so David can register it in the N-Genius portal.
- **Automatic end-of-day email at 22:00** local time to the location's finance address, via Resend (MVRK already uses it), PDF attached, whether or not reception pressed End of day.
- **Refund visibility**: refunds are made in the provider's portal, not in this app, but Check and the webhook must pull the refunded state, show it in Recent and on reports, and deep-link to the provider's order page.
- **Customer e-receipt**: an "Email me a receipt" box on the thank-you page the customer's phone lands on, sent via Resend with amount, date, location, last four and the merchant reference. Nothing is printed at the desk.
- **Late-payment handling**: a payment that lands after its code was cleared, replaced or expired is shown as Paid in Recent and flagged on the report of the day it belongs to (and on the next day's if that day was already closed).
- **Login protection**: rate-limit the login route (per IP and per email) and require an email one-time code for admin sign-in.
- **Currency per provider**: the schema and adapters carry currency so EGP via Getpayin can serve the Egypt locations later; the payment screen shows no currency choice until a location has two enabled providers with different currencies.
- **Single sign-on across MVRK apps** is out of scope now. Keep the auth code in one isolated module so moving both apps to one Supabase Auth project later is a small change (they already share the Auth project, so this is mostly a session-cookie question).

## Reference material (read before starting)

- Weddings app repo: `../riah-weddings` (sibling folder of this repo) — the conventions source. Do not modify it.
- Weddings app URL for the launcher tile: not yet supplied; it is a row in Settings → Apps, so David adds it there once the app runs.
- Reference implementation: `reference/mvrk-qr-desk/`: `src/index.js` (routes, order creation, login), `src/ngenius.js` (Network client), `src/desk.js` (desk state machine: waiting / paid / expired / cleared / replaced, polling and backoff), `src/wifi.js` (Wi-Fi QR text), `src/pages/*.html` (staff, display, login, thank-you screens), `test/run.mjs` and `test/mock-ngenius.mjs` (27 end-to-end tests and the mock gateway), `README.md`.
- Live app for comparison: `https://mvrk-qr-desk.dormies.workers.dev` (David can give you a login).
- Network International docs: `https://docs.ngenius-payments.com` (Hosted Payment Page, Order status, Webhooks).
- Credentials: David supplies the N-Genius API key, outlet reference, Supabase and Vercel access, and the Resend API key when each is needed. Never ask for them in chat before the phase that uses them.
