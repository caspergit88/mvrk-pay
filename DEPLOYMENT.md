# Deploying MVRK Pay

Two services, like the weddings app: **Supabase** (the shared project, schema `pay`) and **Vercel** (the app).
The database side is already done; what remains is the Vercel project and its environment variables, which only David can add.

## 1. Vercel project (about 5 minutes, once)

1. [vercel.com](https://vercel.com) → **Add New → Project** → import `caspergit88/mvrk-pay`. Vercel detects Next.js; the defaults are right.
2. Before the first deploy, **Settings → Environment Variables** (Production and Preview):

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://rsjjsrpjwxuxuvoysiwx.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the publishable key from Supabase → Settings → API Keys (`sb_publishable_…`) |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API Keys → *Legacy* tab → `service_role` (secret; same value the weddings app uses) |
   | `CRON_SECRET` | any long random string, e.g. `openssl rand -base64 32` |
   | `RESEND_API_KEY` | Resend → API Keys (the weddings app's key works; sending only) |
   | `RESEND_FROM_EMAIL` | a verified sender, e.g. `MVRK Pay <pay@mvrk.ae>` |

   **Resend, as set up (21 Oct 2026):** MVRK Pay sends through the **riahkiteacademy** Resend team — the one the weddings app uses, where `riahkiteacademy.com` is verified — with its own key `mvrk-pay-vercel` (sending access, that domain only), from `MVRK Pay <pay@riahkiteacademy.com>`. The other Resend login (davidcassidy07) also lists `riahkiteacademy.com`, as *failed*: it cannot verify while the riahkiteacademy team owns the domain, and should not be "fixed" — claiming it there would stop the weddings app's email.

   Without the two Resend values the app still runs: end-of-day reports are stored as PDFs and shown on the report page, and the email is logged as "no provider" instead of sent; the "Email me a receipt" box tells the customer to ask the desk.

   The **N-Genius API key** does not go in Vercel: add it in Supabase → Integrations → Vault → **Add new secret**, name `NGENIUS_API_KEY`, value = the key from the N-Genius portal (Settings → Integrations → Service account). The provider row in `pay.providers` names that secret, so the app finds it; a different name per location is fine as long as the row says so. (`DEFAULT_PAYER_EMAIL` in Vercel is optional — Network needs an email on every order; it defaults to payments@mvrk.ae.)
3. Deploy. The URL is `mvrk-pay-….vercel.app` until `pay.mvrk.ae` is pointed at it (Settings → Domains; Vercel shows the DNS record to add).

## 2. First admin login

Either run, locally, with `.env.local` holding the four values above plus `DATABASE_URL`:

```bash
npm install
npm run setup:db -- --commit --admin-email david@mvrkhq.com --admin-name "David"
```

(prints a one-time password), or — simpler — ask Claude to run that step once the service-role key is in your local `.env.local`.

Then sign in at the Vercel URL, replace the password, and add the team under Settings → Users and Settings → Staff.

**Forgotten admin password** (there is no other admin to reset it in Settings → Users): run the same command with `--reset-password` added. It prints a new one-time password, to be changed at the next sign-in; nothing else changes.

## 3. Nightly job

`vercel.json` schedules `/api/cron/nightly` at 19:05 and 20:05 UTC (22:05 Cairo in summer and winter respectively; the other run finds nothing due). It signs everyone out, expires any code still on a display, and closes the day at every location that has not pressed End of day — the same close, marked automatic, with the PDF and the finance email. Vercel sends `CRON_SECRET` automatically; nothing to configure beyond the variable. To run it by hand: `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/nightly`.

Each location's finance email is set in Settings → Locations; with none set, the day still closes and the report is on the report page.

## 4. Login protection (migration 0008) — before deploying the Phase 6 code

`supabase/migrations/0008_login_protection.sql` adds the sign-in limits and the admin email code. Applied to the shared project on 14 Oct 2026, with 0009 below; kept here for the record and for a fresh project. Apply it like the others: `npm run setup:db -- --commit`, or paste the file into the Supabase SQL editor and then

```sql
insert into pay._migrations (name, sha256) values ('0008_login_protection.sql', '260ae684e13403c615a0a693c76ed3dd562e3f825c4b532c9f58ca1fecbcc515');
```

What changes once it is in:

- Five wrong passwords for one email lock that email for 15 minutes (a right password resets the count); twenty failures from one network lock that network for 15 minutes. The message says so; an admin can also reset the password in Settings → Users.
- An **admin** signing in gets a six-digit code by email and enters it on the next screen. The code works once, for 10 minutes; "Send a new code" is there if it does not arrive. It only switches on when `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are all set — until then admin sign-in skips it and the audit log records `admin_code_skipped`. `ADMIN_EMAIL_CODE=off` in Vercel turns it off on purpose (e.g. if Resend is down).
- Deploying the code before the migration is safe: the limits are simply not enforced and the admin code is skipped (both logged), so nobody is locked out.

**Then 0009** (`0009_admin_needs_a_session.sql`, after 0008), the same way, with

```sql
insert into pay._migrations (name, sha256) values ('0009_admin_needs_a_session.sql', 'e9eebe2179d7b79113c5a0d972048e1a3cd02ecd5f169f0887a3547ef561fe73');
```

It makes admin and finance powers in the database need a live session — the one that starts after the code (admin) or at sign-in (finance) and ends at 22:00 — so an admin password alone opens nothing, even outside the app. Apply it once the code from this branch is deployed; nothing else to set. If anything misbehaves after it (an admin or finance screen that suddenly shows nothing), signing out and in again fixes it for that person, and the migration can be reversed by running 0002's two original definitions of `pay.is_admin` and `pay.is_finance`.

### Sign in with an emailed code (migration 0010)

Once `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are in Vercel (and redeployed), the sign-in page offers **Email me a code** instead of a password box: everyone types their email, gets a six-digit code (once, 10 minutes, five tries, five codes an hour), and is in. A code sign-in proves the mailbox, so admins skip the second code. "Use a password instead" stays on the page as a fallback; if email is down, an admin can give someone a temporary password in Settings → Users. New users can be added without a password. Until Resend is set, sign-in stays as it is — password only. Apply 0010 like the others, tracker row:

```sql
insert into pay._migrations (name, sha256) values ('0010_sign_in_by_email_code.sql', '6faa4074143123bc328500df5cb3c0c2ba32301da11246690a980446d26bc9cb');
```

## 5. pay.mvrk.ae

1. Vercel → the `mvrk-pay` project → **Settings → Domains → Add** → `pay.mvrk.ae`. Vercel shows the record it wants — normally a **CNAME** `pay` → `cname.vercel-dns.com`.
2. Add that record wherever `mvrk.ae`'s DNS is managed. If that is Cloudflare, set the record to **DNS only** (grey cloud) so Vercel can issue the certificate.
3. **During the parallel week** keep the Worker on its own address (`mvrk-qr-desk.dormies.workers.dev`). If `pay.mvrk.ae` is already attached to the Worker (Cloudflare → Workers → mvrk-qr-desk → Settings → Domains), leave it there and use the `….vercel.app` address for MVRK Pay until cut-over day.
4. Once Vercel shows the domain as valid, open Settings → Payment providers **on the new address** and copy the webhook URL again — it is built from the address you are on.

## 6. A week side by side, then cut-over

The brief: keep the Cloudflare Worker untouched until MVRK Pay has handled a week of real payments.

**The week.** Pick one location (KitePeople) to take its payments on MVRK Pay; the others stay on the Worker. Each evening, check MVRK Pay's day report against the N-Genius portal for that outlet — every portal payment should be on the report as Paid, with nothing Not confirmed left over. Anything that disagrees: Re-check the row, and tell Claude what you saw.

**Cut-over day** (about 15 minutes, outside opening hours):

1. In the N-Genius portal → Settings → Integrations → Webhooks: replace the webhook URL with the one from Settings → Payment providers (on `pay.mvrk.ae`, if the domain has moved).
2. If `pay.mvrk.ae` pointed at the Worker: remove it from the Worker's domains, then do §5.
3. On each desk's iPad, open that desk's link from Settings → Desks & displays and add it to the Home Screen again (the old icon opens the Worker).
4. Sign every reception login in once on `pay.mvrk.ae`.
5. Leave the Worker deployed but unused for another week as a fallback; then delete it in Cloudflare (Workers → mvrk-qr-desk → Settings → Delete). `reference/mvrk-qr-desk/` stays in this repo as the record of how it worked.

**Rolling back** during the fallback week is the same steps in reverse: the iPads open the Worker's address again, and the Worker's webhook goes back into the N-Genius portal.

## Future migrations

New files in `supabase/migrations/` are applied either by `npm run setup:db -- --commit` (needs `DATABASE_URL`) or through the Supabase SQL editor with their `pay._migrations` row — see README.
