import type { Metadata } from 'next';
import { Geist, JetBrains_Mono } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import { LanguageProvider } from '@/lib/i18n';
import PovBanner from '@/components/PovBanner';

// Sets the `dark` class on <html> from localStorage *before* React hydrates,
// so the very first paint already matches the persisted theme (no light→dark
// flash) and the server/client hydration pass agree (no React #418). Any
// ThemeProvider on the page reconciles its own state against this right
// after mount — see contexts/ThemeContext.tsx.
const THEME_INIT_SCRIPT = `
  try {
    var t = localStorage.getItem('aire-theme');
    if (t === 'dark' || t === 'light') document.documentElement.classList.add(t);
  } catch (e) {}
`;

const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
  weight: ['300', '400', '500', '600', '700', '800', '900'],
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  weight: ['400', '500', '600'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Airin',
  description: 'Multi-tenant POS and operations management for car wash businesses',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the theme-init script below adds a `dark`
    // class to this element before React hydrates, which is an intentional,
    // expected mismatch with the server-rendered markup — not a bug to warn
    // about. See THEME_INIT_SCRIPT and contexts/ThemeContext.tsx.
    <html lang="en" className={`${geist.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <body>
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <LanguageProvider>
          {children}
          <PovBanner />
        </LanguageProvider>
      </body>
    </html>
  );
}
