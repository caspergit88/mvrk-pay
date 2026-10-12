import type { Metadata, Viewport } from 'next'
import { Public_Sans, Spectral } from 'next/font/google'
import './globals.css'

// Same two faces as the weddings app: Spectral for headings, Public Sans for
// everything else. The customer display uses the system stack instead, for
// crisp large numerals at a distance.
const display = Spectral({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-display-face',
  display: 'swap',
})

const body = Public_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'MVRK Pay',
  description: 'Card payments at the desk for MVRK reception teams',
  manifest: '/manifest.webmanifest',
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#172136' }

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">{children}</body>
    </html>
  )
}
