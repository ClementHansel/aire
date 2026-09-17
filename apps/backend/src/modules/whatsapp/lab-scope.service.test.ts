import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { LabScopeService, searchKey, toCanonical } from './lab-scope.service';

/**
 * The conversions below are the ones that decide whether a customer is told yes
 * or no. They mirror database/seeds/lk240_capabilities.py — if the two ever
 * disagree, a range stored in one scale is compared against a value in another
 * and the answer flips silently.
 */
describe('toCanonical', () => {
  it('puts mass on kg, so 2000 kg cannot hide inside a gram-scaled range', () => {
    expect(toCanonical(2000, 'kg', 'mass')).toBe(2000);
    expect(toCanonical(1000, 'g', 'mass')).toBe(1);
    expect(toCanonical(500, 'mg', 'mass')).toBeCloseTo(0.0005, 12);
  });

  it('puts voltage on volts across the prefixes a certificate mixes', () => {
    expect(toCanonical(20, 'kV', 'voltage')).toBe(20000);
    expect(toCanonical(1000, 'V', 'voltage')).toBe(1000);
    expect(toCanonical(199, 'mV', 'voltage')).toBeCloseTo(0.199, 12);
  });

  it('distinguishes mOhm (milli) from MOhm (mega) by CASE, not by lowercasing', () => {
    // The whole reason resistance gets its own resolver: lowercasing these two
    // makes them the same string, and they differ by a factor of a billion.
    expect(toCanonical(1, 'mOhm', 'resistance')).toBeCloseTo(1e-3, 12);
    expect(toCanonical(1, 'MOhm', 'resistance')).toBe(1e6);
    expect(toCanonical(1, 'kOhm', 'resistance')).toBe(1e3);
    expect(toCanonical(1, 'GOhm', 'resistance')).toBe(1e9);
    expect(toCanonical(5, 'Ohm', 'resistance')).toBe(5);
  });

  it('converts pressure units a customer actually types', () => {
    expect(toCanonical(1, 'bar', 'pressure')).toBe(1);
    expect(toCanonical(100, 'kPa', 'pressure')).toBeCloseTo(1, 12);
  });

  it('returns null for an unknown unit rather than guessing a multiplier', () => {
    expect(toCanonical(1, 'furlong', 'mass')).toBeNull();
    expect(toCanonical(1, 'kg', 'nonsense_quantity')).toBeNull();
  });
});

describe('searchKey', () => {
  it('normalises punctuation and case to match instrument_search', () => {
    expect(searchKey('Termokopel Tipe K')).toBe('termokopel tipe k');
    expect(searchKey('Pressure Gauge (Hydraulic)')).toBe('pressure gauge hydraulic');
    expect(searchKey('  pH   Meter ')).toBe('ph meter');
  });
});

function poolWith(rows: Record<string, unknown>[], onQuery?: (sql: string, params: unknown[]) => void): Pool {
  return {
    query: async (sql: string, params: unknown[]) => {
      onQuery?.(sql, params);
      return { rows, rowCount: rows.length };
    },
  } as unknown as Pool;
}

const ROW = {
  lab: 'PT Dinamika Kalibrasi Indonesia',
  lk_number: 'LK-240-IDN',
  is_own_lab: true,
  measurement_group: 'Massa',
  instrument: 'Timbangan',
  range_text: '500~1000 kg',
  unit: 'kg',
  quantity: 'mass',
  range_min_si: 500,
  range_max_si: 1000,
  range_point_si: null,
  uncertainty: '0.41 kg',
  method: 'SNSU PK.M-02:2021',
};

describe('LabScopeService.check', () => {
  it('requires EVERY token to match, so "termokopel k" cannot match type J', async () => {
    let seen: unknown[] = [];
    const svc = new LabScopeService(poolWith([], (_s, p) => { seen = p; }));
    await svc.check('t1', 'Termokopel Tipe K');
    expect(seen).toEqual(['t1', '%termokopel%', '%tipe%', '%k%']);
  });

  it('only ever reads VERIFIED rows from ACTIVE labs', async () => {
    let sql = '';
    const svc = new LabScopeService(poolWith([], (s) => { sql = s; }));
    await svc.check('t1', 'Timbangan');
    expect(sql).toContain('c.verified = TRUE');
    expect(sql).toContain('p.is_active = TRUE');
  });

  it('confirms in-scope when the value falls inside a range', async () => {
    const svc = new LabScopeService(poolWith([ROW]));
    const out = await svc.check('t1', 'Timbangan', 800, 'kg');
    expect(out.inScope).toBe(true);
    expect(out.matches[0]!.uncertainty).toBe('0.41 kg');
    expect(out.matches[0]!.lkNumber).toBe('LK-240-IDN');
  });

  it('refuses when the instrument matches but the magnitude does not, and says what IS covered', async () => {
    const svc = new LabScopeService(poolWith([ROW]));
    const out = await svc.check('t1', 'Timbangan', 2000, 'kg');
    expect(out.inScope).toBe(false);
    expect(out.matches).toHaveLength(0);
    // The reply must be able to be specific about why not, rather than a bare no.
    expect(out.nearest?.[0]?.range).toBe('500~1000 kg');
  });

  it('compares across scales: 1500 g is inside a 1~5 kg range', async () => {
    const svc = new LabScopeService(poolWith([{ ...ROW, range_text: '1~5 kg', range_min_si: 1, range_max_si: 5 }]));
    const out = await svc.check('t1', 'Timbangan', 1500, 'g');
    expect(out.inScope).toBe(true);
  });

  it('does not filter — and SAYS so — when the unit is unrecognised', async () => {
    const svc = new LabScopeService(poolWith([ROW]));
    const out = await svc.check('t1', 'Timbangan', 5, 'stone');
    expect(out.inScope).toBe(true);
    expect(out.note).toMatch(/not recognised/i);
  });

  it('never turns a DB failure into "we cannot do that"', async () => {
    const pool = { query: async () => { throw new Error('relation does not exist'); } } as unknown as Pool;
    const out = await new LabScopeService(pool).check('t1', 'Timbangan', 10, 'kg');
    expect(out.inScope).toBe(false);
    expect(out.matches).toHaveLength(0);
    expect(out.note).toMatch(/escalate/i);
  });

  it('matches a single-point entry exactly', async () => {
    const pt = { ...ROW, instrument: 'Anak Timbangan', range_text: '1 kg', range_min_si: null, range_max_si: null, range_point_si: 1, uncertainty: '8.1 mg' };
    const svc = new LabScopeService(poolWith([pt]));
    expect((await svc.check('t1', 'Anak Timbangan', 1, 'kg')).inScope).toBe(true);
    expect((await svc.check('t1', 'Anak Timbangan', 3, 'kg')).inScope).toBe(false);
  });
});
