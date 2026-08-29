import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import './globals.css'
import { BottomNav } from '../components/bottom-nav'
import { SettingsFloatingButton } from '../components/settings-floating-button'

export const metadata: Metadata = {
  metadataBase: new URL('https://study-with-me-by-kokokao.vercel.app'),
  title: 'study with me · focus softly',
  description: 'A cozy little timer for focused study sessions, gentle breaks, and tiny progress.',
  applicationName: 'Koko.study',
  openGraph: {
    type: 'website',
    url: 'https://study-with-me-by-kokokao.vercel.app',
    siteName: 'Koko.study',
    title: 'Koko.study · focus softly',
    description: 'A cozy little timer for focused study sessions, gentle breaks, and tiny progress.',
    images: [
      {
        url: '/koko-study-cover.png',
        width: 1254,
        height: 1254,
        alt: 'Koko.study mascot — focus softly and grow a little every day',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Koko.study · focus softly',
    description: 'A cozy little timer for focused study sessions, gentle breaks, and tiny progress.',
    images: ['/koko-study-cover.png'],
  },
  icons: {
    icon: [{ url: '/koko-study-cover.png', type: 'image/png' }],
    apple: [{ url: '/koko-study-cover.png', type: 'image/png' }],
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="bg-background">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('study_timer_theme_v2') || 'cozy';
                  document.documentElement.setAttribute('data-theme', theme);
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="antialiased">
        <SettingsFloatingButton />
        {children}
        <BottomNav />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
