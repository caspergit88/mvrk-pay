import type { MetadataRoute } from 'next'

// Lets reception add the staff screen to a phone's Home Screen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MVRK Pay',
    short_name: 'MVRK Pay',
    description: 'Card payments at the desk',
    start_url: '/',
    display: 'standalone',
    background_color: '#172136',
    theme_color: '#172136',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  }
}
