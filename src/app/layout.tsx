import type { Metadata, Viewport } from 'next';
import { Alegreya_Sans, Fraunces, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

/**
 * Fraunces is the display face — SOFT and WONK are what stop it reading as a
 * generic high-contrast serif, so the variable axes are requested explicitly.
 */
const fraunces = Fraunces({
  subsets: ['latin'],
  axes: ['SOFT', 'WONK'],
  variable: '--font-fraunces',
  display: 'swap',
});

const alegreyaSans = Alegreya_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-alegreya-sans',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Steading',
  description: 'Birds, iron, and chores in one place.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Steading', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  // Warm, so browser chrome does not undo the burrow at the top of the screen.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#EDE6D2' },
    { media: '(prefers-color-scheme: dark)', color: '#201913' },
  ],
  // viewportFit=cover so the bottom tab bar can seat against the home indicator.
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
  // Never block zoom: a gloved mis-tap has to stay recoverable.
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${alegreyaSans.variable} ${plexMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
