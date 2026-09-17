import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BUSINESS_UNITS_BY_VERTICAL,
  DEFAULT_VERTICAL,
  MODULES_BLOCKED_BY_VERTICAL,
  TENANT_VERTICALS,
  asVertical,
  resolveCapabilities,
} from './verticals';

describe('asVertical', () => {
  it('accepts every declared vertical', () => {
    for (const v of TENANT_VERTICALS) {
      expect(asVertical(v.key)).toBe(v.key);
    }
  });

  it('falls back to the default for anything unknown', () => {
    // A tenant row written before migration 099, a typo, or a hostile value all
    // land on the default rather than producing an undefined capability set.
    for (const bad of [undefined, null, '', 'CARWASH', 'retail', 42, {}]) {
      expect(asVertical(bad)).toBe(DEFAULT_VERTICAL);
    }
  });

  it('defaults to carwash, because that is what every pre-099 tenant is', () => {
    expect(DEFAULT_VERTICAL).toBe('carwash');
  });
});

describe('resolveCapabilities', () => {
  it('gives a car wash vehicles, bays and LPR', () => {
    expect(resolveCapabilities('carwash', null)).toEqual({
      vehicles: true, bays: true, lpr: true, subjectNoun: 'Vehicle',
    });
  });

  it('gives a non-vehicle vertical no vehicle concepts at all', () => {
    // This is the whole point: a lab-services or laundry tenant must not be
    // asked for a license plate, because there is never one to give.
    for (const v of ['services', 'fnb', 'laundry'] as const) {
      const caps = resolveCapabilities(v, null);
      expect(caps.vehicles).toBe(false);
      expect(caps.bays).toBe(false);
      expect(caps.lpr).toBe(false);
    }
  });

  it('treats a missing or empty override object as "inherit the preset"', () => {
    const preset = resolveCapabilities('carwash', null);
    expect(resolveCapabilities('carwash', undefined)).toEqual(preset);
    expect(resolveCapabilities('carwash', {})).toEqual(preset);
    // A non-object (bad JSON in settings.features) must not blow up either.
    expect(resolveCapabilities('carwash', 'nonsense' as never)).toEqual(preset);
  });

  it('lets an explicit override win over the preset in both directions', () => {
    expect(resolveCapabilities('carwash', { bays: false }).bays).toBe(false);
    expect(resolveCapabilities('services', { vehicles: true }).vehicles).toBe(true);
  });

  it('ignores non-boolean override values rather than coercing them', () => {
    // 'false' (a string) is truthy in JS; coercing it would turn an intended
    // "off" into "on" — the worst possible direction for a capability flag.
    expect(resolveCapabilities('services', { vehicles: 'true' }).vehicles).toBe(false);
    expect(resolveCapabilities('carwash', { bays: 0 }).bays).toBe(true);
  });

  it('never leaves LPR on without vehicles to recognise', () => {
    // LPR reads plates off a camera; with no vehicle identity there is nothing
    // to match against, so the combination is meaningless.
    expect(resolveCapabilities('carwash', { vehicles: false, lpr: true }).lpr).toBe(false);
    expect(resolveCapabilities('services', { lpr: true }).lpr).toBe(false);
  });

  it('allows a tenant to rename the subject noun but not blank it', () => {
    expect(resolveCapabilities('services', { subjectNoun: 'Sample' }).subjectNoun).toBe('Sample');
    expect(resolveCapabilities('services', { subjectNoun: '   ' }).subjectNoun).toBe('Job');
  });

  it('returns a fresh object so callers cannot mutate the shared preset', () => {
    const a = resolveCapabilities('carwash', null);
    a.vehicles = false;
    expect(resolveCapabilities('carwash', null).vehicles).toBe(true);
  });
});

describe('starter business units', () => {
  it('defines units for every vertical', () => {
    for (const v of TENANT_VERTICALS) {
      expect(DEFAULT_BUSINESS_UNITS_BY_VERTICAL[v.key].length).toBeGreaterThan(0);
    }
  });

  it('never seeds a new tenant with the founding tenant\'s brands', () => {
    // AIRE and LEAD are Airin's own two brands. Seeding them for anyone else
    // hands a new company someone else's naming and, worse, makes every
    // `?? 'AIRE'` fallback in the codebase write a code they do not own.
    const codes = Object.values(DEFAULT_BUSINESS_UNITS_BY_VERTICAL)
      .flat()
      .map((u) => u.code);
    expect(codes).not.toContain('AIRE');
    expect(codes).not.toContain('LEAD');
  });

  it('keeps unit codes within the business_units.code column limit', () => {
    for (const u of Object.values(DEFAULT_BUSINESS_UNITS_BY_VERTICAL).flat()) {
      expect(u.code.length).toBeLessThanOrEqual(10);
      expect(u.code).toMatch(/^[A-Z0-9_-]+$/);
    }
  });
});

describe('vertical-blocked modules', () => {
  it('lists an entry for every vertical so lookups never return undefined', () => {
    for (const v of TENANT_VERTICALS) {
      expect(Array.isArray(MODULES_BLOCKED_BY_VERTICAL[v.key])).toBe(true);
    }
  });

  it('blocks CCTV/LPR for verticals with no vehicles', () => {
    expect(MODULES_BLOCKED_BY_VERTICAL.carwash).toEqual([]);
    for (const v of ['services', 'fnb', 'laundry'] as const) {
      expect(MODULES_BLOCKED_BY_VERTICAL[v]).toContain('cctv');
    }
  });
});
