// Minimal N-Genius Online (Network International) API client for Cloudflare Workers.
// Docs: https://docs.ngenius-payments.com/reference/hosted-payment-page

const BASES = {
  live: 'https://api-gateway.ngenius-payments.com',
  sandbox: 'https://api-gateway.sandbox.ngenius-payments.com',
};

const PAID_STATES = new Set(['PURCHASED', 'CAPTURED', 'AUTHORISED', 'SUCCESS']);
const FAILED_STATES = new Set(['FAILED', 'DECLINED']);

// Module-level token cache. A Worker isolate may serve many requests; the token lives 5 minutes.
// After a failed token request we wait TOKEN_RETRY_MS before asking again, so a gateway hiccup
// never turns the 3-second status poll into a flood of failing identity calls.
let tokenCache = { token: null, exp: 0, failedAt: 0, lastError: null };
const TOKEN_RETRY_MS = 30_000;

export function baseUrl(env) {
  if (env.NGENIUS_BASE) return env.NGENIUS_BASE.replace(/\/$/, '');
  return BASES[(env.NGENIUS_ENV || 'live').toLowerCase()] || BASES.live;
}

export class NGeniusError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'NGeniusError';
    this.status = status;
    this.body = body;
  }
}

async function readBody(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

/** Current cached token, if still valid for at least 30s. Used to hand a token to the desk object. */
export function peekToken() {
  if (tokenCache.token && tokenCache.exp - Date.now() > 30_000) return { token: tokenCache.token, exp: tokenCache.exp };
  return null;
}

/** Seed the cache with a token obtained elsewhere (e.g. by the Worker during order creation). */
export function seedToken(token, exp) {
  if (token && exp && exp - Date.now() > 30_000 && (!tokenCache.token || tokenCache.exp < exp)) {
    tokenCache = { token, exp, failedAt: 0, lastError: null };
  }
}

export async function getToken(env) {
  const now = Date.now();
  if (tokenCache.token && tokenCache.exp - now > 30_000) return tokenCache.token;
  if (!env.NGENIUS_API_KEY) throw new NGeniusError('NGENIUS_API_KEY secret is not set', 500);
  if (tokenCache.failedAt && now - tokenCache.failedAt < TOKEN_RETRY_MS) {
    throw new NGeniusError(`N-Genius token request failed recently, retrying in ${Math.ceil((TOKEN_RETRY_MS - (now - tokenCache.failedAt)) / 1000)}s`, 503, tokenCache.lastError);
  }

  // Identity realm differs by environment: sandbox uses "ni", live (UAE) uses "NetworkInternational".
  // NGENIUS_REALM overrides this if Network gives you a different realm for your account.
  const isSandbox = (env.NGENIUS_ENV || 'live').toLowerCase() === 'sandbox';
  const realmName = env.NGENIUS_REALM || (isSandbox ? 'ni' : 'NetworkInternational');
  const res = await fetch(`${baseUrl(env)}/identity/auth/access-token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${env.NGENIUS_API_KEY}`,
      'Content-Type': 'application/vnd.ni-identity.v1+json',
      'Accept': 'application/vnd.ni-identity.v1+json',
    },
    body: JSON.stringify({ realmName }),
  });
  const body = await readBody(res);
  if (!res.ok || !body || !body.access_token) {
    const detail = typeof body === 'string' && body.includes('<HTML') ? 'Network edge returned an HTML error page (Access Denied)' : body;
    tokenCache = { token: null, exp: 0, failedAt: now, lastError: detail };
    throw new NGeniusError(`Could not get N-Genius access token (HTTP ${res.status}, realm ${realmName})`, res.status, detail);
  }
  const ttlMs = Math.max(60, Number(body.expires_in) || 300) * 1000;
  tokenCache = { token: body.access_token, exp: now + ttlMs, failedAt: 0, lastError: null };
  return body.access_token;
}

/**
 * Create a hosted-payment-page order.
 * Returns the raw order object; the pay page URL is order._links.payment.href.
 */
export async function createOrder(env, opts) {
  const token = await getToken(env);
  const payload = {
    action: 'PURCHASE',
    amount: { currencyCode: opts.currency, value: opts.amountMinor },
    emailAddress: opts.email,
    language: 'en',
    merchantOrderReference: opts.merchantRef,
    paymentAttempts: 3,
    merchantAttributes: {
      redirectUrl: opts.redirectUrl,
      cancelUrl: opts.cancelUrl,
      cancelText: 'Cancel',
      skipConfirmationPage: true,
    },
    billingAddress: {
      firstName: opts.firstName || 'Walk-in',
      lastName: opts.lastName || 'Customer',
    },
    merchantDefinedData: opts.merchantDefinedData || {},
  };

  const res = await fetch(`${baseUrl(env)}/transactions/outlets/${opts.outletRef}/orders`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/vnd.ni-payment.v2+json',
      'Accept': 'application/vnd.ni-payment.v2+json',
    },
    body: JSON.stringify(payload),
  });
  const body = await readBody(res);
  if (!res.ok || !body || !body.reference) {
    throw new NGeniusError(`N-Genius rejected the order (HTTP ${res.status})`, res.status, body);
  }
  return body;
}

export async function getOrder(env, outletRef, orderRef) {
  const token = await getToken(env);
  const res = await fetch(`${baseUrl(env)}/transactions/outlets/${outletRef}/orders/${orderRef}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.ni-payment.v2+json',
    },
  });
  const body = await readBody(res);
  if (!res.ok || !body || !body.reference) {
    throw new NGeniusError(`Could not read order status (HTTP ${res.status})`, res.status, body);
  }
  return body;
}

/** Reduce an order object to what the desk needs to know. */
export function summarize(order) {
  const payments = (order && order._embedded && Array.isArray(order._embedded.payment)) ? order._embedded.payment : [];
  const last = payments[payments.length - 1];
  const state = (last && last.state) || 'STARTED';
  const paid = PAID_STATES.has(state);
  const failedAttempts = payments.filter(p => FAILED_STATES.has(p.state)).length;
  const card = last && last.paymentMethod ? { scheme: last.paymentMethod.name || '', pan: last.paymentMethod.pan || '' } : null;
  return {
    state,
    paid,
    lastFailed: FAILED_STATES.has(state),
    failedAttempts,
    card,
    amount: order.amount || null,
    orderRef: order.reference,
    merchantRef: order.merchantOrderReference || '',
    payUrl: order._links && order._links.payment ? order._links.payment.href : '',
  };
}
