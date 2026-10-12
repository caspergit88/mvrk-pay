#!/usr/bin/env node
// Interactive helper: sets the four secrets the Worker needs, using `wrangler secret put`.
// Run with:  npm run secrets      (after `npx wrangler login`)
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { randomBytes } from 'node:crypto';

const rl = createInterface({ input: stdin, output: stdout });
const ask = async (q, def) => { const a = (await rl.question(def ? `${q} [${def}]: ` : `${q}: `)).trim(); return a || def || ''; };
const put = (name, value) => {
  const r = spawnSync('npx', ['wrangler', 'secret', 'put', name], { input: value + '\n', stdio: ['pipe', 'inherit', 'inherit'], shell: true });
  if (r.status !== 0) { console.error(`\n✗ Failed to set ${name}`); process.exit(1); }
  console.log(`✓ ${name} set`);
};

console.log('\nMVRK Pay — secrets setup\n');
console.log('1) N-Genius API key: portal → Settings → Integrations → Service account → New (type: Merchant Service Account).');
const apiKey = await ask('   Paste the API key');
if (!apiKey) { console.error('API key is required.'); process.exit(1); }

console.log('\n2) Staff logins, as  username:password  pairs separated by commas (e.g. desk:Kite2026!,david:Secret1).');
const users = await ask('   Users');
if (!users.includes(':')) { console.error('At least one user:password pair is required.'); process.exit(1); }

const displayKey = randomBytes(12).toString('base64url');
const sessionSecret = randomBytes(32).toString('base64url');
console.log(`\n3) Display key (auto-generated, goes in the iPad link): ${displayKey}`);
console.log('4) Session secret (auto-generated).\n');

rl.close();
put('NGENIUS_API_KEY', apiKey);
put('APP_USERS', users);
put('DISPLAY_KEY', displayKey);
put('SESSION_SECRET', sessionSecret);
console.log('\nAll secrets set. Now run:  npx wrangler deploy\n');
