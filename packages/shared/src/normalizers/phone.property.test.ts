import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { normalizePhone } from './index';
import { MIN_PHONE_LENGTH } from '../constants';

/**
 * Property-based tests for phone normalization equivalence.
 *
 * **Validates: Requirements 12.1, 38.1, 38.3**
 */

/**
 * Arbitrary generator for valid Indonesian phone number suffixes.
 * Generates digit strings of length 6-13 (after prefix '62' is added,
 * total becomes 8-15 digits, satisfying MIN_PHONE_LENGTH ≤ length ≤ MAX_PHONE_LENGTH).
 */
const phoneDigitSuffix = fc
  .integer({ min: 6, max: 13 })
  .chain((len) =>
    fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), {
      minLength: len,
      maxLength: len,
    }),
  );

/**
 * Arbitrary generator for formatting characters (spaces, dashes, parentheses)
 * that can be interspersed in a phone number string.
 */
const formattingChars = fc.stringOf(fc.constantFrom(' ', '-', '(', ')', '.'), {
  minLength: 0,
  maxLength: 3,
});

/**
 * Inserts random formatting characters between digits of a phone string.
 */
function insertFormatting(digits: string, formatParts: string[]): string {
  let result = '';
  for (let i = 0; i < digits.length; i++) {
    if (i < formatParts.length) {
      result += formatParts[i];
    }
    result += digits[i];
  }
  return result;
}

describe('normalizePhone - Property-Based Tests', () => {
  describe('Property 4: Phone Normalization Equivalence', () => {
    it('all three prefix variants (0, 62, +62) produce the same canonical form', () => {
      fc.assert(
        fc.property(phoneDigitSuffix, (suffix) => {
          const with0 = normalizePhone('0' + suffix);
          const with62 = normalizePhone('62' + suffix);
          const withPlus62 = normalizePhone('+62' + suffix);

          // All should be valid
          expect(with0.valid).toBe(true);
          expect(with62.valid).toBe(true);
          expect(withPlus62.valid).toBe(true);

          // All should produce identical normalized form
          expect(with0.normalized).toBe(with62.normalized);
          expect(with62.normalized).toBe(withPlus62.normalized);
        }),
        { numRuns: 200 },
      );
    });

    it('normalized form always starts with "62"', () => {
      fc.assert(
        fc.property(
          phoneDigitSuffix,
          fc.constantFrom('0', '62', '+62'),
          (suffix, prefix) => {
            const result = normalizePhone(prefix + suffix);
            expect(result.valid).toBe(true);
            expect(result.normalized.startsWith('62')).toBe(true);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('normalized form has length >= MIN_PHONE_LENGTH', () => {
      fc.assert(
        fc.property(
          phoneDigitSuffix,
          fc.constantFrom('0', '62', '+62'),
          (suffix, prefix) => {
            const result = normalizePhone(prefix + suffix);
            expect(result.valid).toBe(true);
            expect(result.normalized.length).toBeGreaterThanOrEqual(MIN_PHONE_LENGTH);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('arbitrary formatting (spaces, dashes, parentheses) does not affect normalized form', () => {
      fc.assert(
        fc.property(
          phoneDigitSuffix,
          fc.constantFrom('0', '62', '+62'),
          fc.array(formattingChars, { minLength: 1, maxLength: 15 }),
          (suffix, prefix, formatParts) => {
            const cleanInput = prefix + suffix;
            const formattedInput = insertFormatting(cleanInput, formatParts);

            const cleanResult = normalizePhone(cleanInput);
            const formattedResult = normalizePhone(formattedInput);

            expect(cleanResult.valid).toBe(true);
            expect(formattedResult.valid).toBe(true);
            expect(formattedResult.normalized).toBe(cleanResult.normalized);
          },
        ),
        { numRuns: 200 },
      );
    });
  });
});
