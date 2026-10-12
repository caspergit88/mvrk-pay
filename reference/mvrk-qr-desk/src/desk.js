// One Durable Object per desk. Holds "what is on the customer display right now",
// pushes changes to every connected screen over WebSockets, and polls N-Genius
// for the payment result while an order is open.

import { getOrder, summarize, seedToken } from './ngenius.js';

const POLL_MS = 3000;                 // how often to ask N-Genius while waiting
const ERROR_POLL_MS = 15_000;         // poll interval while N-Genius status checks are failing
const CLIENT_CHECK_FRESH_MS = 8_000;  // a browser-path check this recent makes the alarm skip its own fetch
const PAID_HOLD_MS = 15_000;          // how long the green "Paid" screen stays before going idle
const EXPIRED_HOLD_MS = 8_000;        // how long "Expired" stays before going idle
const LIVE_STATES = new Set(['waiting']);

export class Desk {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.state = { version: 0, current: null, recent: [] };
    // Reply to "ping" without waking the object (keeps idle iPads connected for free).
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.ctx.blockConcurrencyWhile(async () => {
      const saved = await this.ctx.storage.get('state');
      if (saved) this.state = { recent: [], ...saved };
      const gw = await this.ctx.storage.get('gw');   // gateway token handed over by the Worker (never sent to screens)
      if (gw) seedToken(gw.token, gw.exp);
    });
  }

  /** Accept a gateway token from the Worker so this object rarely has to request its own. */
  async takeToken(body) {
    if (body && body.gatewayToken && body.gatewayTokenExp) {
      seedToken(body.gatewayToken, body.gatewayTokenExp);
      await this.ctx.storage.put('gw', { token: body.gatewayToken, exp: body.gatewayTokenExp });
    }
  }

  // ---------- HTTP entry (only ever called by the Worker, never directly) ----------
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      try { server.send(JSON.stringify(this.snapshot())); } catch {}
      return new Response(null, { status: 101, webSocket: client });
    }

    if (path === '/state') return json(this.snapshot());

    if (path === '/order' && request.method === 'POST') {
      const { gatewayToken, gatewayTokenExp, ...order } = await request.json();
      await this.takeToken({ gatewayToken, gatewayTokenExp });
      this.archiveCurrent('replaced');
      this.state.current = {
        ...order,
        status: 'waiting',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        failedAttempts: 0,
      };
      await this.commit();
      await this.ctx.storage.setAlarm(Date.now() + POLL_MS);
      return json(this.snapshot());
    }

    if (path === '/clear' && request.method === 'POST') {
      this.archiveCurrent('cleared');
      this.state.current = null;
      await this.commit();
      await this.ctx.storage.deleteAlarm();
      return json(this.snapshot());
    }

    if (path === '/check' && request.method === 'POST') {
      const body = await request.json().catch(() => null);
      await this.takeToken(body);
      if (body && body.summary && body.orderRef && this.state.current && this.state.current.orderRef === body.orderRef) {
        await this.applySummary(body.summary, true);          // the Worker already asked the gateway
      } else if (!(body && body.clientFailed)) {
        await this.refreshFromGateway();                       // ask the gateway ourselves
      }
      if (this.state.current && this.state.current.status === 'waiting') await this.ctx.storage.setAlarm(Date.now() + POLL_MS);
      return json(this.snapshot());
    }

    // Re-check one of the recent orders against the gateway (e.g. "did Anna's payment go through?").
    if (path === '/recent-check' && request.method === 'POST') {
      const body = await request.json();
      await this.takeToken(body);
      const { orderRef } = body;
      const item = this.state.recent.find(r => r.orderRef === orderRef);
      if (!item) return json({ ok: false, error: 'Order not in recent list' }, 404);
      try {
        const s = body.summary || summarize(await getOrder(this.env, item.outletRef, item.orderRef));
        item.gatewayState = s.state;
        item.status = s.paid ? 'paid' : (s.lastFailed ? 'failed' : (item.status === 'paid' ? 'paid' : 'unpaid'));
        item.card = s.card || item.card || null;
        item.checkedAt = Date.now();
        item.lastError = null;
      } catch (err) {
        item.lastError = String(err && err.message || err);
        if (item.status === 'unpaid') item.status = 'unknown';
      }
      await this.commit();
      return json(this.snapshot());
    }

    return new Response('Not found', { status: 404 });
  }

  // ---------- WebSocket hibernation hooks ----------
  async webSocketMessage(ws, message) {
    // Clients only ever send "ping" (auto-answered) or "sync".
    if (message === 'sync') {
      try { ws.send(JSON.stringify(this.snapshot())); } catch {}
    }
  }
  async webSocketClose(ws, code, reason, wasClean) {
    try { ws.close(1000, 'bye'); } catch {}
  }
  async webSocketError(ws) {
    try { ws.close(1011, 'error'); } catch {}
  }

  // ---------- Alarm: poll N-Genius while an order is open ----------
  async alarm() {
    const cur = this.state.current;
    if (!cur) return;

    if (cur.status === 'paid') {
      if (Date.now() - (cur.paidAt || cur.updatedAt) >= PAID_HOLD_MS) {
        this.archiveCurrent('done');
        this.state.current = null;
        await this.commit();
      } else {
        await this.ctx.storage.setAlarm(Date.now() + 1000);
      }
      return;
    }
    if (cur.status === 'expired') {
      if (Date.now() - cur.updatedAt >= EXPIRED_HOLD_MS) {
        this.archiveCurrent('expired');
        this.state.current = null;
        await this.commit();
      } else {
        await this.ctx.storage.setAlarm(Date.now() + 1000);
      }
      return;
    }
    if (!LIVE_STATES.has(cur.status)) return;

    const expiryMs = (Number(this.env.ORDER_EXPIRY_MIN) || 20) * 60_000;
    if (Date.now() - cur.createdAt > expiryMs) {
      cur.status = 'expired';
      cur.updatedAt = Date.now();
      await this.commit();
      await this.ctx.storage.setAlarm(Date.now() + 1000);
      return;
    }

    // If a check made on the browser-request path succeeded in the last few seconds, skip our own fetch:
    // that path may be reachable when this object's own network location is being refused by the gateway.
    if (!(cur.lastClientCheckAt && Date.now() - cur.lastClientCheckAt < CLIENT_CHECK_FRESH_MS)) {
      await this.refreshFromGateway();
    }
    const c = this.state.current;
    if (c && c.status === 'waiting') {
      // Poll a little less aggressively after the first few minutes, and much less while the gateway is failing.
      const age = Date.now() - c.createdAt;
      let next = age > 5 * 60_000 ? POLL_MS * 2 : POLL_MS;
      if (c.lastError) next = Math.max(next, ERROR_POLL_MS);
      await this.ctx.storage.setAlarm(Date.now() + next);
    } else {
      await this.ctx.storage.setAlarm(Date.now() + 1000);
    }
  }

  async refreshFromGateway() {
    const cur = this.state.current;
    if (!cur || cur.status !== 'waiting') return;
    try {
      const order = await getOrder(this.env, cur.outletRef, cur.orderRef);
      await this.applySummary(summarize(order), false);
    } catch (err) {
      const msg = String(err && err.message || err);
      const firstError = !cur.lastError;
      cur.lastError = msg;
      cur.lastErrorAt = Date.now();
      // Broadcast the first failure so staff see "status check failing" instead of a silent wait.
      if (firstError) { cur.updatedAt = Date.now(); await this.commit(); }
      else { await this.ctx.storage.put('state', this.state); }
    }
  }

  /** Apply a gateway status summary to the current order (from our own fetch or from the Worker). */
  async applySummary(s, fromClient) {
    const cur = this.state.current;
    if (!cur || cur.status !== 'waiting') return;
    {
      let changed = false;
      if (s.state !== cur.gatewayState) { cur.gatewayState = s.state; changed = true; }
      if (s.failedAttempts !== cur.failedAttempts) { cur.failedAttempts = s.failedAttempts; changed = true; }
      if (s.card && (!cur.card || cur.card.pan !== s.card.pan)) { cur.card = s.card; changed = true; }
      if (s.paid) {
        cur.status = 'paid';
        cur.paidAt = Date.now();
        changed = true;
      }
      cur.lastCheckedAt = Date.now();   // only set on a successful check
      if (fromClient) cur.lastClientCheckAt = Date.now();
      if (cur.lastError) { cur.lastError = null; changed = true; }   // recovered: tell the screens
      if (changed) { cur.updatedAt = Date.now(); await this.commit(); }
      else { await this.ctx.storage.put('state', this.state); }
    }
  }

  // ---------- helpers ----------
  /** Move the current order into the recent list (newest first, max 10). */
  archiveCurrent(reason) {
    const cur = this.state.current;
    if (!cur) return;
    const entry = {
      orderRef: cur.orderRef,
      merchantRef: cur.merchantRef,
      outletRef: cur.outletRef,
      outletCode: cur.outletCode,
      currency: cur.currency,
      amount: cur.amount,
      note: cur.note || '',
      cashier: cur.cashier || '',
      createdAt: cur.createdAt,
      endedAt: Date.now(),
      reason,
      // "unpaid" only if we actually got a clean answer from N-Genius; otherwise "unknown" until re-checked.
      status: cur.status === 'paid' ? 'paid' : (cur.lastError || !cur.lastCheckedAt ? 'unknown' : 'unpaid'),
      gatewayState: cur.gatewayState || 'STARTED',
      card: cur.card || null,
      checkedAt: cur.lastCheckedAt || null,
      lastError: cur.lastError || null,
    };
    this.state.recent = [entry, ...this.state.recent.filter(r => r.orderRef !== entry.orderRef)].slice(0, 10);
  }

  snapshot() {
    return { version: this.state.version, current: this.state.current, recent: this.state.recent, now: Date.now() };
  }

  async commit() {
    this.state.version += 1;
    await this.ctx.storage.put('state', this.state);
    const msg = JSON.stringify(this.snapshot());
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(msg); } catch {}
    }
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
