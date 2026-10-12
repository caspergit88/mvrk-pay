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

## Future migrations

New files in `supabase/migrations/` are applied either by `npm run setup:db -- --commit` (needs `DATABASE_URL`) or through the Supabase SQL editor with their `pay._migrations` row — see README.
