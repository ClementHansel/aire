'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '@/lib/api';
import {
  applyBrandingCss,
  DEFAULT_BRANDING,
  normalizeBrandingConfig,
  type BrandingConfig,
} from '@/lib/color-utils';

export interface PublicBranding {
  company_name: string;
  legal_name: string;
  logo_url: string | null;
  branding: BrandingConfig | null;
  tenant_code?: string | null;
}

interface BrandingContextValue {
  companyName: string;
  legalName: string;
  logoUrl: string | null;
  branding: BrandingConfig;
  tenantCode: string;
  isLoading: boolean;
  refreshBranding: () => Promise<void>;
}

const BrandingContext = createContext<BrandingContextValue | undefined>(undefined);

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<PublicBranding | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshBranding = useCallback(async () => {
    try {
      const branding = await api.get<PublicBranding>('/branding/me');
      setData(branding);
      applyBrandingCss(normalizeBrandingConfig(branding.branding || DEFAULT_BRANDING));
    } catch {
      applyBrandingCss(DEFAULT_BRANDING);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshBranding();
  }, [refreshBranding]);

  const value = useMemo<BrandingContextValue>(() => {
    const branding = normalizeBrandingConfig(data?.branding);
    return {
      companyName: data?.company_name || 'Airin',
      legalName: data?.legal_name || '',
      logoUrl: data?.logo_url || null,
      branding,
      tenantCode: data?.tenant_code || '',
      isLoading,
      refreshBranding,
    };
  }, [data, isLoading, refreshBranding]);

  return (
    <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>
  );
}

export function useBranding(): BrandingContextValue {
  const ctx = useContext(BrandingContext);
  if (!ctx) throw new Error('useBranding must be used within BrandingProvider');
  return ctx;
}
