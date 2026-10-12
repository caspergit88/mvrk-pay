// MVRK Pay — Cloudflare Worker
// Staff type an amount; the customer display shows the N-Genius pay-by-QR code; both screens
// turn green when N-Genius confirms the payment. The display can also show a "join our Wi-Fi" QR.

import qrcode from './qr.js';
import { createOrder, getOrder, getToken, peekToken, summarize, NGeniusError } from './ngenius.js';
import { wifiConfig, wifiQrText, wifiDetailsText } from './wifi.js';
import loginHtml from './pages/login.html';
import staffHtml from './pages/staff.html';
import displayHtml from './pages/display.html';
import thanksHtml from './pages/thanks.html';

export { Desk } from './desk.js';

const SESSION_COOKIE = 'mqd_session';
const DESK_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (err) {
      if (err instanceof NGeniusError) {
        return json({ ok: false, error: err.message, detail: trimDetail(err.body) }, err.status >= 400 && err.status < 600 ? 502 : 500);
      }
      console.error('Unhandled error', err && err.stack || err);
      return json({ ok: false, error: 'Internal error' }, 500);
    }
  },
};

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (path === '/health') return json({ ok: true, env: env.NGENIUS_ENV || 'live' });

  // ----- auth pages -----
  if (path === '/login') {
    if (method === 'GET') {
      if (await currentUser(request, env)) return redirect('/');
      return html(fill(loginHtml, { ERROR: '', BRAND: brand(env), APP_NAME: appName(env) }));
    }
    if (method === 'POST') return handleLogin(request, env);
  }
  if (path === '/logout' && method === 'POST') {
    return new Response(null, { status: 302, headers: { Location: '/login', 'Set-Cookie': clearCookie() } });
  }

  // ----- customer phone lands here after paying (redirectUrl / cancelUrl); N-Genius appends ?ref=<order> -----
  const thanksMatch = path.match(/^\/(thanks|cancelled)(?:\/([A-Za-z0-9]{3,8}))?\/?$/);
  if (thanksMatch) return handleThanks(url, env, thanksMatch[1] === 'cancelled', thanksMatch[2] || '');

  // ----- customer display (iPad / monitor) -----
  const dispMatch = path.match(/^\/display\/([^/]+)\/?$/);
  if (dispMatch) {
    const desk = dispMatch[1];
    if (!DESK_RE.test(desk) || !deskList(env).includes(desk)) return html(displayErrorPage(env, 'Unknown desk'), 404);
    const key = url.searchParams.get('key') || '';
    if (!(await displayKeyOk(key, env)) && !(await currentUser(request, env))) {
      return html(displayErrorPage(env, 'This display link is missing its key. Open the staff screen → "Customer display" to get the right link.'), 403);
    }
    const wifi = wifiConfig(env);
    return html(fill(displayHtml, {
      DESK: desk,
      KEY: key,
      BRAND: brand(env),
      APP_NAME: appName(env),
      IDLE_TEXT: env.DISPLAY_IDLE_TEXT || 'Ready when you are',
      // Guest Wi-Fi card: rendered server-side, hidden entirely when WIFI_SSID is not set.
      WIFI_CLASS: wifi ? 'haswifi' : 'nowifi',
      WIFI_QR_HTML: wifi ? makeQrSvg(wifiQrText(wifi)) : '',
      WIFI_DETAILS: wifi ? wifiDetailsText(wifi) : '',
    }));
  }

  // ----- API -----
  if (path.startsWith('/api/')) return handleApi(request, env, url);

  // ----- staff screen -----
  if (path === '/' || path === '') {
    const user = await currentUser(request, env);
    if (!user) return redirect('/login');
    return html(fill(staffHtml, { BRAND: brand(env), APP_NAME: appName(env), USER: user }));
  }

  return new Response('Not found', { status: 404 });
}

// =====================================================================
// API
// =====================================================================
async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  // Desk-scoped endpoints
  const m = path.match(/^\/api\/desks\/([^/]+)\/(state|ws|orders|clear|check|recent-check)$/);
  if (m) {
    const desk = m[1];
    const action = m[2];
    if (!DESK_RE.test(desk) || !deskList(env).includes(desk)) return json({ ok: false, error: 'Unknown desk' }, 404);

    const user = await currentUser(request, env);
    const displayOk = await displayKeyOk(url.searchParams.get('key') || '', env);

    // Read-only endpoints: staff session OR display key. "check" only refreshes status, so the display may call it too.
    if (action === 'state' || action === 'ws' || action === 'check') {
      if (!user && !displayOk) return json({ ok: false, error: 'Unauthorised' }, 401);
      const stub = deskStub(env, desk);
      if (action === 'ws') {
        return stub.fetch(new Request('https://desk/ws', request));
      }
      if (action === 'check') {
        if (method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
        return checkFromWorker(env, stub);
      }
      return stub.fetch('https://desk/state');
    }

    // Everything else needs a logged-in staff member.
    if (!user) return json({ ok: false, error: 'Unauthorised' }, 401);
    if (method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
    if (!sameOrigin(request, url)) return json({ ok: false, error: 'Bad origin' }, 403);

    const stub = deskStub(env, desk);
    if (action === 'clear') return stub.fetch('https://desk/clear', { method: 'POST' });
    if (action === 'recent-check') {
      let body; try { body = await request.json(); } catch { return json({ ok: false, error: 'Bad JSON' }, 400); }
      if (!body || typeof body.orderRef !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.orderRef)) return json({ ok: false, error: 'Bad order reference' }, 400);
      // Ask the gateway from here (the browser-request path) and hand the answer to the desk object; it retries itself if we fail.
      let summary = null;
      try {
        const snap = await stub.fetch('https://desk/state').then(r => r.json());
        const item = (snap.recent || []).find(r => r.orderRef === body.orderRef);
        if (item) summary = summarize(await getOrder(env, item.outletRef, item.orderRef));
      } catch { summary = null; }
      return stub.fetch('https://desk/recent-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderRef: body.orderRef, summary, ...(await tokenHandoff(env)) }) });
    }
    if (action === 'orders') return handleCreateOrder(request, env, url, desk, user, stub);
  }

  if (path === '/api/me' && method === 'GET') {
    const user = await currentUser(request, env);
    if (!user) return json({ ok: false, error: 'Unauthorised' }, 401);
    const outlets = outletList(env).map(o => ({ code: o.code, label: o.label || o.code, currency: o.currency }));
    return json({
      ok: true,
      user,
      brand: brand(env),
      appName: appName(env),
      wifiSsid: (wifiConfig(env) || {}).ssid || '',
      desks: deskList(env),
      outlets,
      displayKey: env.DISPLAY_KEY || '',
      maxAmount: maxAmount(env),
      env: env.NGENIUS_ENV || 'live',
    });
  }

  return json({ ok: false, error: 'Not found' }, 404);
}

async function handleCreateOrder(request, env, url, desk, user, stub) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Bad JSON' }, 400); }

  const outlet = outletList(env).find(o => o.code === String(body.outlet || '').toUpperCase());
  if (!outlet) return json({ ok: false, error: 'Unknown currency/outlet' }, 400);

  const amount = Number(String(body.amount ?? '').replace(/,/g, '.'));
  if (!Number.isFinite(amount) || amount <= 0) return json({ ok: false, error: 'Enter an amount greater than 0' }, 400);
  if (amount > maxAmount(env)) return json({ ok: false, error: `Amount is above the limit of ${maxAmount(env)}` }, 400);
  const amountMinor = Math.round(amount * 100);
  const amountMajor = amountMinor / 100;

  const note = String(body.note || '').trim().slice(0, 80);
  const [firstName, ...rest] = note ? note.split(/\s+/) : [];
  const lastName = rest.join(' ');

  const merchantRef = `QR-${desk}-${Date.now().toString(36)}-${rand(4)}`.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const origin = url.origin;

  const order = await createOrder(env, {
    outletRef: outlet.ref,
    currency: outlet.currency,
    amountMinor,
    email: env.DEFAULT_EMAIL || 'payments@example.com',
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    merchantRef,
    redirectUrl: `${origin}/thanks/${outlet.code}`,
    cancelUrl: `${origin}/cancelled/${outlet.code}`,
    merchantDefinedData: { desk, cashier: user, note, source: 'mvrk-pay' },
  });

  const payUrl = order._links && order._links.payment && order._links.payment.href;
  if (!payUrl) throw new NGeniusError('Order created but no pay-page link returned', 502, order);

  const current = {
    orderRef: order.reference,
    merchantRef,
    outletCode: outlet.code,
    outletRef: outlet.ref,
    currency: outlet.currency,
    amount: amountMajor,
    amountMinor,
    payUrl,
    qrSvg: makeQrSvg(payUrl),
    note,
    cashier: user,
    desk,
    gatewayState: 'STARTED',
  };

  const res = await stub.fetch('https://desk/order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...current, ...(await tokenHandoff(env)) }),
  });
  const snap = await res.json();
  return json({ ok: true, ...snap });
}

/**
 * Status check made on the browser-request path: ask N-Genius from this Worker isolate and hand the result
 * to the desk object. If this path fails, the desk object falls back to asking the gateway itself.
 */
async function checkFromWorker(env, stub) {
  let payload = { ...(await tokenHandoff(env)) };
  try {
    const snap = await stub.fetch('https://desk/state').then(r => r.json());
    const cur = snap.current;
    if (cur && cur.status === 'waiting') {
      const order = await getOrder(env, cur.outletRef, cur.orderRef);
      payload = { ...payload, orderRef: cur.orderRef, summary: summarize(order) };
    }
  } catch (err) {
    payload.clientFailed = true;
    payload.clientError = String(err && err.message || err);
  }
  return stub.fetch('https://desk/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
}

/** Get (or reuse) a gateway token in this Worker isolate and package it for the desk object. */
async function tokenHandoff(env) {
  let t = peekToken();
  if (!t) { try { await getToken(env); t = peekToken(); } catch { t = null; } }
  return t ? { gatewayToken: t.token, gatewayTokenExp: t.exp } : {};
}

async function handleThanks(url, env, cancelled, codeFromPath) {
  const ref = url.searchParams.get('ref') || '';
  const code = (codeFromPath || url.searchParams.get('o') || '').toUpperCase();
  let outcome = cancelled ? 'cancelled' : 'unknown';
  let amountText = '';
  if (!cancelled && ref) {
    const outlet = outletList(env).find(o => o.code === code);
    const candidates = outlet ? [outlet] : outletList(env);
    for (const o of candidates) {
      try {
        const order = await getOrder(env, o.ref, ref);
        const s = summarize(order);
        outcome = s.paid ? 'paid' : (s.lastFailed ? 'failed' : 'pending');
        if (s.amount) amountText = `${s.amount.currencyCode} ${(Number(s.amount.value) / 100).toFixed(2)}`;
        break;
      } catch { /* try the next outlet */ }
    }
  }
  const copy = {
    paid: ['Payment received', 'Thank you — you can close this page.', 'ok', '✓'],
    pending: ['Almost there', 'We are confirming your payment. Please check with the desk.', 'warn', '…'],
    failed: ['Payment not completed', 'The card was not accepted. Please try again at the desk.', 'bad', '!'],
    cancelled: ['Payment cancelled', 'No charge was made. Please return to the desk.', 'bad', '×'],
    unknown: ['Thank you', 'Please check with the desk if you need a receipt.', 'ok', '✓'],
  }[outcome];
  return html(fill(thanksHtml, { BRAND: brand(env), APP_NAME: appName(env), TITLE: copy[0], MESSAGE: copy[1], TONE: copy[2], ICON: copy[3], AMOUNT: amountText }));
}

// =====================================================================
// Login & sessions (HMAC-signed cookie, no database)
// =====================================================================
async function handleLogin(request, env) {
  const form = await request.formData().catch(() => null);
  const username = form ? String(form.get('username') || '').trim() : '';
  const password = form ? String(form.get('password') || '') : '';
  const users = parseUsers(env.APP_USERS || '');

  const ok = username && users.has(username) && (await safeEqual(users.get(username), password));
  if (!ok) {
    await sleep(600); // slow down guessing
    return html(fill(loginHtml, { ERROR: 'Wrong username or password', BRAND: brand(env), APP_NAME: appName(env) }), 401);
  }
  const days = Number(env.SESSION_DAYS) || 30;
  const exp = Date.now() + days * 86_400_000;
  const token = await signSession({ u: username, exp }, env);
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${days * 86_400}`,
    },
  });
}

function parseUsers(raw) {
  const map = new Map();
  raw = raw.trim();
  if (!raw) return map;
  if (raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw);
      for (const [u, p] of Object.entries(obj)) map.set(String(u).trim(), String(p));
      return map;
    } catch { /* fall through to simple format */ }
  }
  for (const part of raw.split(/[,\n;]+/)) {
    const i = part.indexOf(':');
    if (i > 0) map.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return map;
}

async function currentUser(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (!m) return null;
  const data = await verifySession(m[1], env);
  if (!data || !data.u || data.exp < Date.now()) return null;
  if (!parseUsers(env.APP_USERS || '').has(data.u)) return null; // removed users lose access immediately
  return data.u;
}

async function signSession(payload, env) {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmac(body, env);
  return `${body}.${sig}`;
}

async function verifySession(token, env) {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = await hmac(body, env);
  if (!(await safeEqual(expected, sig))) return null;
  try { return JSON.parse(new TextDecoder().decode(b64urlDecode(body))); } catch { return null; }
}

async function hmac(text, env) {
  const secret = env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET secret is not set');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return b64url(new Uint8Array(sig));
}

async function displayKeyOk(key, env) {
  if (!env.DISPLAY_KEY || !key) return false;
  return safeEqual(env.DISPLAY_KEY, key);
}

async function safeEqual(a, b) {
  const ea = new TextEncoder().encode(String(a));
  const eb = new TextEncoder().encode(String(b));
  if (ea.length !== eb.length) {
    // still do a comparison of equal length so timing does not leak length trivially
    await crypto.subtle.digest('SHA-256', ea);
    return false;
  }
  if (typeof crypto.subtle.timingSafeEqual === 'function') return crypto.subtle.timingSafeEqual(ea, eb);
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

function clearCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function sameOrigin(request, url) {
  const origin = request.headers.get('Origin');
  if (!origin) return true; // same-origin fetches without Origin are fine; browsers send it on cross-site POSTs
  return origin === url.origin;
}

// =====================================================================
// Config helpers
// =====================================================================
function outletList(env) {
  try {
    const list = typeof env.OUTLETS === 'string' ? JSON.parse(env.OUTLETS) : (env.OUTLETS || []);
    return list.filter(o => o && o.code && o.ref && o.currency).map(o => ({ ...o, code: String(o.code).toUpperCase() }));
  } catch {
    return [];
  }
}
function deskList(env) {
  return String(env.DESKS || 'desk-1').split(/[,\s]+/).map(s => s.trim().toLowerCase()).filter(s => DESK_RE.test(s));
}
function deskStub(env, desk) {
  return env.DESK.get(env.DESK.idFromName(desk));
}
function brand(env) { return env.BRAND || 'MVRK'; }
function appName(env) { return env.APP_NAME || `${brand(env)} Pay`; }
function maxAmount(env) { return Number(env.MAX_AMOUNT) || 50000; }

function makeQrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  // scalable: true -> viewBox only, so CSS decides the size.
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}

// =====================================================================
// Small utils
// =====================================================================
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'SAMEORIGIN',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
function redirect(to) { return new Response(null, { status: 302, headers: { Location: to } }); }
function fill(tpl, vars) {
  // Values are HTML-escaped, except keys ending in _HTML, which carry markup we generated ourselves (QR SVGs).
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? (k.endsWith('_HTML') ? String(vars[k]) : escapeHtml(String(vars[k]))) : ''));
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function displayErrorPage(env, msg) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(appName(env))} display</title><body style="font-family:system-ui;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;height:100vh;margin:0;text-align:center;padding:24px"><div><div style="font-size:14px;letter-spacing:.2em;opacity:.6;margin-bottom:12px">${escapeHtml(brand(env))}</div><div style="font-size:22px;max-width:520px">${escapeHtml(msg)}</div></div></body>`;
}
function rand(n) {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return Array.from(a, b => (b % 36).toString(36)).join('');
}
function b64url(bytes) {
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
  const bin = atob(s); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function trimDetail(body) {
  if (!body) return undefined;
  const s = typeof body === 'string' ? body : JSON.stringify(body);
  return s.length > 600 ? s.slice(0, 600) + '…' : s;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
