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

   Phase 3 adds the N-Genius key; Phase 4 adds `RESEND_API_KEY` and `RESEND_FROM_EMAIL`.
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

`vercel.json` schedules `/api/cron/expire-sessions` at 19:05 and 20:05 UTC (22:05 Cairo, winter and summer). Vercel sends `CRON_SECRET` automatically. Nothing to configure beyond the variable.

## Future migrations

New files in `supabase/migrations/` are applied either by `npm run setup:db -- --commit` (needs `DATABASE_URL`) or through the Supabase SQL editor with their `pay._migrations` row — see README.
