// A tiny stand-in for the N-Genius gateway, used by `npm test`.
// Implements: POST /identity/auth/access-token, POST/GET /transactions/outlets/:o/orders[/:ref]
// plus a test-only hook: POST /__test/orders/:ref/pay   or   /__test/orders/:ref/fail
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.MOCK_PORT || 9876);
const orders = new Map();
let tokenCalls = 0, orderCalls = 0, statusCalls = 0, identityDown = false;

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
function readJson(req) {
  return new Promise(resolve => { let d = ''; req.on('data', c => d += c); req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } }); });
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (p === '/identity/auth/access-token' && req.method === 'POST') {
    tokenCalls++;
    if (identityDown) { res.writeHead(403, { 'Content-Type': 'text/html' }); return res.end('<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD></HTML>'); }
    if (req.headers.authorization !== 'Basic TESTKEY') return send(res, 401, { error: 'bad key' });
    return send(res, 200, { access_token: 'tok-' + tokenCalls, expires_in: 300, token_type: 'bearer' });
  }

  let m = p.match(/^\/transactions\/outlets\/([^/]+)\/orders$/);
  if (m && req.method === 'POST') {
    orderCalls++;
    if (req.headers.authorization !== 'Bearer tok-' + tokenCalls) return send(res, 401, { error: 'bad token' });
    const body = await readJson(req);
    if (!body.amount || !body.amount.value) return send(res, 400, { errors: [{ message: 'amount required' }] });
    const ref = randomUUID();
    const order = {
      _id: 'urn:order:' + ref, reference: ref, outletId: m[1], action: body.action, amount: body.amount,
      merchantOrderReference: body.merchantOrderReference, merchantDefinedData: body.merchantDefinedData || {},
      emailAddress: body.emailAddress, merchantAttributes: body.merchantAttributes,
      _links: { payment: { href: 'https://paypage.sandbox.ngenius-payments.com/?code=' + ref.slice(0, 16) }, self: { href: 'http://x' + p + '/' + ref } },
      _embedded: { payment: [{ reference: randomUUID(), state: 'STARTED', amount: body.amount }] },
    };
    orders.set(ref, order);
    return send(res, 201, order);
  }

  m = p.match(/^\/transactions\/outlets\/([^/]+)\/orders\/([^/]+)$/);
  if (m && req.method === 'GET') {
    statusCalls++;
    const o = orders.get(m[2]);
    if (!o || o.outletId !== m[1]) return send(res, 404, { errors: [{ message: 'not found' }] });
    return send(res, 200, o);
  }

  m = p.match(/^\/__test\/orders\/([^/]+)\/(pay|fail)$/);
  if (m) {
    const o = orders.get(m[1]);
    if (!o) return send(res, 404, {});
    const pm = { reference: randomUUID(), amount: o.amount, paymentMethod: { name: 'VISA', pan: '411111******1111', cardholderName: 'Test' } };
    if (m[2] === 'pay') o._embedded.payment.push({ ...pm, state: 'PURCHASED' });
    else o._embedded.payment.push({ ...pm, state: 'FAILED' });
    return send(res, 200, { ok: true });
  }
  if (p === '/__test/stats') return send(res, 200, { tokenCalls, orderCalls, statusCalls, orders: orders.size, identityDown });
  if (p === '/__test/identity/down') { identityDown = true; return send(res, 200, { identityDown }); }
  if (p === '/__test/identity/up') { identityDown = false; return send(res, 200, { identityDown }); }
  if (p === '/__test/token-expire') { return send(res, 200, { ok: true }); }

  send(res, 404, { error: 'mock: no route ' + req.method + ' ' + p });
}).listen(PORT, '127.0.0.1', () => console.log('mock n-genius on http://127.0.0.1:' + PORT));
