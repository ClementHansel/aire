/**
 * AIRE Operations Platform — WCAG Contrast Calculation Utility
 *
 * Implements WCAG 2.1 contrast ratio calculation for verifying
 * theme compliance (Requirements 42.5, 42.6).
 *
 * WCAG AA thresholds:
 *   - Normal text (< 18px or < 14px bold): 4.5:1 minimum
 *   - Large text (≥ 18px or ≥ 14px bold): 3:1 minimum
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RGB {
  r: number; // 0–255
  g: number; // 0–255
  b: number; // 0–255
}

// ─── Hex Parsing ─────────────────────────────────────────────────────────────

/**
 * Parse a hex color string (#RGB, #RRGGBB, or #RRGGBBAA) to RGB values.
 * Returns null if the string is not a valid hex color.
 */
export function hexToRgb(hex: string): RGB | null {
  // Remove leading #
  const cleaned = hex.replace(/^#/, '');

  let r: number, g: number, b: number;

  if (cleaned.length === 3) {
    // Short form #RGB
    r = parseInt(cleaned.charAt(0) + cleaned.charAt(0), 16);
    g = parseInt(cleaned.charAt(1) + cleaned.charAt(1), 16);
    b = parseInt(cleaned.charAt(2) + cleaned.charAt(2), 16);
  } else if (cleaned.length === 6 || cleaned.length === 8) {
    // Full form #RRGGBB or #RRGGBBAA (alpha ignored)
    r = parseInt(cleaned.slice(0, 2), 16);
    g = parseInt(cleaned.slice(2, 4), 16);
    b = parseInt(cleaned.slice(4, 6), 16);
  } else {
    return null;
  }

  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;

  return { r, g, b };
}

// ─── Relative Luminance ──────────────────────────────────────────────────────

/**
 * Calculate the relative luminance of a color per WCAG 2.1 definition.
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 *
 * @param rgb - Color as RGB (0–255 per channel)
 * @returns Relative luminance (0–1)
 */
export function relativeLuminance(rgb: RGB): number {
  const [rs, gs, bs] = [rgb.r / 255, rgb.g / 255, rgb.b / 255];

  const r = rs <= 0.03928 ? rs / 12.92 : Math.pow((rs + 0.055) / 1.055, 2.4);
  const g = gs <= 0.03928 ? gs / 12.92 : Math.pow((gs + 0.055) / 1.055, 2.4);
  const b = bs <= 0.03928 ? bs / 12.92 : Math.pow((bs + 0.055) / 1.055, 2.4);

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ─── Contrast Ratio ──────────────────────────────────────────────────────────

/**
 * Calculate the contrast ratio between two colors per WCAG 2.1.
 * https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 *
 * @returns Contrast ratio ≥ 1 (e.g. 4.5, 7.0, 21.0)
 */
export function contrastRatio(color1: RGB, color2: RGB): number {
  const l1 = relativeLuminance(color1);
  const l2 = relativeLuminance(color2);

  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  return (lighter + 0.05) / (darker + 0.05);
}

// ─── WCAG AA Compliance Check ────────────────────────────────────────────────

export interface ContrastResult {
  ratio: number;
  passesNormalText: boolean;  // ≥ 4.5:1
  passesLargeText: boolean;   // ≥ 3:1
}

/**
 * Check WCAG AA contrast compliance between foreground and background hex colors.
 */
export function checkContrast(foregroundHex: string, backgroundHex: string): ContrastResult | null {
  const fg = hexToRgb(foregroundHex);
  const bg = hexToRgb(backgroundHex);

  if (!fg || !bg) return null;

  const ratio = contrastRatio(fg, bg);

  return {
    ratio,
    passesNormalText: ratio >= 4.5,
    passesLargeText: ratio >= 3.0,
  };
}
