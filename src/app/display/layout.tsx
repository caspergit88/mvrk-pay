import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'MVRK Pay',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'MVRK Pay' },
}
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', userScalable: false, themeColor: '#0b1220' }

/** The customer display has no app chrome at all: the screen is the product. */
export default function DisplayLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
