import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import './globals.css'
import { BottomNav } from '../components/bottom-nav'
import { SettingsFloatingButton } from '../components/settings-floating-button'

const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://koko-study.vercel.app'
const appUrl = /^https?:\/\//i.test(configuredAppUrl)
  ? configuredAppUrl.replace(/\/$/, '')
  : 'https://koko-study.vercel.app'

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: 'Koko.study',
  description: 'A cozy study manager for focused sessions, plans, and progress.',
  applicationName: 'Koko.study',
  openGraph: {
    type: 'website',
    url: appUrl,
    siteName: 'Koko.study',
    title: 'Koko.study',
    description: 'A cozy study manager for focused sessions, plans, and progress.',
    images: [
      {
        url: '/koko-study-cover.png',
        width: 1254,
        height: 1254,
        alt: 'Koko.study study manager mascot',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Koko.study',
    description: 'A cozy study manager for focused sessions, plans, and progress.',
    images: ['/koko-study-cover.png'],
  },
  icons: {
    icon: [{ url: '/koko-study-cover.png', type: 'image/png' }],
    apple: [{ url: '/koko-study-cover.png', type: 'image/png' }],
  },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#fffaf2',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" data-theme="cozy" className="bg-background">
      <body className="antialiased">
        <SettingsFloatingButton />
        {children}
        <BottomNav />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
