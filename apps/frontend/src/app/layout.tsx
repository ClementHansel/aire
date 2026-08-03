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
// Falls back to the cached tenant default ('aire-theme-default', written by
// ThemeProvider once branding loads) when the visitor has never picked a theme
// themselves — otherwise a tenant whose default is dark painted light on every
// first load and only flipped after hydration (Samuel 2026-07-30).
const THEME_INIT_SCRIPT = `
  try {
    var t = localStorage.getItem('aire-theme') || localStorage.getItem('aire-theme-default');
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
// The browser-tab icon is the AIRIN favicon, wired via the app-router file
// convention: src/app/favicon.ico (multi-size 16→256 ICO, built from
// AIRIN-favicon.png) + src/app/apple-icon.png (180px, iOS home screen). Next
// emits the <link> tags itself — deliberately no `metadata.icons` here, since
// that would override the convention.

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
