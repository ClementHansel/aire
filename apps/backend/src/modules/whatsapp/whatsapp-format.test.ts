import { describe, it, expect } from 'vitest';
import { formatForWhatsApp } from './whatsapp-format';

describe('formatForWhatsApp', () => {
  it('converts markdown **bold** to whatsapp *bold*', () => {
    expect(formatForWhatsApp('Ini **tebal** ya')).toBe('Ini *tebal* ya');
  });

  it('converts __bold__ to *bold*', () => {
    expect(formatForWhatsApp('Ini __tebal__ ya')).toBe('Ini *tebal* ya');
  });

  it('leaves already-correct single-asterisk bold untouched', () => {
    expect(formatForWhatsApp('Ini *tebal* ya')).toBe('Ini *tebal* ya');
  });

  it('handles multiple bold spans on a line', () => {
    expect(formatForWhatsApp('**Jakarta:** dan **Surabaya:**')).toBe('*Jakarta:* dan *Surabaya:*');
  });

  it('rewrites markdown links to "label: url"', () => {
    expect(formatForWhatsApp('Lokasi: [Klik Maps](https://maps.app.goo.gl/abc)')).toBe(
      'Lokasi: Klik Maps: https://maps.app.goo.gl/abc',
    );
  });

  it('collapses a link whose label equals the url to just the url', () => {
    expect(formatForWhatsApp('[https://x.co/y](https://x.co/y)')).toBe('https://x.co/y');
  });

  it('promotes markdown headings to bold and strips hashes', () => {
    expect(formatForWhatsApp('## Info AIRE BSD')).toBe('*Info AIRE BSD*');
    expect(formatForWhatsApp('# Judul #')).toBe('*Judul*');
  });

  it('converts list markers to bullets', () => {
    expect(formatForWhatsApp('- Kemang\n- Sudirman\n* Wiyung')).toBe('• Kemang\n• Sudirman\n• Wiyung');
  });

  it('preserves indentation on nested bullets', () => {
    expect(formatForWhatsApp('  - nested')).toBe('  • nested');
  });

  it('handles a realistic mixed message', () => {
    const input = '**Jakarta:**\n- Outlet Kemang\n- Outlet Sudirman\n\nInfo: [Maps](https://maps.app.goo.gl/x)';
    const expected = '*Jakarta:*\n• Outlet Kemang\n• Outlet Sudirman\n\nInfo: Maps: https://maps.app.goo.gl/x';
    expect(formatForWhatsApp(input)).toBe(expected);
  });

  it('is a no-op for empty input', () => {
    expect(formatForWhatsApp('')).toBe('');
  });
});

describe('flirty emoji are stripped deterministically', () => {
  it('removes romantic emoji but keeps warm-professional ones', () => {
    expect(formatForWhatsApp('Irene siap bantu! 💕🙏')).toBe('Irene siap bantu! 🙏');
    expect(formatForWhatsApp('Makasih kak ❤️')).toBe('Makasih kak');
    expect(formatForWhatsApp('Halo kak! 😊 🚗✨')).toBe('Halo kak! 😊 🚗✨');
  });

  it('never eats question marks or ordinary punctuation', () => {
    expect(formatForWhatsApp('Mau yang mana kak? 💕')).toBe('Mau yang mana kak?');
    expect(formatForWhatsApp('Berapa? Kenapa? Kok bisa?')).toBe('Berapa? Kenapa? Kok bisa?');
  });

  it('leaves prices and bold intact while stripping hearts', () => {
    expect(formatForWhatsApp('**Standard Car Wash**: Rp 60.000 💖')).toBe('*Standard Car Wash*: Rp 60.000');
  });
});
