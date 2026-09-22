import { describe, it, expect } from 'vitest';
import { personaDisplayName } from './persona-name';

/**
 * Found on the LIVE Kalibrasi tenant 2026-09-22: `agents.name` held
 * "Halo kak! Aku Kalia, CS-nya Kalibrasi.com" instead of "Kalia". The prompt
 * substitutes that field into a dozen example sentences, and the model copies
 * examples — so this single bad row was producing garbled replies, which is one
 * of the complaints in that day's feedback.
 */
describe('personaDisplayName — real names pass through untouched', () => {
  it('leaves an ordinary name alone', () => {
    expect(personaDisplayName('Kalia')).toBe('Kalia');
    expect(personaDisplayName('Irene')).toBe('Irene');
  });

  it('leaves a legitimate multi-word name alone', () => {
    // Mangling a real name is a worse outcome than passing a slightly long one.
    expect(personaDisplayName('CS Aire')).toBe('CS Aire');
    expect(personaDisplayName('Kak Irene')).toBe('Kak Irene');
    expect(personaDisplayName('Irene CS Aire')).toBe('Irene CS Aire');
  });

  it('normalises surrounding whitespace only', () => {
    expect(personaDisplayName('  Kalia  ')).toBe('Kalia');
    expect(personaDisplayName('Irene\n  CS')).toBe('Irene CS');
  });
});

describe('personaDisplayName — a sentence is reduced to the name inside it', () => {
  it('recovers the name from the exact live Kalibrasi value', () => {
    expect(personaDisplayName('Halo kak! Aku Kalia, CS-nya Kalibrasi.com')).toBe('Kalia');
  });

  it('recovers a name from the other ways owners write an introduction', () => {
    expect(personaDisplayName('Halo! Saya Rina dari Bengkel Jaya')).toBe('Rina');
    expect(personaDisplayName("Hi there, I'm Sarah, your assistant")).toBe('Sarah');
    expect(personaDisplayName('Selamat pagi, nama saya Budi')).toBe('Budi');
  });

  it('strips a bare greeting prefix when there is no self-introduction', () => {
    expect(personaDisplayName('Halo kak! Kalia')).toBe('Kalia');
  });

  it('never returns a paragraph to be pasted into an example sentence', () => {
    const long = 'Selamat datang di layanan kami, silakan sampaikan kebutuhan Anda dan tim kami akan membantu';
    const out = personaDisplayName(long);
    expect(out === null || out.length <= 24).toBe(true);
  });
});

describe('personaDisplayName — empty means "use your own wording"', () => {
  it('returns null rather than an empty fragment', () => {
    // The caller falls back to "kami"; returning '' would render "Aku , CS-nya…".
    expect(personaDisplayName('')).toBeNull();
    expect(personaDisplayName('   ')).toBeNull();
    expect(personaDisplayName(null)).toBeNull();
    expect(personaDisplayName(undefined)).toBeNull();
  });
});
