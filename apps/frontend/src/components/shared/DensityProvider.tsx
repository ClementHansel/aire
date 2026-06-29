'use client';

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Density profiles matching task 44.4 / Requirements 45.1–45.6:
 *
 * - compact:   POS interface — spacious feel with 56px+ primary buttons
 * - comfortable: Tenant Dashboard — balanced with 44px+ targets
 * - spacious:  Kiosk / Queue Board — extra-spacious with 64px+ buttons
 */
export type DensityProfile = 'compact' | 'comfortable' | 'spacious';

export interface DensityTokens {
  /** Minimum touch-target size in px */
  touchTarget: number;
  /** Padding unit in px */
  padding: number;
  /** Base font size in px */
  fontSize: number;
  /** Primary button height in px */
  buttonHeight: number;
  /** Input field height in px */
  inputHeight: number;
  /** Icon size in px */
  iconSize: number;
  /** Gap between elements in px */
  gap: number;
  /** Chart label font size in px */
  chartLabelSize: number;
}

export interface DensityContextValue {
  /** Active density profile */
  profile: DensityProfile;
  /** Resolved density tokens */
  tokens: DensityTokens;
}

export interface DensityProviderProps {
  children: ReactNode;
  /** Density profile to use. Defaults to 'compact' (POS). */
  profile?: DensityProfile;
}

// ─── Token Definitions ───────────────────────────────────────────────────────

/**
 * compact (POS):
 * - 56px+ primary buttons, 16px body, 16px padding
 * - Touch-friendly for cashier tablet operation
 */
const compactTokens: DensityTokens = {
  touchTarget: 56,
  padding: 16,
  fontSize: 16,
  buttonHeight: 56,
  inputHeight: 48,
  iconSize: 24,
  gap: 12,
  chartLabelSize: 12,
};

/**
 * comfortable (Tenant Dashboard):
 * - 44px+ targets, 14px body, 12px chart labels
 * - Balanced for management and data review
 */
const comfortableTokens: DensityTokens = {
  touchTarget: 44,
  padding: 12,
  fontSize: 14,
  buttonHeight: 44,
  inputHeight: 40,
  iconSize: 20,
  gap: 8,
  chartLabelSize: 12,
};

/**
 * spacious (Kiosk / Queue Board):
 * - 64px+ buttons, 18px body
 * - High-visibility: 32px+ queue numbers legible at 3m
 * - Extra padding for public-facing touch interfaces
 */
const spaciousTokens: DensityTokens = {
  touchTarget: 64,
  padding: 24,
  fontSize: 18,
  buttonHeight: 64,
  inputHeight: 56,
  iconSize: 32,
  gap: 16,
  chartLabelSize: 14,
};

export const densityProfiles: Record<DensityProfile, DensityTokens> = {
  compact: compactTokens,
  comfortable: comfortableTokens,
  spacious: spaciousTokens,
};

// ─── Context ─────────────────────────────────────────────────────────────────

const DensityContext = createContext<DensityContextValue | undefined>(undefined);

// ─── Provider ────────────────────────────────────────────────────────────────

/**
 * DensityProvider supplies density/sizing tokens to all children.
 *
 * Also injects CSS custom properties so consumers can use them in styles:
 *   --density-touch-target, --density-padding, --density-font-size,
 *   --density-button-height, --density-input-height, --density-icon-size,
 *   --density-gap, --density-chart-label-size
 */
export function DensityProvider({
  children,
  profile = 'compact',
}: DensityProviderProps) {
  const tokens = densityProfiles[profile];

  const value = useMemo<DensityContextValue>(
    () => ({ profile, tokens }),
    [profile, tokens],
  );

  const style = useMemo(
    () =>
      ({
        '--density-touch-target': `${tokens.touchTarget}px`,
        '--density-padding': `${tokens.padding}px`,
        '--density-font-size': `${tokens.fontSize}px`,
        '--density-button-height': `${tokens.buttonHeight}px`,
        '--density-input-height': `${tokens.inputHeight}px`,
        '--density-icon-size': `${tokens.iconSize}px`,
        '--density-gap': `${tokens.gap}px`,
        '--density-chart-label-size': `${tokens.chartLabelSize}px`,
      }) as React.CSSProperties,
    [tokens],
  );

  return (
    <DensityContext.Provider value={value}>
      <div data-density={profile} style={style}>
        {children}
      </div>
    </DensityContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Hook to access the current density profile and tokens.
 * Must be used within a DensityProvider.
 */
export function useDensity(): DensityContextValue {
  const context = useContext(DensityContext);
  if (!context) {
    throw new Error('useDensity must be used within a DensityProvider');
  }
  return context;
}
