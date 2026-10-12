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

## 3. Nightly job

`vercel.json` schedules `/api/cron/nightly` at 19:05 and 20:05 UTC (22:05 Cairo in summer and winter respectively; the other run finds nothing due). It signs everyone out, expires any code still on a display, and closes the day at every location that has not pressed End of day — the same close, marked automatic, with the PDF and the finance email. Vercel sends `CRON_SECRET` automatically; nothing to configure beyond the variable. To run it by hand: `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/nightly`.

Each location's finance email is set in Settings → Locations; with none set, the day still closes and the report is on the report page.

## 4. Login protection (migration 0008) — before deploying the Phase 6 code

`supabase/migrations/0008_login_protection.sql` adds the sign-in limits and the admin email code. It is written and tested but **not yet applied** to the shared project. Apply it like the others: `npm run setup:db -- --commit`, or paste the file into the Supabase SQL editor and then

```sql
insert into pay._migrations (name, sha256) values ('0008_login_protection.sql', '260ae684e13403c615a0a693c76ed3dd562e3f825c4b532c9f58ca1fecbcc515');
```

What changes once it is in:

- Five wrong passwords for one email lock that email for 15 minutes (a right password resets the count); twenty failures from one network lock that network for 15 minutes. The message says so; an admin can also reset the password in Settings → Users.
- An **admin** signing in gets a six-digit code by email and enters it on the next screen. The code works once, for 10 minutes; "Send a new code" is there if it does not arrive. It only switches on when `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are all set — until then admin sign-in skips it and the audit log records `admin_code_skipped`. `ADMIN_EMAIL_CODE=off` in Vercel turns it off on purpose (e.g. if Resend is down).
- Deploying the code before the migration is safe: the limits are simply not enforced and the admin code is skipped (both logged), so nobody is locked out.

## Future migrations

New files in `supabase/migrations/` are applied either by `npm run setup:db -- --commit` (needs `DATABASE_URL`) or through the Supabase SQL editor with their `pay._migrations` row — see README.
