import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Nav } from '@/components/Nav'

export const metadata: Metadata = {
  title: 'Finapp — Cross-border Finance Assistant',
  description: 'Reads your bank emails to spot shortfalls before your bank does. USD + INR, no bank login required.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Finapp',
    statusBarStyle: 'default',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f5f8' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0f' },
  ],
}

import { StarsBackground } from '@/components/ui/stars'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
        />
      </head>
      <body>
        <StarsBackground>
          <Nav />
          <main className="app-shell">{children}</main>
        </StarsBackground>
      </body>
    </html>
  )
}
