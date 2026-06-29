import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { normalizeWhitespace, normalizePhone, normalizePlate } from './index';

describe('normalizeWhitespace', () => {
  it('should trim leading and trailing whitespace', () => {
    expect(normalizeWhitespace('  hello  ')).toBe('hello');
  });

  it('should collapse internal whitespace to single space', () => {
    expect(normalizeWhitespace('hello   world')).toBe('hello world');
  });

  it('property: result never has leading/trailing whitespace', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = normalizeWhitespace(s);
        return result === result.trim();
      }),
    );
  });

  it('property: result never has consecutive spaces', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = normalizeWhitespace(s);
        return !result.includes('  ');
      }),
    );
  });
});

describe('normalizePhone', () => {
  describe('prefix handling', () => {
    it('should normalize 0xxx format to 62xxx', () => {
      const result = normalizePhone('081234567890');
      expect(result).toEqual({ normalized: '6281234567890', valid: true });
    });

    it('should keep 62xxx format as-is', () => {
      const result = normalizePhone('6281234567890');
      expect(result).toEqual({ normalized: '6281234567890', valid: true });
    });

    it('should strip + from +62xxx format', () => {
      const result = normalizePhone('+6281234567890');
      expect(result).toEqual({ normalized: '6281234567890', valid: true });
    });
  });

  describe('non-digit stripping', () => {
    it('should strip spaces', () => {
      const result = normalizePhone('0812 3456 7890');
      expect(result).toEqual({ normalized: '6281234567890', valid: true });
    });

    it('should strip dashes', () => {
      const result = normalizePhone('0812-3456-7890');
      expect(result).toEqual({ normalized: '6281234567890', valid: true });
    });

    it('should strip parentheses and other characters', () => {
      const result = normalizePhone('(0812) 345-6789');
      expect(result).toEqual({ normalized: '628123456789', valid: true });
    });
  });

  describe('validation', () => {
    it('should reject numbers shorter than 8 digits after normalization', () => {
      const result = normalizePhone('0812');
      expect(result).toEqual({ normalized: '', valid: false });
    });

    it('should accept numbers with exactly 8 digits after normalization', () => {
      // 0 + 6 digits = 7 digits → normalized to 62 + 6 digits = 8 digits
      const result = normalizePhone('0123456');
      expect(result).toEqual({ normalized: '62123456', valid: true });
    });

    it('should reject numbers without a valid Indonesian prefix', () => {
      const result = normalizePhone('1234567890');
      expect(result).toEqual({ normalized: '', valid: false });
    });

    it('should reject empty input', () => {
      const result = normalizePhone('');
      expect(result).toEqual({ normalized: '', valid: false });
    });

    it('should reject input with only non-digit characters', () => {
      const result = normalizePhone('abc-def');
      expect(result).toEqual({ normalized: '', valid: false });
    });
  });

  describe('equivalence', () => {
    it('all three variants of the same number produce the same result', () => {
      const variant0 = normalizePhone('081234567890');
      const variant62 = normalizePhone('6281234567890');
      const variantPlus62 = normalizePhone('+6281234567890');

      expect(variant0.normalized).toBe(variant62.normalized);
      expect(variant62.normalized).toBe(variantPlus62.normalized);
      expect(variant0.valid).toBe(true);
    });
  });
});

describe('normalizePlate', () => {
  describe('whitespace removal and uppercasing', () => {
    it('should remove spaces and convert to uppercase', () => {
      const result = normalizePlate('B 1234 abc');
      expect(result).toEqual({ normalized: 'B1234ABC', valid: true });
    });

    it('should remove tabs', () => {
      const result = normalizePlate('B\t1234\tABC');
      expect(result).toEqual({ normalized: 'B1234ABC', valid: true });
    });

    it('should handle already normalized input', () => {
      const result = normalizePlate('B1234ABC');
      expect(result).toEqual({ normalized: 'B1234ABC', valid: true });
    });

    it('should handle lowercase-only input', () => {
      const result = normalizePlate('b1234abc');
      expect(result).toEqual({ normalized: 'B1234ABC', valid: true });
    });

    it('should handle mixed case with multiple spaces', () => {
      const result = normalizePlate('  b  1234  AbC  ');
      expect(result).toEqual({ normalized: 'B1234ABC', valid: true });
    });
  });

  describe('validation', () => {
    it('should reject empty string', () => {
      const result = normalizePlate('');
      expect(result).toEqual({ normalized: '', valid: false });
    });

    it('should reject whitespace-only input', () => {
      const result = normalizePlate('   ');
      expect(result).toEqual({ normalized: '', valid: false });
    });

    it('should reject input with only non-alphanumeric characters', () => {
      const result = normalizePlate('---');
      expect(result).toEqual({ normalized: '', valid: false });
    });

    it('should accept input with at least one alphanumeric character', () => {
      const result = normalizePlate('-A-');
      expect(result).toEqual({ normalized: '-A-', valid: true });
    });
  });

  describe('equivalence', () => {
    it('different spacing variants produce the same normalized result', () => {
      const variant1 = normalizePlate('B1234ABC');
      const variant2 = normalizePlate('B 1234 ABC');
      const variant3 = normalizePlate('B  1234  ABC');

      expect(variant1.normalized).toBe(variant2.normalized);
      expect(variant2.normalized).toBe(variant3.normalized);
    });

    it('different casing variants produce the same normalized result', () => {
      const variant1 = normalizePlate('B1234ABC');
      const variant2 = normalizePlate('b1234abc');
      const variant3 = normalizePlate('b1234Abc');

      expect(variant1.normalized).toBe(variant2.normalized);
      expect(variant2.normalized).toBe(variant3.normalized);
    });
  });
});
