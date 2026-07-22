'use client';

import { BrandingProvider, useBranding } from '@/contexts/BrandingContext';
import { ThemeProvider } from '@/contexts/ThemeContext';

/** Applies the tenant's dark-mode policy from branding to the theme provider.
 * Mirrors dashboard/layout.tsx's ThemeGate so /hub (the post-login landing
 * page, reached both by direct URL/refresh and by client navigation) honors
 * the same persisted/tenant-forced theme as the rest of the app instead of
 * always rendering light. Safe for super-admins with no tenant context too —
 * BrandingProvider falls back to defaults if /branding/me isn't applicable. */
function ThemeGate({ children }: { children: React.ReactNode }) {
  const { branding } = useBranding();
  return <ThemeProvider themeConfig={branding}>{children}</ThemeProvider>;
}

export default function HubLayout({ children }: { children: React.ReactNode }) {
  return (
    <BrandingProvider>
      <ThemeGate>{children}</ThemeGate>
    </BrandingProvider>
  );
}
