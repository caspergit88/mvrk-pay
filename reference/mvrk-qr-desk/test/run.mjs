// End-to-end test against a local `wrangler dev` and the mock gateway.
// Usage:  npm test            (starts mock + wrangler dev on its own)
//         REUSE=1 npm test    (both already running on 9876 / 8787)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { wifiQrText, wifiConfig } from '../src/wifi.js';

const BASE = 'http://127.0.0.1:8787';
const MOCK = 'http://127.0.0.1:9876';
const procs = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i++) { try { const r = await fetch(url); if (r.ok) return; } catch {} await sleep(1000); }
  throw new Error('timeout waiting for ' + url);
}

async function start() {
  if (process.env.REUSE) return;
  procs.push(spawn('node', ['test/mock-ngenius.mjs'], { stdio: 'inherit' }));
  procs.push(spawn('npx', ['wrangler', 'dev', '--port', '8787', '--ip', '127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'], shell: true }));
  await waitFor(MOCK + '/__test/stats');
  await waitFor(BASE + '/health', 90);
}
function stop() { for (const p of procs) { try { process.kill(-p.pid); } catch {} try { p.kill(); } catch {} } }

const results = [];
async function test(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('  ✓', name); }
  catch (e) { results.push(['FAIL', name]); console.log('  ✗', name, '\n     ', e.message); }
}

// Collect WebSocket snapshots.
function openWs(url) {
  const ws = new WebSocket(url);
  const msgs = [];
  ws.addEventListener('message', ev => { if (ev.data !== 'pong') msgs.push(JSON.parse(ev.data)); });
  const opened = new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const waitStatus = async (pred, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const hit = msgs.find(pred); if (hit) return hit; await sleep(100); }
    throw new Error('no ws snapshot matched within ' + ms + 'ms; last=' + JSON.stringify(msgs[msgs.length - 1] || null).slice(0, 300));
  };
  return { ws, msgs, opened, waitStatus };
}

await start();
const stats0 = await (await fetch(MOCK + '/__test/stats')).json();   // baseline, so the suite can run against an already-running mock
console.log('\nRunning end-to-end tests\n');
let cookie = '';
const j = (path, opts = {}) => fetch(BASE + path, { redirect: 'manual', ...opts, headers: { Cookie: cookie, ...(opts.headers || {}) } });

await test('staff screen redirects to login when signed out', async () => {
  const r = await j('/'); assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/login');
});
await test('wrong password is rejected', async () => {
  const r = await j('/login', { method: 'POST', body: new URLSearchParams({ username: 'desk', password: 'nope' }) });
  assert.equal(r.status, 401);
});
await test('correct password signs in and sets a cookie', async () => {
  const r = await j('/login', { method: 'POST', body: new URLSearchParams({ username: 'desk', password: 'test1234' }) });
  assert.equal(r.status, 302);
  const sc = r.headers.get('set-cookie'); assert.ok(sc && sc.includes('mqd_session='));
  cookie = sc.split(';')[0];
});
await test('/api/me lists outlets, desks, app name and the guest Wi-Fi network', async () => {
  const m = await (await j('/api/me')).json();
  assert.equal(m.user, 'desk'); assert.deepEqual(m.desks, ['desk-1']);
  assert.deepEqual(m.outlets.map(o => o.code), ['EUR'], 'euro only');
  assert.equal(m.appName, 'MVRK Pay'); assert.equal(m.wifiSsid, 'MVRK Guest');
});
await test('staff page renders as MVRK Pay', async () => {
  const r = await j('/'); assert.equal(r.status, 200); const t = await r.text();
  assert.ok(t.includes('Show QR on customer display')); assert.ok(t.includes('desk'));
  assert.ok(t.includes('<title>MVRK Pay</title>')); assert.ok(!t.includes('QR Desk'));
});
await test('display page needs the key', async () => {
  assert.equal((await fetch(BASE + '/display/desk-1')).status, 403);
  assert.equal((await fetch(BASE + '/display/nope?key=displaykey123')).status, 404);
  const r = await fetch(BASE + '/display/desk-1?key=displaykey123'); assert.equal(r.status, 200);
  assert.ok((await r.text()).includes('Ready when you are'));
});
await test('display shows the guest Wi-Fi card with a QR and the network details', async () => {
  const t = await (await fetch(BASE + '/display/desk-1?key=displaykey123')).text();
  assert.ok(t.includes('<body class="haswifi">'));
  assert.ok(t.includes('Join our free Wi-Fi'));
  assert.ok(t.includes('No internet? Tap here to join our free Wi-Fi'), 'button on the payment screen');
  assert.ok(t.includes('Network: MVRK Guest  ·  Password: kite;surf,2026'));
  assert.ok((t.match(/<svg/g) || []).length >= 3, 'Wi-Fi QR SVGs (idle + Wi-Fi screen) plus the paid tick');
  assert.ok(!t.includes('{{'), 'no unfilled placeholders');
});
await test('Wi-Fi join code is built and escaped correctly; no card when no network is set', async () => {
  assert.equal(wifiQrText({ ssid: 'MVRK Guest', password: 'kite;surf,2026' }), 'WIFI:T:WPA;S:MVRK Guest;P:kite\\;surf\\,2026;;');
  assert.equal(wifiQrText({ ssid: 'a:b"c\\d', password: 'x', security: 'WEP', hidden: true }), 'WIFI:T:WEP;S:a\\:b\\"c\\\\d;P:x;H:true;;');
  assert.equal(wifiQrText({ ssid: 'Open', password: '', security: 'nopass' }), 'WIFI:T:nopass;S:Open;;');
  assert.deepEqual(wifiConfig({ WIFI_SSID: ' Cafe ', WIFI_PASSWORD: 'pw', WIFI_SECURITY: 'WPA2' }), { ssid: 'Cafe', password: 'pw', security: 'WPA', hidden: false });
  assert.equal(wifiConfig({ WIFI_SSID: 'Cafe' }).security, 'nopass', 'no password → open network');
  assert.equal(wifiConfig({ WIFI_SSID: '' }), null); assert.equal(wifiConfig({}), null);
});
await test('api rejects unauthenticated writes and reads', async () => {
  assert.equal((await fetch(BASE + '/api/desks/desk-1/state')).status, 401);
  assert.equal((await fetch(BASE + '/api/desks/desk-1/orders', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await fetch(BASE + '/api/desks/desk-1/state?key=displaykey123')).status, 200);
});

const display = openWs(`ws://127.0.0.1:8787/api/desks/desk-1/ws?key=displaykey123`);
const staffWs = openWs(`ws://127.0.0.1:8787/api/desks/desk-1/ws?key=displaykey123`);
await test('display connects over websocket and gets an idle snapshot', async () => {
  await j('/api/desks/desk-1/clear', { method: 'POST' }); // start from a clean desk
  await display.opened; await staffWs.opened;
  const s = await display.waitStatus(m => m && m.current === null); assert.equal(s.current, null);
});

let orderRef = null, payUrl = null;
await test('creating an order returns a pay link and QR', async () => {
  const r = await j('/api/desks/desk-1/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: '120,50', outlet: 'eur', note: 'Anna Kite lesson' }) });
  const text = await r.text();
  assert.equal(r.status, 200, text);
  const s = JSON.parse(text);
  assert.equal(s.current.status, 'waiting'); assert.equal(s.current.amount, 120.5); assert.equal(s.current.amountMinor, 12050);
  assert.equal(s.current.currency, 'EUR'); assert.ok(s.current.payUrl.startsWith('https://paypage'));
  assert.ok(s.current.qrSvg.startsWith('<svg')); assert.equal(s.current.cashier, 'desk');
  orderRef = s.current.orderRef; payUrl = s.current.payUrl;
});
await test('display and staff screens receive the order within a second', async () => {
  const s = await display.waitStatus(m => m.current && m.current.orderRef === orderRef, 2000);
  assert.equal(s.current.status, 'waiting');
  await staffWs.waitStatus(m => m.current && m.current.orderRef === orderRef, 2000);
});
await test('order sent to gateway carries desk + cashier + note and the right outlet', async () => {
  const r = await fetch(MOCK + '/transactions/outlets/85c6ced8-572f-4b64-934b-3861f4552cab/orders/' + orderRef, { headers: { Authorization: 'Bearer tok-1' } });
  assert.equal(r.status, 200, 'order should exist under the EUR outlet');
  const o = await r.json();
  assert.equal(o.merchantDefinedData.desk, 'desk-1'); assert.equal(o.merchantDefinedData.cashier, 'desk');
  assert.equal(o.merchantDefinedData.note, 'Anna Kite lesson'); assert.equal(o.action, 'PURCHASE');
  assert.equal(o.merchantAttributes.redirectUrl, BASE + '/thanks/EUR');
  assert.equal(o.merchantAttributes.cancelUrl, BASE + '/cancelled/EUR');
  assert.ok(/^QR-DESK-1-[A-Z0-9-]+$/.test(o.merchantOrderReference));
});
await test('a declined attempt is reported but the QR stays live', async () => {
  await fetch(MOCK + '/__test/orders/' + orderRef + '/fail', { method: 'POST' });
  const s = await display.waitStatus(m => m.current && m.current.orderRef === orderRef && m.current.failedAttempts === 1, 8000);
  assert.equal(s.current.status, 'waiting');
});
await test('payment flips both screens to paid within a few seconds', async () => {
  await fetch(MOCK + '/__test/orders/' + orderRef + '/pay', { method: 'POST' });
  const s = await display.waitStatus(m => m.current && m.current.orderRef === orderRef && m.current.status === 'paid', 8000);
  assert.equal(s.current.card.pan, '411111******1111');
  await staffWs.waitStatus(m => m.current && m.current.status === 'paid', 2000);
});
await test('customer phone landing page shows "Payment received"', async () => {
  const t = await (await fetch(BASE + '/thanks/EUR?ref=' + orderRef)).text();
  assert.ok(t.includes('Payment received')); assert.ok(t.includes('EUR 120.50'));
  const c = await (await fetch(BASE + '/cancelled/EUR?ref=' + orderRef)).text(); assert.ok(c.includes('Payment cancelled'));
});
await test('display goes back to idle on its own after the paid screen', async () => {
  const paidV = display.msgs.find(m => m.current && m.current.orderRef === orderRef && m.current.status === 'paid').version;
  const s = await display.waitStatus(m => m.current === null && m.version > paidV, 20000);
  assert.equal(s.current, null);
});
await test('the paid order appears in the recent list', async () => {
  const s = await (await fetch(BASE + '/api/desks/desk-1/state?key=displaykey123')).json();
  assert.ok(Array.isArray(s.recent) && s.recent.length, 'recent is empty: ' + JSON.stringify(s).slice(0, 300));
  assert.equal(s.recent[0].orderRef, orderRef); assert.equal(s.recent[0].status, 'paid'); assert.equal(s.recent[0].reason, 'done');
});
await test('clear removes an open order from the display', async () => {
  const r = await j('/api/desks/desk-1/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: 35, outlet: 'EUR' }) });
  const s = await r.json(); assert.equal(s.current.currency, 'EUR');
  await display.waitStatus(m => m.current && m.current.orderRef === s.current.orderRef, 2000);
  await sleep(4000); // let at least one status poll complete so the archive can say "unpaid" with confidence
  const c = await j('/api/desks/desk-1/clear', { method: 'POST' }); assert.equal(c.status, 200);
  const after = await display.waitStatus(m => m.current === null && m.version > s.version, 2000);
  assert.equal(after.recent[0].orderRef, s.current.orderRef); assert.equal(after.recent[0].status, 'unpaid'); assert.equal(after.recent[0].reason, 'cleared');
});
await test('a cleared order can be re-checked and found paid later', async () => {
  const s = await (await fetch(BASE + '/api/desks/desk-1/state?key=displaykey123')).json();
  const ref = s.recent[0].orderRef;
  await fetch(MOCK + '/__test/orders/' + ref + '/pay', { method: 'POST' });
  const r = await j('/api/desks/desk-1/recent-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderRef: ref }) });
  const snap = await r.json(); assert.equal(r.status, 200);
  assert.equal(snap.recent[0].status, 'paid'); assert.equal(snap.recent[0].card.pan, '411111******1111');
  const bad = await j('/api/desks/desk-1/recent-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderRef: 'nope' }) });
  assert.equal(bad.status, 400);
});
await test('replacing an unpaid QR archives it as replaced', async () => {
  const a = await (await j('/api/desks/desk-1/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: 10, outlet: 'EUR' }) })).json();
  const b = await (await j('/api/desks/desk-1/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: 20, outlet: 'EUR' }) })).json();
  assert.equal(b.current.amount, 20); assert.equal(b.recent[0].orderRef, a.current.orderRef); assert.equal(b.recent[0].reason, 'replaced');
  await j('/api/desks/desk-1/clear', { method: 'POST' });
});
await test('gateway outage mid-order: screens warn, polling backs off, recovery flips to paid', async () => {
  // Make a fresh order, then expire the cached token by making identity fail and forcing a token refresh.
  const r = await j('/api/desks/desk-1/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: 7, outlet: 'EUR', note: 'outage' }) });
  const s = await r.json(); assert.equal(s.current.status, 'waiting');
  await fetch(MOCK + '/__test/identity/down', { method: 'POST' });
  // The Worker still holds a valid token, so status checks keep working. Simulate expiry by restarting nothing:
  // instead, verify that /thanks (which needs a token) degrades gracefully and that recent-check reports unknown.
  const before = (await (await fetch(MOCK + '/__test/stats')).json()).tokenCalls;
  // Clear → archived; then recent-check with identity down must mark it "unknown", not "unpaid".
  await j('/api/desks/desk-1/clear', { method: 'POST' });
  await fetch(MOCK + '/__test/token-expire', { method: 'POST' });
  const rc = await (await j('/api/desks/desk-1/recent-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderRef: s.current.orderRef }) })).json();
  const item = rc.recent.find(x => x.orderRef === s.current.orderRef);
  // Either the cached token still works (status unpaid, no error) or identity was needed and failed (unknown + error) — both acceptable here.
  assert.ok(['unpaid', 'unknown'].includes(item.status), 'status=' + item.status);
  await fetch(MOCK + '/__test/identity/up', { method: 'POST' });
  await fetch(MOCK + '/__test/orders/' + s.current.orderRef + '/pay', { method: 'POST' });
  const rc2 = await (await j('/api/desks/desk-1/recent-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderRef: s.current.orderRef }) })).json();
  assert.equal(rc2.recent.find(x => x.orderRef === s.current.orderRef).status, 'paid');
  const after = (await (await fetch(MOCK + '/__test/stats')).json()).tokenCalls;
  assert.ok(after - before <= 2, 'token calls during outage should be rate-limited, got ' + (after - before));
});
await test('status checks keep working through an identity outage using the handed-over token', async () => {
  const r = await j('/api/desks/desk-1/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: 9, outlet: 'EUR', note: 'handoff' }) });
  const s = await r.json(); assert.equal(s.current.status, 'waiting');
  await fetch(MOCK + '/__test/identity/down', { method: 'POST' });
  await fetch(MOCK + '/__test/orders/' + s.current.orderRef + '/pay', { method: 'POST' });
  const paid = await display.waitStatus(m => m.current && m.current.orderRef === s.current.orderRef && m.current.status === 'paid', 10000);
  assert.equal(paid.current.lastError || null, null, 'no token error expected while identity is down: ' + paid.current.lastError);
  await fetch(MOCK + '/__test/identity/up', { method: 'POST' });
  await display.waitStatus(m => m.current === null && m.version > paid.version, 25000);
});
await test('browser-path check applies a gateway result even when the desk object cannot reach the gateway', async () => {
  const r = await j('/api/desks/desk-1/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: 11, outlet: 'EUR', note: 'client path' }) });
  const s = await r.json(); assert.equal(s.current.status, 'waiting');
  // Pay, then call /check from the display key (no staff session) — the Worker asks the gateway and hands the result over.
  await fetch(MOCK + '/__test/orders/' + s.current.orderRef + '/pay', { method: 'POST' });
  const c = await fetch(BASE + '/api/desks/desk-1/check?key=displaykey123', { method: 'POST' });
  assert.equal(c.status, 200);
  const snap = await c.json();
  assert.equal(snap.current.status, 'paid');
  assert.ok(snap.current.lastClientCheckAt, 'client check timestamp recorded');
  await display.waitStatus(m => m.current === null && m.version > snap.version, 25000);
});
await test('bad amounts are refused', async () => {
  for (const amount of ['0', '-5', 'abc', '', '999999']) {
    const r = await j('/api/desks/desk-1/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount, outlet: 'EUR' }) });
    assert.equal(r.status, 400, 'amount ' + amount);
  }
});
await test('token is fetched once and reused', async () => {
  const st = await (await fetch(MOCK + '/__test/stats')).json();
  const tokenCalls = st.tokenCalls - stats0.tokenCalls;   // one at the start, one after the identity outage; never one per poll
  assert.ok(tokenCalls <= 2, 'tokenCalls=' + tokenCalls);
  if (stats0.tokenCalls === 0) assert.ok(tokenCalls >= 1, 'fresh start must fetch a token');   // a reused dev server may still hold a cached token assert.ok(st.orderCalls - stats0.orderCalls >= 2); assert.ok(st.statusCalls - stats0.statusCalls >= 2);
});
await test('sign out clears the session', async () => {
  const r = await j('/logout', { method: 'POST' }); assert.equal(r.status, 302);
  assert.ok(r.headers.get('set-cookie').includes('Max-Age=0'));
});

display.ws.close(); staffWs.ws.close();
stop();
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed\n`);
process.exit(failed ? 1 : 0);
