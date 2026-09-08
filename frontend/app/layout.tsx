import type { Metadata, Viewport } from 'next';
import { DM_Sans, Manrope } from 'next/font/google';
import { Toaster } from '@/components/ui/toast';
import { LargeScreenScale } from './components/large-screen-scale';
import { PwaRegister } from './components/pwa-register';
import './globals.css';
import './movement.css';

const sans = DM_Sans({ variable: '--font-sans-app', subsets: ['latin'] });
const display = Manrope({ variable: '--font-display-app', subsets: ['latin'] });

export const viewport: Viewport = { themeColor: '#176b50' };

export const metadata: Metadata = {
  metadataBase: new URL('http://localhost:3000'),
  title: 'Nutri+ | Acompanhamento nutricional',
  description:
    'Diário alimentar e acompanhamento nutricional para pacientes e profissionais.',
  manifest: '/manifest.webmanifest',
  applicationName: 'Nutri+',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Nutri+' },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icon-180.png', sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    title: 'Nutri+ | Acompanhamento nutricional',
    description: 'Nutrição mais clara. Cuidado mais próximo.',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'Nutri+ - Nutrição mais clara. Cuidado mais próximo.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Nutri+ | Acompanhamento nutricional',
    description: 'Nutrição mais clara. Cuidado mais próximo.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={`${sans.variable} ${display.variable} antialiased`}>
        <LargeScreenScale />
        <PwaRegister />
        <Toaster>{children}</Toaster>
      </body>
    </html>
  );
}
