import qrcode from 'qrcode-generator'

/** A pay-page URL (or a Wi-Fi join string) as a scalable SVG, sized by CSS. */
export function qrSvg(text: string): string {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true })
}

/** The text phones understand as "join this Wi-Fi". Mirrors reference/mvrk-qr-desk/src/wifi.js. */
export function wifiQrText({ ssid, password = '', security = 'WPA', hidden = false }: { ssid: string; password?: string | null; security?: string; hidden?: boolean }): string {
  const esc = (s: string) => s.replace(/([\;,:"])/g, '\\$1')
  let t = (security || 'WPA').toUpperCase()
  if (!password) t = 'nopass'
  if (!['WPA', 'WEP', 'NOPASS'].includes(t)) t = 'WPA'
  if (t === 'NOPASS') t = 'nopass'
  let out = `WIFI:T:${t};S:${esc(ssid)};`
  if (t !== 'nopass') out += `P:${esc(password ?? '')};`
  if (hidden) out += 'H:true;'
  return out + ';'
}
