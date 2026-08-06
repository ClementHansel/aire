import { describe, it, expect } from 'vitest';
import { stripReasoning } from './strip-reasoning';

describe('stripReasoning', () => {
  it('removes a balanced <think> block', () => {
    const out = stripReasoning('<think>User said hi. I should greet back.</think>\n\nHalo juga kak! 😊');
    expect(out).toBe('Halo juga kak! 😊');
  });

  it('removes the scratchpad when only the closing tag is present (the prod bug)', () => {
    const raw = [
      'The user is greeting me again with "Halo kak" twice.',
      'I need to:',
      '1. Mirror their greeting warmly',
      '</think>',
      '',
      'Halo juga kak! 😊 Ada yang bisa Irene bantu hari ini?',
    ].join('\n');
    expect(stripReasoning(raw)).toBe('Halo juga kak! 😊 Ada yang bisa Irene bantu hari ini?');
  });

  it('drops a truncated, never-closed reasoning tail', () => {
    expect(stripReasoning('Halo kak!\n<think>now let me work out the price')).toBe('Halo kak!');
  });

  it('handles the other vendor tag spellings and attributes', () => {
    expect(stripReasoning('<thinking>hmm</thinking>Hi')).toBe('Hi');
    expect(stripReasoning('<reasoning>hmm</reasoning>Hi')).toBe('Hi');
    expect(stripReasoning('<think type="internal">hmm</think>Hi')).toBe('Hi');
  });

  it('strips every block when the model emits several', () => {
    expect(stripReasoning('<think>a</think>One<think>b</think>Two')).toBe('OneTwo');
  });

  it('leaves an ordinary reply untouched', () => {
    const reply = 'Cuci mobil mulai Rp 50.000 kak. Mau booking?';
    expect(stripReasoning(reply)).toBe(reply);
  });

  it('never returns empty when the model produced only reasoning', () => {
    expect(stripReasoning('<think>nothing to say</think>')).toBe('<think>nothing to say</think>');
  });

  it('passes empty input through', () => {
    expect(stripReasoning('')).toBe('');
  });
});
