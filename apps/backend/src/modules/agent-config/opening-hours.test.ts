import { describe, it, expect } from 'vitest';
import { sanitizeOpeningHours } from './agent-config.service';

describe('sanitizeOpeningHours', () => {
  it('keeps valid open/close times', () => {
    expect(sanitizeOpeningHours({ mon: { open: '08:00', close: '20:00' } })).toEqual({
      mon: { open: '08:00', close: '20:00' },
    });
  });

  it('keeps closed:true days', () => {
    expect(sanitizeOpeningHours({ sun: { closed: true } })).toEqual({ sun: { closed: true } });
  });

  it('closed wins over any times on the same day', () => {
    expect(sanitizeOpeningHours({ sun: { closed: true, open: '09:00', close: '18:00' } })).toEqual({
      sun: { closed: true },
    });
  });

  it('drops malformed times', () => {
    expect(sanitizeOpeningHours({ mon: { open: '8am', close: '20:00' } })).toBeNull();
    expect(sanitizeOpeningHours({ mon: { open: '25:00', close: '20:00' } })).toBeNull();
    expect(sanitizeOpeningHours({ mon: { open: '08:00' } })).toBeNull(); // close missing
  });

  it('drops unknown weekday keys', () => {
    expect(sanitizeOpeningHours({ funday: { open: '08:00', close: '20:00' } })).toBeNull();
  });

  it('returns null for empty / non-object / null input', () => {
    expect(sanitizeOpeningHours(null)).toBeNull();
    expect(sanitizeOpeningHours({})).toBeNull();
    expect(sanitizeOpeningHours('08:00-20:00')).toBeNull();
  });

  it('normalises a full week, keeping only the valid entries', () => {
    expect(
      sanitizeOpeningHours({
        mon: { open: '08:00', close: '20:00' },
        tue: { open: '08:00', close: '20:00' },
        sun: { closed: true },
        sat: { open: 'bad', close: '18:00' },
      }),
    ).toEqual({
      mon: { open: '08:00', close: '20:00' },
      tue: { open: '08:00', close: '20:00' },
      sun: { closed: true },
    });
  });
});
