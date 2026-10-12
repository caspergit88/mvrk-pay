# MVRK Pay

Staff type an amount. The customer-facing iPad or monitor shows an N-Genius pay-by-QR code. The customer scans it with their phone camera and pays on Network International's hosted page. Both screens turn green the moment N-Genius confirms the payment.

Replaces the 10-field "Pay by QR Code" form in the N-Genius portal with one field. Guests without mobile data can tap "No internet?" on the display to get a join-our-Wi-Fi QR, then pay.

```
 Staff phone / laptop            Cloudflare Worker                 Customer iPad / monitor
 ┌────────────────────┐   POST   ┌──────────────────────┐  push   ┌──────────────────────┐
 │ EUR                │ ───────▶ │ create order         │ ──────▶ │      EUR 120.50      │
 │ Amount: 120.50     │          │ at N-Genius          │         │   ███ QR code ███    │
 │ [Show QR on display]│ ◀────── │ poll status every 3s │ ──────▶ │ ✓ Paid — thank you   │
 └────────────────────┘   push   └──────────────────────┘         └──────────────────────┘
```

## What's in the box

| Path | What it is |
|---|---|
| `src/index.js` | The Worker: login, staff screen, display screen, API routes |
| `src/desk.js` | One Durable Object per desk: holds what's on the display, pushes updates over WebSocket, polls N-Genius |
| `src/ngenius.js` | N-Genius API client (token, create order, order status) |
| `src/wifi.js` | Builds the guest Wi-Fi join code shown on the display |
| `src/qr.js` | QR encoder (qrcode-generator 1.4.4, MIT) — QR is rendered server-side as SVG |
| `src/pages/*.html` | Login, staff, display, and the customer's "thank you" page |
| `wrangler.toml` | Settings that are safe to commit (outlets, desks, brand, limits) |
| `scripts/set-secrets.mjs` | Interactive helper that stores the 4 secrets in Cloudflare |
| `test/` | Mock N-Genius gateway + end-to-end tests (`npm test`) |

## Deploy (about 15 minutes, once)

You need: a free [Cloudflare account](https://dash.cloudflare.com/sign-up), Node.js 18+, and an N-Genius API key.

**1. Create an API key in the N-Genius portal**
Settings → Integrations → Service account → **New**. Name it `mvrk-pay`, type *Merchant Service Account*. Copy the key (it's a long base64 string). Keep the existing `kitehub` key as it is.

**2. Install and log in**
```bash
npm install
npx wrangler login        # opens a browser to authorise Cloudflare
```

**3. Store the secrets**
```bash
npm run secrets
```
It asks for the API key and the staff logins (`username:password` pairs, e.g. `desk:Kite2026!,david:Secret1`), then generates the display key and session secret itself.

**4. Deploy**
```bash
npx wrangler deploy
```
You get a URL like `https://mvrk-qr-desk.<your-account>.workers.dev`. That's it.

**5. Set up the screens**
- **Staff**: open the URL on any phone/laptop, sign in. Add to Home Screen on a phone for one-tap access.
- **Customer display**: on the staff screen, open *Customer display setup*, copy the link and open it once on the iPad (or in a browser window dragged onto the customer-facing monitor). Add it to the iPad's Home Screen so it runs full-screen, set Auto-Lock to Never, and lock it there with Guided Access. It stays connected and updates itself; nothing is ever sent to it by hand.

## Day-to-day

1. Type the amount (euro), optional note, tap **Show QR on customer display**.
2. Customer scans with their phone camera → hosted pay page (cards, Apple Pay, etc. as enabled on the outlet).
3. Display and staff screen turn green with the last 4 digits of the card. Display returns to idle after 15 s.
4. **Clear display** drops an unpaid QR. Tapping **Show QR** while an unpaid QR is up asks for a second tap before replacing it.
5. **Recent on this desk** lists the last orders. **Check** re-queries N-Genius for an unpaid one — useful if a customer finished paying after the display moved on.

Orders show up in the N-Genius portal as normal, with `desk`, `cashier` and `note` in the Order Details (merchant-defined data) and an order reference like `QR-DESK-1-…`.

## Settings you may want to change

All in `wrangler.toml` (then `npx wrangler deploy` again):

| Setting | Default | Notes |
|---|---|---|
| `DESKS` | `desk-1` | Comma-separated. Each desk has its own display and its own queue, e.g. `riah,waspo` |
| `OUTLETS` | EUR only | Add an outlet and the staff screen shows a currency choice. The `ref` is the outlet reference from Settings → Organisational hierarchy |
| `DEFAULT_EMAIL` | `payments@mvrk.ae` | N-Genius requires an email on every order; its receipts go here |
| `ORDER_EXPIRY_MIN` | `20` | After this, an unpaid QR shows "expired" and clears |
| `MAX_AMOUNT` | `50000` | Per-payment sanity limit |
| `BRAND`, `APP_NAME`, `DISPLAY_IDLE_TEXT` | `MVRK`, `MVRK Pay` | Text on the screens |
| `WIFI_SSID`, `WIFI_PASSWORD` | unset | Set both (in the Cloudflare dashboard, as Secrets) and the display shows a "Join our Wi-Fi" QR on the idle screen, plus a "No internet?" button under every payment QR that opens the Wi-Fi code full-screen (returns to the payment by itself). Unset = nothing shown. Optional `WIFI_SECURITY` (`WPA` default, `WEP`, `nopass`) and `WIFI_HIDDEN` (`true`) |
| `NGENIUS_ENV` | `live` | `sandbox` to test against N-Genius UAT with a sandbox API key |
| `NGENIUS_REALM` | `NetworkInternational` | Identity realm. Live UAE accounts use `NetworkInternational`; sandbox uses `ni` |

Secrets (`npx wrangler secret put NAME`): `NGENIUS_API_KEY`, `APP_USERS`, `DISPLAY_KEY`, `SESSION_SECRET`.
To add or remove a staff login, re-run `npx wrangler secret put APP_USERS` with the full new list; removed users are signed out immediately.

## Security notes

- The N-Genius API key only ever lives in Cloudflare as a secret. The browser never sees it.
- Staff sessions are signed cookies (HttpOnly, Secure, 30 days). Writes require a session and a same-origin check.
- The display link carries a read-only key. It can only see the current amount/QR and the recent list, never create or clear.
- Staff passwords are stored as plain `user:password` pairs in a Cloudflare secret. Fine for 2–5 desk logins; use proper passwords.
- Add a Cloudflare rate-limiting rule on `/login` if you want extra brute-force protection.

## Running locally

```bash
npm install
npm test          # starts the mock gateway + wrangler dev, runs the end-to-end tests
npm run dev       # http://127.0.0.1:8787 — login desk / test1234 (see .dev.vars)
```
`.dev.vars` holds local-only secrets and points the Worker at the mock gateway. It is git-ignored.

## Possible next steps

- **Webhook instead of polling**: N-Genius can POST payment events to the Worker (Settings → Integrations → Webhooks). Polling every 3 s is simple and works; a webhook would make the green screen near-instant.
- **Receipt by SMS/WhatsApp**: the pay link is already in the order; a "Send link" button could push it through Respond.io for customers who'd rather not scan.
- **Custom domain**: `pay.mvrk.ae` via Workers → Settings → Domains (the Worker itself is still called `mvrk-qr-desk`; renaming it would change the URL).
- **Printable fallback**: a static OneLink QR per desk, if Network enables OneLink on the account.

## Costs

Cloudflare Workers free plan: 100,000 requests/day and Durable Objects included. A busy day of a few hundred payments uses a few thousand requests. Expect $0/month unless volume is far higher, in which case the $5/month Workers Paid plan covers it.
