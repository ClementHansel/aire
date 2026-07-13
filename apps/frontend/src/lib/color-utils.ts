import {
  applyBrandingFonts,
  DEFAULT_FONTS,
  normalizeFontConfig,
  type FontThemeConfig,
} from '@/lib/google-fonts';

export type { FontThemeConfig };

const HEX_RE = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

export function isValidHex(color: string): boolean {
  return HEX_RE.test(color.trim());
}

export function normalizeHex(hex: string): string {
  const h = hex.trim();
  if (!HEX_RE.test(h)) return h;
  if (h.length === 4) {
    return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`.toLowerCase();
  }
  return h.toLowerCase();
}

/** Convert #RRGGBB to Tailwind HSL token format: "H S% L%" */
export function hexToHslToken(hex: string): string {
  const normalized = normalizeHex(hex).replace('#', '');
  const r = parseInt(normalized.slice(0, 2), 16) / 255;
  const g = parseInt(normalized.slice(2, 4), 16) / 255;
  const b = parseInt(normalized.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      default:
        h = ((r - g) / d + 4) / 6;
    }
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function relativeLuminance(hex: string): number {
  const normalized = normalizeHex(hex).replace('#', '');
  const [r = 0, g = 0, b = 0] = [0, 2, 4].map((i) => {
    const c = parseInt(normalized.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Foreground HSL token for text on a colored background */
export function contrastForegroundToken(bgHex: string): string {
  return relativeLuminance(bgHex) > 0.45 ? '220 15% 7%' : '0 0% 100%';
}

export interface ThemeColorSet {
  primary: string;
  background: string;
  accent: string;
}

export interface BrandingConfig {
  light: ThemeColorSet;
  dark: ThemeColorSet;
  fonts: FontThemeConfig;
  dark_mode_enabled: boolean;
  forced_theme: 'light' | 'dark';
  default_theme: 'light' | 'dark';
}

/** Default brand palette — ported from the tara design system (navy + gold). */
export const DEFAULT_BRANDING: BrandingConfig = {
  light: { primary: '#1a2332', background: '#faf9f7', accent: '#d4a037' },
  dark: { primary: '#ebe9e6', background: '#0f1117', accent: '#e0a845' },
  fonts: { ...DEFAULT_FONTS },
  dark_mode_enabled: true,
  forced_theme: 'light',
  default_theme: 'light',
};

export function normalizeBrandingConfig(raw?: Partial<BrandingConfig> | null): BrandingConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_BRANDING };
  return {
    light: { ...DEFAULT_BRANDING.light, ...(raw.light || {}) },
    dark: { ...DEFAULT_BRANDING.dark, ...(raw.dark || {}) },
    fonts: normalizeFontConfig(raw.fonts),
    dark_mode_enabled: raw.dark_mode_enabled ?? DEFAULT_BRANDING.dark_mode_enabled,
    forced_theme: raw.forced_theme === 'dark' ? 'dark' : 'light',
    default_theme: raw.default_theme === 'dark' ? 'dark' : 'light',
  };
}

export function buildBrandingCss(branding: BrandingConfig): string {
  const light = branding.light;
  const dark = branding.dark;

  const lightPrimaryFg = contrastForegroundToken(light.primary);
  const darkPrimaryFg = contrastForegroundToken(dark.primary);

  return `
:root {
  --primary: ${hexToHslToken(light.primary)};
  --primary-foreground: ${lightPrimaryFg};
  --background: ${hexToHslToken(light.background)};
  --foreground: 240 10% 10%;
  --card: ${hexToHslToken(light.background)};
  --ring: ${hexToHslToken(light.primary)};
  --gold: ${hexToHslToken(light.accent)};
  --sidebar-primary: ${hexToHslToken(light.primary)};
  --sidebar-primary-foreground: ${lightPrimaryFg};
}
.dark {
  --primary: ${hexToHslToken(dark.primary)};
  --primary-foreground: ${darkPrimaryFg};
  --background: ${hexToHslToken(dark.background)};
  --foreground: 40 10% 92%;
  --card: ${hexToHslToken(dark.background)};
  --ring: ${hexToHslToken(dark.accent)};
  --gold: ${hexToHslToken(dark.accent)};
  --sidebar-primary: ${hexToHslToken(dark.primary)};
  --sidebar-primary-foreground: ${darkPrimaryFg};
}
`.trim();
}

export function applyBrandingCss(branding: BrandingConfig): void {
  if (typeof document === 'undefined') return;
  const normalized = normalizeBrandingConfig(branding);

  const id = 'aire-branding-styles';
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = buildBrandingCss(normalized);

  applyBrandingFonts(normalized.fonts);

  const themeColor = normalized.light.primary;
  let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = themeColor;
}
