/**
 * AIRE Operations Platform — Design Tokens & Theme Configuration
 *
 * Implements Requirements 42 (Theme System) and 43 (Design Language).
 *
 * Color palette: warm neutral base tones with refined gold/amber accents.
 * Typography: Inter (body) + Plus Jakarta Sans (headings) — premium sans-serif pairing.
 * Spacing: 8px base unit grid with generous whitespace.
 * Depth: layered surface elevations, soft shadows, frosted-glass overlays.
 * Motion: smooth transitions 200–300ms for state changes.
 */

// ─── Color Palette ───────────────────────────────────────────────────────────

export const palette = {
  // Warm neutrals (no plain white or black)
  warmWhite: '#FAF8F5',
  cream: '#F5F0EA',
  stone100: '#EDE8E2',
  stone200: '#DDD6CC',
  stone300: '#C4BAB0',
  stone400: '#A89E94',
  stone500: '#8C8278',
  stone600: '#6B6159',
  stone700: '#4A423C',
  stone800: '#2E2822',
  stone900: '#1A1512',

  // Primary — refined amber/gold accent
  primary50: '#FFF8E7',
  primary100: '#FFEFC2',
  primary200: '#FFE29A',
  primary300: '#FFD470',
  primary400: '#FFC44D',
  primary500: '#E6A817', // main accent
  primary600: '#CC9412',
  primary700: '#A5780F',
  primary800: '#7D5B0B',
  primary900: '#5C4208',

  // Secondary — muted sage/teal for complementary use
  secondary50: '#F0F7F5',
  secondary100: '#D6EDE7',
  secondary200: '#B0D9CF',
  secondary300: '#82C1B3',
  secondary400: '#5AA896',
  secondary500: '#3D8F7C',
  secondary600: '#2F7364',
  secondary700: '#24594D',
  secondary800: '#1A4039',
  secondary900: '#112A26',

  // Semantic
  error50: '#FEF2F2',
  error100: '#FDE4E4',
  error500: '#DC3545',
  error600: '#B92D3B',
  error700: '#9A2532',

  success50: '#ECFDF5',
  success100: '#D1FAE5',
  success500: '#10B981',
  success600: '#059669',
  success700: '#047857',

  warning50: '#FFFBEB',
  warning100: '#FEF3C7',
  warning500: '#F59E0B',
  warning600: '#D97706',
  warning700: '#B45309',

  info50: '#EFF6FF',
  info100: '#DBEAFE',
  info500: '#3B82F6',
  info600: '#2563EB',
  info700: '#1D4ED8',
} as const;

// ─── Semantic Token Maps ─────────────────────────────────────────────────────

export interface ThemeTokens {
  // Surfaces
  surface: string;
  surfaceElevated: string;
  surfaceOverlay: string;
  surfaceSubtle: string;

  // On-surface text
  onSurface: string;
  onSurfaceMuted: string;
  onSurfaceSubtle: string;

  // Primary
  primary: string;
  primaryHover: string;
  primaryActive: string;
  onPrimary: string;

  // Secondary
  secondary: string;
  secondaryHover: string;
  onSecondary: string;

  // Semantic statuses
  error: string;
  errorSubtle: string;
  onError: string;
  success: string;
  successSubtle: string;
  onSuccess: string;
  warning: string;
  warningSubtle: string;
  onWarning: string;

  // Borders and dividers
  border: string;
  borderSubtle: string;
  borderFocus: string;

  // Shadows (CSS shadow values)
  shadowSm: string;
  shadowMd: string;
  shadowLg: string;
  shadowOverlay: string;
}

export const lightTokens: ThemeTokens = {
  // Warm off-white backgrounds (Req 42.4: avoiding plain #FFFFFF)
  surface: palette.warmWhite,
  surfaceElevated: '#FFFFFF',
  surfaceOverlay: 'rgba(250, 248, 245, 0.85)',
  surfaceSubtle: palette.cream,

  onSurface: palette.stone800,
  onSurfaceMuted: palette.stone600,
  onSurfaceSubtle: palette.stone400,

  primary: palette.primary500,
  primaryHover: palette.primary600,
  primaryActive: palette.primary700,
  onPrimary: palette.stone900, // Dark text on amber for WCAG AA contrast (≥3:1)

  secondary: palette.secondary500,
  secondaryHover: palette.secondary600,
  onSecondary: '#FFFFFF',

  error: palette.error500,
  errorSubtle: palette.error50,
  onError: '#FFFFFF',
  success: palette.success500,
  successSubtle: palette.success50,
  onSuccess: palette.stone900, // Dark text on green for WCAG AA contrast (≥3:1)
  warning: palette.warning500,
  warningSubtle: palette.warning50,
  onWarning: palette.stone800,

  border: palette.stone200,
  borderSubtle: palette.stone100,
  borderFocus: palette.primary500,

  shadowSm: '0 1px 2px rgba(26, 21, 18, 0.05)',
  shadowMd: '0 4px 12px rgba(26, 21, 18, 0.08)',
  shadowLg: '0 12px 32px rgba(26, 21, 18, 0.12)',
  shadowOverlay: '0 16px 48px rgba(26, 21, 18, 0.16)',
};

export const darkTokens: ThemeTokens = {
  surface: palette.stone900,
  surfaceElevated: palette.stone800,
  surfaceOverlay: 'rgba(26, 21, 18, 0.85)',
  surfaceSubtle: '#12100E',

  onSurface: palette.cream,
  onSurfaceMuted: palette.stone300,
  onSurfaceSubtle: palette.stone500,

  primary: palette.primary400,
  primaryHover: palette.primary300,
  primaryActive: palette.primary200,
  onPrimary: palette.stone900,

  secondary: palette.secondary400,
  secondaryHover: palette.secondary300,
  onSecondary: palette.stone900,

  error: '#F87171',
  errorSubtle: 'rgba(220, 53, 69, 0.15)',
  onError: palette.stone900,
  success: '#34D399',
  successSubtle: 'rgba(16, 185, 129, 0.15)',
  onSuccess: palette.stone900,
  warning: '#FBBF24',
  warningSubtle: 'rgba(245, 158, 11, 0.15)',
  onWarning: palette.stone900,

  border: palette.stone700,
  borderSubtle: palette.stone800,
  borderFocus: palette.primary400,

  shadowSm: '0 1px 2px rgba(0, 0, 0, 0.3)',
  shadowMd: '0 4px 12px rgba(0, 0, 0, 0.4)',
  shadowLg: '0 12px 32px rgba(0, 0, 0, 0.5)',
  shadowOverlay: '0 16px 48px rgba(0, 0, 0, 0.6)',
};

// ─── Typography Scale ────────────────────────────────────────────────────────
// Premium sans-serif pairing: Plus Jakarta Sans (headings) + Inter (body)
// Req 43.2: intentional size, weight, and line-height scales

export const typography = {
  fontFamily: {
    heading: "'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    body: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    mono: "'JetBrains Mono', 'Fira Code', monospace",
  },
  fontSize: {
    xs: '0.75rem',    // 12px
    sm: '0.875rem',   // 14px
    base: '1rem',     // 16px
    lg: '1.125rem',   // 18px
    xl: '1.25rem',    // 20px
    '2xl': '1.5rem',  // 24px
    '3xl': '1.875rem',// 30px
    '4xl': '2.25rem', // 36px
    '5xl': '3rem',    // 48px
  },
  fontWeight: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
    extrabold: '800',
  },
  lineHeight: {
    tight: '1.2',
    snug: '1.375',
    normal: '1.5',
    relaxed: '1.625',
    loose: '1.75',
  },
  letterSpacing: {
    tighter: '-0.02em',
    tight: '-0.01em',
    normal: '0',
    wide: '0.01em',
    wider: '0.02em',
  },
} as const;

// ─── Spacing Scale ───────────────────────────────────────────────────────────
// Req 43.3: 8px base unit, generous spacing conveying openness

export const spacing = {
  px: '1px',
  0: '0',
  0.5: '0.125rem',  // 2px
  1: '0.25rem',     // 4px
  2: '0.5rem',      // 8px — base unit
  3: '0.75rem',     // 12px
  4: '1rem',        // 16px
  5: '1.25rem',     // 20px
  6: '1.5rem',      // 24px
  8: '2rem',        // 32px
  10: '2.5rem',     // 40px
  12: '3rem',       // 48px
  16: '4rem',       // 64px
  20: '5rem',       // 80px
  24: '6rem',       // 96px
} as const;

// ─── Border Radius ───────────────────────────────────────────────────────────

export const radii = {
  none: '0',
  sm: '0.25rem',   // 4px
  md: '0.5rem',    // 8px
  lg: '0.75rem',   // 12px
  xl: '1rem',      // 16px
  '2xl': '1.5rem', // 24px
  full: '9999px',
} as const;

// ─── Transitions / Motion ────────────────────────────────────────────────────
// Req 43.5: smooth transitions 200–300ms for state changes

export const motion = {
  duration: {
    fast: '150ms',
    normal: '200ms',
    slow: '300ms',
    slower: '400ms',
  },
  easing: {
    default: 'cubic-bezier(0.4, 0, 0.2, 1)',
    in: 'cubic-bezier(0.4, 0, 1, 1)',
    out: 'cubic-bezier(0, 0, 0.2, 1)',
    inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
    spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
} as const;

// ─── Z-Index Scale ───────────────────────────────────────────────────────────

export const zIndex = {
  base: '0',
  dropdown: '1000',
  sticky: '1100',
  overlay: '1200',
  modal: '1300',
  popover: '1400',
  toast: '1500',
} as const;

// ─── Theme Mode Type ─────────────────────────────────────────────────────────

export type ThemeMode = 'light' | 'dark';

export const themeTokens = {
  light: lightTokens,
  dark: darkTokens,
} as const;
