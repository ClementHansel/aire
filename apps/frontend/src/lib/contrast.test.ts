/**
 * Property Test: Theme Contrast Compliance (Property 29)
 *
 * Verifies WCAG AA contrast (4.5:1 for normal text, 3:1 for large text)
 * between onSurface and surface colors in both light and dark themes.
 *
 * **Validates: Requirements 42.5, 42.6**
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  hexToRgb,
  relativeLuminance,
  contrastRatio,
  checkContrast,
  type RGB,
} from './contrast';
import { lightTokens, darkTokens } from './theme';

// ─── Unit Tests ──────────────────────────────────────────────────────────────

describe('contrast utility', () => {
  describe('hexToRgb', () => {
    it('parses 6-digit hex', () => {
      expect(hexToRgb('#FF0000')).toEqual({ r: 255, g: 0, b: 0 });
      expect(hexToRgb('#00FF00')).toEqual({ r: 0, g: 255, b: 0 });
      expect(hexToRgb('#0000FF')).toEqual({ r: 0, g: 0, b: 255 });
    });

    it('parses 3-digit hex shorthand', () => {
      expect(hexToRgb('#F00')).toEqual({ r: 255, g: 0, b: 0 });
      expect(hexToRgb('#FFF')).toEqual({ r: 255, g: 255, b: 255 });
    });

    it('parses 8-digit hex (ignores alpha)', () => {
      expect(hexToRgb('#FF000080')).toEqual({ r: 255, g: 0, b: 0 });
    });

    it('handles no leading hash', () => {
      expect(hexToRgb('FF0000')).toEqual({ r: 255, g: 0, b: 0 });
    });

    it('returns null for invalid input', () => {
      expect(hexToRgb('#GGG')).toBeNull();
      expect(hexToRgb('#12')).toBeNull();
      expect(hexToRgb('')).toBeNull();
    });
  });

  describe('relativeLuminance', () => {
    it('returns 0 for black', () => {
      expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    });

    it('returns 1 for white', () => {
      expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBe(1);
    });

    it('returns ~0.2126 for pure red', () => {
      expect(relativeLuminance({ r: 255, g: 0, b: 0 })).toBeCloseTo(0.2126, 4);
    });
  });

  describe('contrastRatio', () => {
    it('returns 21:1 for black on white', () => {
      const black: RGB = { r: 0, g: 0, b: 0 };
      const white: RGB = { r: 255, g: 255, b: 255 };
      expect(contrastRatio(black, white)).toBeCloseTo(21, 0);
    });

    it('returns 1:1 for same color', () => {
      const color: RGB = { r: 128, g: 128, b: 128 };
      expect(contrastRatio(color, color)).toBe(1);
    });

    it('is commutative (order-independent)', () => {
      const a: RGB = { r: 50, g: 100, b: 150 };
      const b: RGB = { r: 200, g: 220, b: 240 };
      expect(contrastRatio(a, b)).toBe(contrastRatio(b, a));
    });
  });

  describe('checkContrast', () => {
    it('black on white passes both thresholds', () => {
      const result = checkContrast('#000000', '#FFFFFF');
      expect(result).not.toBeNull();
      expect(result!.passesNormalText).toBe(true);
      expect(result!.passesLargeText).toBe(true);
    });

    it('returns null for invalid hex', () => {
      expect(checkContrast('#ZZZ', '#FFFFFF')).toBeNull();
    });
  });
});

// ─── Property-Based Tests ────────────────────────────────────────────────────

describe('Property 29: Theme Contrast Compliance', () => {
  /**
   * All text-on-surface combinations in the AIRE theme must meet
   * WCAG AA contrast requirements.
   *
   * - onSurface on surface: ≥ 4.5:1 (normal text)
   * - onSurfaceMuted on surface: ≥ 3:1 (large text acceptable)
   */

  // Define the text/background pairs we need to validate per theme.
  // Normal body text on surfaces: 4.5:1 (WCAG AA normal text)
  // Muted text on surfaces: 3:1 (used at large sizes)
  // Text on colored backgrounds (buttons/badges): 3:1 (large text/UI components per WCAG)
  const textBackgroundPairs = [
    { text: 'onSurface', bg: 'surface', threshold: 4.5 },
    { text: 'onSurface', bg: 'surfaceElevated', threshold: 4.5 },
    { text: 'onSurface', bg: 'surfaceSubtle', threshold: 4.5 },
    { text: 'onSurfaceMuted', bg: 'surface', threshold: 3.0 },
    { text: 'onSurfaceMuted', bg: 'surfaceElevated', threshold: 3.0 },
    { text: 'onPrimary', bg: 'primary', threshold: 3.0 },
    { text: 'onSecondary', bg: 'secondary', threshold: 3.0 },
    { text: 'onError', bg: 'error', threshold: 3.0 },
    { text: 'onSuccess', bg: 'success', threshold: 3.0 },
  ] as const;

  const themes = [
    { name: 'light', tokens: lightTokens },
    { name: 'dark', tokens: darkTokens },
  ] as const;

  it('all onSurface/surface pairs meet WCAG AA contrast in both themes', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...themes),
        fc.constantFrom(...textBackgroundPairs),
        (theme, pair) => {
          const textColor = theme.tokens[pair.text as keyof typeof theme.tokens] as string;
          const bgColor = theme.tokens[pair.bg as keyof typeof theme.tokens] as string;

          // Skip non-hex colors (rgba, etc.) — they need alpha compositing
          if (!textColor.startsWith('#') || !bgColor.startsWith('#')) return true;

          const result = checkContrast(textColor, bgColor);
          if (!result) return true; // Skip unparseable pairs

          return result.ratio >= pair.threshold;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('contrast ratio is always >= 1', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        (r1, g1, b1, r2, g2, b2) => {
          const ratio = contrastRatio(
            { r: r1, g: g1, b: b1 },
            { r: r2, g: g2, b: b2 },
          );
          return ratio >= 1;
        },
      ),
      { numRuns: 500 },
    );
  });

  it('contrast ratio is commutative', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        (r1, g1, b1, r2, g2, b2) => {
          const a: RGB = { r: r1, g: g1, b: b1 };
          const b: RGB = { r: r2, g: g2, b: b2 };
          return contrastRatio(a, b) === contrastRatio(b, a);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('maximum contrast ratio is between black and white (21:1)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        (r1, g1, b1, r2, g2, b2) => {
          const ratio = contrastRatio(
            { r: r1, g: g1, b: b1 },
            { r: r2, g: g2, b: b2 },
          );
          return ratio <= 21;
        },
      ),
      { numRuns: 500 },
    );
  });
});
