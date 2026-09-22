import { describe, it, expect } from 'vitest';
import { formatRupiah, withPriceText } from './rupiah';

/**
 * Real amounts from the client's own price lists, because that is where the
 * formatting actually has to hold: Kalibrasi's sheet runs from Rp 175.000 to
 * Rp 27.500.000, and the failures that matter (a dropped digit, a stray decimal,
 * a "juta" abbreviation) only appear at the long end.
 */
describe('formatRupiah', () => {
  it('groups thousands with dots, as Indonesian money is written', () => {
    expect(formatRupiah(750000)).toBe('Rp 750.000');
    expect(formatRupiah(1250000)).toBe('Rp 1.250.000');
  });

  it('holds at the eight-digit end of a calibration price list', () => {
    // The rows a model is most likely to mangle into "Rp 22,4 juta".
    expect(formatRupiah(22400000)).toBe('Rp 22.400.000');
    expect(formatRupiah(27500000)).toBe('Rp 27.500.000');
    expect(formatRupiah(8500000)).toBe('Rp 8.500.000');
  });

  it('handles the small end without inventing separators', () => {
    expect(formatRupiah(175000)).toBe('Rp 175.000');
    expect(formatRupiah(457000)).toBe('Rp 457.000');
  });

  it('drops the cents Postgres DECIMAL brings along', () => {
    // `price` is DECIMAL(12,2), so pg hands back "750000.00" as a STRING.
    // Quoting "Rp 750.000,00" to a customer reads as a mistake.
    expect(formatRupiah('750000.00')).toBe('Rp 750.000');
    expect(formatRupiah('1250000.50')).toBe('Rp 1.250.001');
  });

  it('returns null for a missing amount instead of "Rp NaN"', () => {
    // A tool result carrying "Rp NaN" is worse than one carrying nothing: the
    // model will happily quote it.
    expect(formatRupiah(null)).toBeNull();
    expect(formatRupiah(undefined)).toBeNull();
    expect(formatRupiah(Number.NaN)).toBeNull();
    expect(formatRupiah('not a number')).toBeNull();
  });

  it('formats zero as a real amount, not as nothing', () => {
    // Unpriced imported rows sit at 0 and are inactive, so they should never
    // reach a customer — but if one ever does, "Rp 0" is at least honest.
    expect(formatRupiah(0)).toBe('Rp 0');
  });
});

describe('withPriceText', () => {
  it('keeps the number AND adds the string', () => {
    // Both, deliberately: sorting on the formatted string would put
    // Rp 1.000.000 below Rp 750.000.
    expect(withPriceText({ name: 'Digital Multimeter', price: 750000 }))
      .toEqual({ name: 'Digital Multimeter', price: 750000, priceText: 'Rp 750.000' });
  });

  it('sorts correctly on price while displaying priceText', () => {
    const rows = [
      withPriceText({ price: 1000000 }),
      withPriceText({ price: 750000 }),
      withPriceText({ price: 22400000 }),
    ].sort((a, b) => a.price - b.price);
    expect(rows.map((r) => r.priceText)).toEqual(['Rp 750.000', 'Rp 1.000.000', 'Rp 22.400.000']);
  });
});
