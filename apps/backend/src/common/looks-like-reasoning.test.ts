import { describe, it, expect } from 'vitest';
import { looksLikeReasoning } from './looks-like-reasoning';

/**
 * The real leak, as a customer received it on 2026-08-07 (abridged, but the
 * opening and the tells are verbatim). No tags anywhere — that is the point.
 */
const LEAK = [
  'Okay, let me try to figure out how to respond here. The user asked where the AIRE branches are located.',
  'I just got the tool result with all the branch info. Now I need to present that in a friendly,',
  'WhatsApp-style message without being too formal or listing everything in a dry way.',
  '',
  'First, I should acknowledge their question warmly. Maybe start with something like "Wah, senang banget',
  'kakak tanya cabang AIRE!" Then list the branches but not all at once. Since there are 10 branches,',
  'maybe group them by area: Jabodetabek and Surabaya. That makes it easier to read.',
  '',
  'Wait, the business knowledge says AIRE serves Jabodetabek and Surabaya. But the tool result also',
  'includes Outlet Kemang and Sudirman in Jakarta. Hmm, maybe those are newer outlets?',
  '',
  'Also, each branch has opening hours and phone numbers. Should I include those? The user asked for',
  'locations, so maybe focus on names and areas first. Check tone: must be warm, not robotic.',
  'But the business knowledge mentioned only 6 in Jabodetabek and',
].join('\n');

describe('looksLikeReasoning', () => {
  it('catches the production leak', () => {
    expect(looksLikeReasoning(LEAK)).toBe(true);
  });

  it('catches a leak that starts mid-thought, with no opener', () => {
    // What arrives when the head was truncated or the tags were stripped.
    const midThought = [
      'group them by area so it is easier to read. Wait, the tool result also includes two outlets',
      'that the business knowledge does not mention. Should I include those? Let me check the guidelines',
      'again — the instructions say to keep replies under eight lines, so I should not list every branch.',
      'Make sure to use single asterisks for bold. Now let me draft the actual message for the customer.',
    ].join(' ');
    expect(looksLikeReasoning(midThought)).toBe(true);
  });

  it('leaves a long, legitimate Indonesian reply alone', () => {
    const reply = [
      'Halo kak! 😊 Cabang AIRE ada di beberapa area nih:',
      '',
      '*Jabodetabek*: BSD, Bintaro, Kencana Loka, Kota Wisata, Kranggan, Jati Asih',
      '*Surabaya*: Citraland dan Wiyung',
      '',
      'Jam buka Senin-Sabtu 08.00-20.00, Minggu 09.00-18.00 ya kak.',
      'Kakak mau Irene kirimkan link Maps cabang yang paling dekat, atau sekalian bantu booking cuci mobil? 🚗',
    ].join('\n');
    expect(looksLikeReasoning(reply)).toBe(false);
  });

  it('leaves a long, legitimate English staff answer alone', () => {
    const answer = [
      'Let me give you the figures for last week. Revenue came to Rp 41.2 million across the ten branches,',
      'which is up about 6% on the week before. BSD and Bintaro drove most of the growth, while Kranggan',
      'was flat. The membership packs sold 34 units, and the express wash remains the top single service.',
      'I can break any of these down by branch or by day if that would help.',
    ].join(' ');
    expect(looksLikeReasoning(answer)).toBe(false);
  });

  it('does not flag a short reply that merely opens like deliberation', () => {
    expect(looksLikeReasoning('Let me check that for you kak, sebentar ya 😊')).toBe(false);
    expect(looksLikeReasoning('I need to confirm the plate number first.')).toBe(false);
  });

  it('handles empty and undefined input', () => {
    expect(looksLikeReasoning('')).toBe(false);
    expect(looksLikeReasoning(undefined as unknown as string)).toBe(false);
  });
});
