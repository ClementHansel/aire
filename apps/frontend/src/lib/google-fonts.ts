/** Google Font catalog for branding (Font 1–3). Ported from the tara design system. */

export interface GoogleFontOption {
  id: string;
  label: string;
  category: 'sans' | 'display' | 'mono';
  /** CSS font-family value */
  family: string;
  /** Google Fonts API weights */
  weights: number[];
}

export const GOOGLE_FONT_SANS: GoogleFontOption[] = [
  { id: 'inter', label: 'Inter', category: 'sans', family: '"Inter", system-ui, sans-serif', weights: [300, 400, 500, 600, 700] },
  { id: 'plus-jakarta', label: 'Plus Jakarta Sans', category: 'sans', family: '"Plus Jakarta Sans", system-ui, sans-serif', weights: [300, 400, 500, 600, 700] },
  { id: 'dm-sans', label: 'DM Sans', category: 'sans', family: '"DM Sans", system-ui, sans-serif', weights: [400, 500, 600, 700] },
  { id: 'poppins', label: 'Poppins', category: 'sans', family: '"Poppins", system-ui, sans-serif', weights: [300, 400, 500, 600, 700] },
  { id: 'montserrat', label: 'Montserrat', category: 'sans', family: '"Montserrat", system-ui, sans-serif', weights: [300, 400, 500, 600, 700] },
  { id: 'nunito', label: 'Nunito', category: 'sans', family: '"Nunito", system-ui, sans-serif', weights: [400, 500, 600, 700] },
  { id: 'lato', label: 'Lato', category: 'sans', family: '"Lato", system-ui, sans-serif', weights: [300, 400, 700] },
  { id: 'roboto', label: 'Roboto', category: 'sans', family: '"Roboto", system-ui, sans-serif', weights: [300, 400, 500, 700] },
  { id: 'open-sans', label: 'Open Sans', category: 'sans', family: '"Open Sans", system-ui, sans-serif', weights: [400, 500, 600, 700] },
  { id: 'work-sans', label: 'Work Sans', category: 'sans', family: '"Work Sans", system-ui, sans-serif', weights: [300, 400, 500, 600, 700] },
  { id: 'outfit', label: 'Outfit', category: 'sans', family: '"Outfit", system-ui, sans-serif', weights: [300, 400, 500, 600, 700] },
  { id: 'manrope', label: 'Manrope', category: 'sans', family: '"Manrope", system-ui, sans-serif', weights: [400, 500, 600, 700] },
  { id: 'raleway', label: 'Raleway', category: 'sans', family: '"Raleway", system-ui, sans-serif', weights: [400, 500, 600, 700] },
  { id: 'source-sans', label: 'Source Sans 3', category: 'sans', family: '"Source Sans 3", system-ui, sans-serif', weights: [400, 500, 600, 700] },
];

export const GOOGLE_FONT_DISPLAY: GoogleFontOption[] = [
  { id: 'playfair', label: 'Playfair Display', category: 'display', family: '"Playfair Display", Georgia, serif', weights: [400, 500, 600, 700] },
  { id: 'fraunces', label: 'Fraunces', category: 'display', family: '"Fraunces", Georgia, serif', weights: [400, 500, 600, 700] },
  { id: 'merriweather', label: 'Merriweather', category: 'display', family: '"Merriweather", Georgia, serif', weights: [400, 700] },
  { id: 'libre-baskerville', label: 'Libre Baskerville', category: 'display', family: '"Libre Baskerville", Georgia, serif', weights: [400, 700] },
  { id: 'cormorant', label: 'Cormorant Garamond', category: 'display', family: '"Cormorant Garamond", Georgia, serif', weights: [400, 500, 600, 700] },
  { id: 'lora', label: 'Lora', category: 'display', family: '"Lora", Georgia, serif', weights: [400, 500, 600, 700] },
  { id: 'crimson', label: 'Crimson Pro', category: 'display', family: '"Crimson Pro", Georgia, serif', weights: [400, 500, 600, 700] },
  { id: 'dm-serif', label: 'DM Serif Display', category: 'display', family: '"DM Serif Display", Georgia, serif', weights: [400] },
  { id: 'bitter', label: 'Bitter', category: 'display', family: '"Bitter", Georgia, serif', weights: [400, 500, 600, 700] },
  { id: 'source-serif', label: 'Source Serif 4', category: 'display', family: '"Source Serif 4", Georgia, serif', weights: [400, 500, 600, 700] },
  { id: 'eb-garamond', label: 'EB Garamond', category: 'display', family: '"EB Garamond", Georgia, serif', weights: [400, 500, 600, 700] },
  { id: 'space-grotesk', label: 'Space Grotesk', category: 'display', family: '"Space Grotesk", system-ui, sans-serif', weights: [400, 500, 600, 700] },
];

export const GOOGLE_FONT_MONO: GoogleFontOption[] = [
  { id: 'jetbrains', label: 'JetBrains Mono', category: 'mono', family: '"JetBrains Mono", ui-monospace, monospace', weights: [400, 500] },
  { id: 'fira-code', label: 'Fira Code', category: 'mono', family: '"Fira Code", ui-monospace, monospace', weights: [400, 500] },
  { id: 'roboto-mono', label: 'Roboto Mono', category: 'mono', family: '"Roboto Mono", ui-monospace, monospace', weights: [400, 500] },
  { id: 'ibm-plex-mono', label: 'IBM Plex Mono', category: 'mono', family: '"IBM Plex Mono", ui-monospace, monospace', weights: [400, 500] },
  { id: 'source-code', label: 'Source Code Pro', category: 'mono', family: '"Source Code Pro", ui-monospace, monospace', weights: [400, 500] },
  { id: 'inconsolata', label: 'Inconsolata', category: 'mono', family: '"Inconsolata", ui-monospace, monospace', weights: [400, 500, 600, 700] },
  { id: 'dm-mono', label: 'DM Mono', category: 'mono', family: '"DM Mono", ui-monospace, monospace', weights: [400, 500] },
  { id: 'space-mono', label: 'Space Mono', category: 'mono', family: '"Space Mono", ui-monospace, monospace', weights: [400, 700] },
];

export interface FontThemeConfig {
  sans: string;
  display: string;
  mono: string;
}

export const DEFAULT_FONTS: FontThemeConfig = {
  sans: 'inter',
  display: 'plus-jakarta',
  mono: 'jetbrains',
};

export const GOOGLE_FONT_DISPLAY_GROUPS: { label: string; options: GoogleFontOption[] }[] = [
  { label: 'Sans (modern)', options: GOOGLE_FONT_SANS },
  {
    label: 'Serif & display',
    options: GOOGLE_FONT_DISPLAY.filter((f) => !GOOGLE_FONT_SANS.some((s) => s.id === f.id)),
  },
];

export interface FontThemePreset {
  id: string;
  name: string;
  description: string;
  fonts: FontThemeConfig;
}

export const FONT_THEME_PRESETS: FontThemePreset[] = [
  { id: 'aire-classic', name: 'AIRE Classic', description: 'Inter + Jakarta Sans + JetBrains', fonts: { sans: 'inter', display: 'plus-jakarta', mono: 'jetbrains' } },
  { id: 'jakarta-elegant', name: 'Jakarta Elegant', description: 'Plus Jakarta + Cormorant', fonts: { sans: 'plus-jakarta', display: 'cormorant', mono: 'ibm-plex-mono' } },
  { id: 'modern-clean', name: 'Modern Clean', description: 'Poppins + Space Grotesk', fonts: { sans: 'poppins', display: 'space-grotesk', mono: 'fira-code' } },
  { id: 'corporate', name: 'Corporate', description: 'Roboto + Merriweather', fonts: { sans: 'roboto', display: 'merriweather', mono: 'roboto-mono' } },
  { id: 'friendly', name: 'Friendly', description: 'Nunito + Lora', fonts: { sans: 'nunito', display: 'lora', mono: 'source-code' } },
  { id: 'minimal', name: 'Minimal', description: 'Work Sans + Fraunces', fonts: { sans: 'work-sans', display: 'fraunces', mono: 'dm-mono' } },
  { id: 'editorial', name: 'Editorial', description: 'Source Sans + Source Serif', fonts: { sans: 'source-sans', display: 'source-serif', mono: 'source-code' } },
  { id: 'tech', name: 'Tech', description: 'DM Sans + Bitter', fonts: { sans: 'dm-sans', display: 'bitter', mono: 'jetbrains' } },
];

const ALL_FONTS = [...GOOGLE_FONT_SANS, ...GOOGLE_FONT_DISPLAY, ...GOOGLE_FONT_MONO];

export function findFontById(id: string): GoogleFontOption | undefined {
  return ALL_FONTS.find((f) => f.id === id);
}

export function resolveFontFamilies(config: FontThemeConfig): {
  sans: string;
  display: string;
  mono: string;
} {
  return {
    sans: findFontById(config.sans)?.family ?? GOOGLE_FONT_SANS[0]?.family ?? 'sans-serif',
    display: findFontById(config.display)?.family ?? findFontById(DEFAULT_FONTS.display)?.family ?? 'sans-serif',
    mono: findFontById(config.mono)?.family ?? GOOGLE_FONT_MONO[0]?.family ?? 'monospace',
  };
}

function fontLabelFromFamily(family: string): string {
  const match = family.match(/^"([^"]+)"/);
  return match?.[1] ?? family.split(',')[0]?.trim().replace(/"/g, '') ?? family;
}

function buildGoogleFontsUrl(fonts: GoogleFontOption[]): string {
  const unique = new Map<string, GoogleFontOption>();
  for (const f of fonts) {
    const label = fontLabelFromFamily(f.family);
    const existing = unique.get(label);
    if (!existing || f.weights.length > existing.weights.length) {
      unique.set(label, f);
    }
  }
  const params = [...unique.values()].map((f) => {
    const name = fontLabelFromFamily(f.family);
    const weights = [...new Set(f.weights)].sort((a, b) => a - b).join(';');
    return `family=${encodeURIComponent(name)}:wght@${weights}`;
  });
  return `https://fonts.googleapis.com/css2?${params.join('&')}&display=swap`;
}

export function applyBrandingFonts(fonts: FontThemeConfig): void {
  if (typeof document === 'undefined') return;
  const sans = findFontById(fonts.sans) ?? GOOGLE_FONT_SANS[0]!;
  const display = findFontById(fonts.display) ?? findFontById(DEFAULT_FONTS.display) ?? GOOGLE_FONT_SANS[0]!;
  const mono = findFontById(fonts.mono) ?? GOOGLE_FONT_MONO[0]!;

  const resolved = resolveFontFamilies(fonts);
  const root = document.documentElement;
  root.style.setProperty('--font-sans', resolved.sans);
  root.style.setProperty('--font-display', resolved.display);
  root.style.setProperty('--font-mono', resolved.mono);

  const linkId = 'aire-google-fonts';
  let link = document.getElementById(linkId) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.id = linkId;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  link.href = buildGoogleFontsUrl([sans, display, mono]);
}

export function normalizeFontConfig(raw?: Partial<FontThemeConfig> | null): FontThemeConfig {
  const sans = raw?.sans && findFontById(raw.sans) ? raw.sans : DEFAULT_FONTS.sans;
  const display = raw?.display && findFontById(raw.display) ? raw.display : DEFAULT_FONTS.display;
  const mono = raw?.mono && findFontById(raw.mono) ? raw.mono : DEFAULT_FONTS.mono;
  return { sans, display, mono };
}
