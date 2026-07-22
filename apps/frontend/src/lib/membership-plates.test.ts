import { describe, it, expect } from 'vitest';
import {
  emptyPlateRow,
  prefillPlateRow,
  validatePlateRows,
  canAddPlateRow,
  type PlateRow,
} from './membership-plates';

describe('membership-plates', () => {
  describe('emptyPlateRow', () => {
    it('returns a blank row', () => {
      expect(emptyPlateRow()).toEqual({ plate: '', brand: '', model: '' });
    });
  });

  describe('prefillPlateRow', () => {
    it('fills in known vehicle info', () => {
      expect(prefillPlateRow('B 1234 ABC', 'Toyota', 'Avanza')).toEqual({
        plate: 'B 1234 ABC', brand: 'Toyota', model: 'Avanza',
      });
    });

    it('falls back to blanks when nothing is known', () => {
      expect(prefillPlateRow()).toEqual({ plate: '', brand: '', model: '' });
    });

    it('handles a plate with no brand/model', () => {
      expect(prefillPlateRow('B 1234 ABC')).toEqual({ plate: 'B 1234 ABC', brand: '', model: '' });
    });
  });

  describe('validatePlateRows', () => {
    it('blocks save when the first row is empty', () => {
      const rows: PlateRow[] = [{ plate: '', brand: '', model: '' }];
      const result = validatePlateRows(rows);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('Register at least one plate.');
    });

    it('blocks save when the first row is only whitespace', () => {
      const rows: PlateRow[] = [{ plate: '   ', brand: '', model: '' }];
      expect(validatePlateRows(rows).ok).toBe(false);
    });

    it('accepts a single filled first row', () => {
      const rows: PlateRow[] = [{ plate: 'B 1234 ABC', brand: 'Toyota', model: 'Avanza' }];
      const result = validatePlateRows(rows);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.plates).toEqual(rows);
    });

    it('drops blank extra rows but keeps the valid ones', () => {
      const rows: PlateRow[] = [
        { plate: 'B 1234 ABC', brand: '', model: '' },
        { plate: '', brand: '', model: '' },
        { plate: 'D 5678 XYZ', brand: 'Honda', model: 'Jazz' },
      ];
      const result = validatePlateRows(rows);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.plates).toHaveLength(2);
        expect(result.plates.map((p) => p.plate)).toEqual(['B 1234 ABC', 'D 5678 XYZ']);
      }
    });

    it('uses a custom error message when given one', () => {
      const result = validatePlateRows([{ plate: '', brand: '', model: '' }], 'Custom message');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('Custom message');
    });
  });

  describe('canAddPlateRow', () => {
    it('allows adding under the max', () => {
      expect(canAddPlateRow(1, 3)).toBe(true);
      expect(canAddPlateRow(2, 3)).toBe(true);
    });

    it('blocks adding at or above the max', () => {
      expect(canAddPlateRow(3, 3)).toBe(false);
      expect(canAddPlateRow(4, 3)).toBe(false);
    });

    it('defaults to 3 when maxPlates is missing/zero', () => {
      expect(canAddPlateRow(2, undefined)).toBe(true);
      expect(canAddPlateRow(3, undefined)).toBe(false);
      expect(canAddPlateRow(2, 0)).toBe(true);
    });
  });
});
