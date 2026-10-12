// Guest Wi-Fi join code. Phones' camera apps understand this format and offer "Join network" straight away.
// Nothing here talks to the network: it only builds the text that goes into a QR code.

const TYPES = new Set(['WPA', 'WEP', 'nopass']);

/** Settings → config, or null when no network is configured (the display then shows no Wi-Fi card). */
export function wifiConfig(env) {
  const ssid = String(env.WIFI_SSID || '').trim();
  if (!ssid) return null;
  const password = String(env.WIFI_PASSWORD || '');
  let security = String(env.WIFI_SECURITY || 'WPA').trim();
  if (/^wpa/i.test(security)) security = 'WPA';           // WPA, WPA2, WPA3, WPA/WPA2 all encode as WPA
  else if (/^wep$/i.test(security)) security = 'WEP';
  else if (/^(nopass|none|open)$/i.test(security)) security = 'nopass';
  if (!password) security = 'nopass';
  if (!TYPES.has(security)) security = 'WPA';
  const hidden = /^(1|true|yes)$/i.test(String(env.WIFI_HIDDEN || ''));
  return { ssid, password, security, hidden };
}

/** The text encoded in the QR, e.g. WIFI:T:WPA;S:MVRK Guest;P:secret;; */
export function wifiQrText({ ssid, password = '', security = 'WPA', hidden = false }) {
  const esc = s => String(s).replace(/([\\;,:"])/g, '\\$1');
  const t = TYPES.has(security) ? security : 'WPA';
  let out = `WIFI:T:${t};S:${esc(ssid)};`;
  if (t !== 'nopass') out += `P:${esc(password)};`;
  if (hidden) out += 'H:true;';
  return out + ';';
}

/** Human-readable line shown under the Wi-Fi QR for phones that cannot scan it. */
export function wifiDetailsText({ ssid, password, security }) {
  if (security === 'nopass' || !password) return `Network: ${ssid} (no password)`;
  return `Network: ${ssid}  ·  Password: ${password}`;
}
