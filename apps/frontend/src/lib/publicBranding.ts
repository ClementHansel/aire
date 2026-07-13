'use client';

import { useEffect, useState } from 'react';
import { applyBrandingCss, normalizeBrandingConfig, DEFAULT_BRANDING } from '@/lib/color-utils';
import { applyBrandingFonts, normalizeFontConfig } from '@/lib/google-fonts';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

export interface PublicBrand {
  companyName: string;
  logoUrl: string | null;
  /** Human-readable tenant slug — for building pretty public URLs. */
  slug: string | null;
}

/**
 * Fetch a tenant's public branding (no auth) and apply its colors + fonts to the
 * page, so customer-facing surfaces (kiosk, menu, queue board) carry the tenant's
 * brand instead of the generic default. Returns the company name + logo for the
 * header. Safe to call on any public page that knows its tenantId.
 */
export function usePublicBranding(tenantId: string | undefined): PublicBrand {
  const [brand, setBrand] = useState<PublicBrand>({ companyName: '', logoUrl: null, slug: null });
  useEffect(() => {
    if (!tenantId) return;
    const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;
    fetch(`${base}/public/branding?tenantId=${encodeURIComponent(tenantId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (!b) return;
        setBrand({ companyName: b.company_name ?? '', logoUrl: b.logo_url ?? null, slug: b.slug ?? null });
        try {
          const cfg = normalizeBrandingConfig(b.branding || DEFAULT_BRANDING);
          applyBrandingCss(cfg);
          if (cfg.fonts) applyBrandingFonts(normalizeFontConfig(cfg.fonts));
        } catch {
          /* theming is best-effort — never block the page */
        }
      })
      .catch(() => {
        /* branding is optional */
      });
  }, [tenantId]);
  return brand;
}
