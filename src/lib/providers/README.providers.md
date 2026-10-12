# Adding a payment provider

One file per provider in this folder, implementing `PaymentProvider` from `types.ts`, and one line in `index.ts`. Credentials come from `resolveCredential(row.credential_ref)`; non-secret settings (outlet ids, environment) from `row.settings`.

| Provider | Create link | Status | Webhook | Notes |
|---|---|---|---|---|
| **Getpayin** (Egypt, EGP) | `POST /v1/payment-links` or hosted checkout with amount, currency, reference, redirect URLs | `GET /v1/payments/{id}` | signed POST; verify with the account's webhook secret | Will serve Riah and Waspo in EGP. Needs a Getpayin merchant account and API key. |
| **Nomod** (UAE) | Payment Links API: `POST /payment_links` (amount, currency, reference, success/cancel URLs) | `GET /payment_links/{id}` → status / payment | signed POST with `Nomod-Signature`-style header | Tap-to-pay on the Nomod app is separate from links. |
| **Stripe** | Checkout Sessions: `POST /v1/checkout/sessions` (mode=payment, success_url with `{CHECKOUT_SESSION_ID}`, metadata) | `GET /v1/checkout/sessions/{id}` + `payment_intent` | `checkout.session.completed`, verified with `Stripe-Signature` and the endpoint secret | Use the official `stripe` package; store the endpoint secret as a Vault secret named in `settings.webhookSecretRef`. |

Rules every adapter follows (they are what the live Network adapter learned the hard way):

1. Never trust a webhook body for the status. Use it to learn *which* order to re-check, then call `getStatus` and apply that.
2. Back off on errors (30 s after a failed auth), never retry in a loop, and surface HTML error pages as "the provider's edge returned an error page".
3. `getStatus` returns `paid` only for a final captured/purchased state; a declined attempt is `failed` with `failedAttempts` counted, and the link may still be live.
4. Keep only scheme and last four of the card.
