import { describe, it, expect } from 'vitest';
import { toDateInput, fmtDate, fmtDateRange } from './dates';

describe('toDateInput', () => {
  it('passes through a date-only string unchanged', () => {
    expect(toDateInput('2026-07-29')).toBe('2026-07-29');
  });

  it('truncates an ISO timestamp to its date part', () => {
    // The AIRIN-137 case: campaign edit prefilled from an API timestamp rendered
    // blank because <input type="date"> rejects anything but YYYY-MM-DD.
    expect(toDateInput('2026-07-29T00:00:00.000Z')).toBe('2026-07-29');
    expect(toDateInput('2026-07-29T17:58:05+07:00')).toBe('2026-07-29');
  });

  it('does not shift the day for a date-only string', () => {
    // Parsing '2026-01-01' via Date() yields UTC midnight, which is the previous
    // day in any negative-offset timezone. The date-only fast path avoids that.
    expect(toDateInput('2026-01-01')).toBe('2026-01-01');
    expect(toDateInput('2026-12-31')).toBe('2026-12-31');
  });

  it('returns empty string for null, undefined, and empty input', () => {
    expect(toDateInput(null)).toBe('');
    expect(toDateInput(undefined)).toBe('');
    expect(toDateInput('')).toBe('');
  });

  it('returns empty string for unparseable input rather than throwing', () => {
    expect(toDateInput('not a date')).toBe('');
    expect(toDateInput(new Date('nope'))).toBe('');
  });

  it('accepts a Date object', () => {
    expect(toDateInput(new Date(2026, 6, 29))).toBe('2026-07-29');
  });
});

describe('fmtDate', () => {
  it('renders a human-readable date', () => {
    // id-ID short month; assert on the parts rather than exact punctuation so the
    // test survives ICU formatting differences across Node builds.
    const out = fmtDate('2026-07-29');
    expect(out).toContain('29');
    expect(out).toContain('2026');
    expect(out).not.toContain('T');
    expect(out).not.toBe('2026-07-29');
  });

  it('renders the stored day, not a timezone-shifted one', () => {
    expect(fmtDate('2026-01-01')).toContain('1');
    expect(fmtDate('2026-01-01')).toContain('2026');
  });

  it('renders an em-dash placeholder for empty values', () => {
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate('')).toBe('—');
  });
});

describe('fmtDateRange', () => {
  it('joins both ends', () => {
    const out = fmtDateRange('2026-07-29', '2026-08-31');
    expect(out).toContain('29');
    expect(out).toContain('31');
    expect(out).toContain('–');
  });

  it('collapses a single-day range to one date', () => {
    const out = fmtDateRange('2026-07-29', '2026-07-29');
    expect(out).toBe(fmtDate('2026-07-29'));
    expect(out).not.toContain('–');
  });

  it('handles a missing end or start', () => {
    expect(fmtDateRange('2026-07-29', null)).toContain('29');
    expect(fmtDateRange(null, '2026-08-31')).toContain('31');
  });

  it('renders an em-dash placeholder when both ends are empty', () => {
    expect(fmtDateRange(null, null)).toBe('—');
  });

  it('normalizes timestamps before comparing the two ends', () => {
    // Same day, different representations — must still collapse.
    expect(fmtDateRange('2026-07-29T00:00:00Z', '2026-07-29')).toBe(fmtDate('2026-07-29'));
  });
});
