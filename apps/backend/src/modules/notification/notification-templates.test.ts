import { describe, it, expect } from 'vitest';
import { renderNotificationText } from './notification-templates';
import { getDefinition } from './notification-catalog';

describe('renderNotificationText', () => {
  it('renders the membership welcome with plan and end date', () => {
    const t = renderNotificationText('membership_welcome', {
      customerName: 'Budi', planName: 'Unlimited', endDate: '2026-09-06',
    })!;
    expect(t).toContain('Halo kak Budi!');
    expect(t).toContain('*Unlimited*');
    expect(t).toContain('2026-09-06');
  });

  it('speaks naturally when the customer name is missing', () => {
    const t = renderNotificationText('membership_welcome', { planName: 'Unlimited' })!;
    expect(t).toContain('Halo kak!');
    expect(t).not.toContain('kak !');
    expect(t).not.toContain('undefined');
  });

  // These used to assert phrasing this file derived itself — it turned
  // `daysRemaining: '0'` into "habis hari ini" and `codes` into a numbered
  // list. Both derivations also existed at the call sites
  // (notification.service.ts computes `expiryPhrase`, voucher-notify.service
  // computes `codeList`), and the copy here had drifted from the catalogue's.
  // The duplication is gone, so the contract under test is now: fill the
  // catalogue default from the params the caller passes.

  it('fills the expiry reminder from the phrase the caller computed', () => {
    const t = renderNotificationText('expiry_reminder', {
      customerName: 'Budi', planName: 'Unlimited', expiryPhrase: 'hari ini', endDate: '07 Agustus 2026',
    })!;
    expect(t).toContain('habis *hari ini*');
    expect(t).toContain('Unlimited');
    expect(t).toContain('Budi');
    expect(t).not.toContain('{');
  });

  it('renders exactly the catalogue default, so the two cannot drift again', () => {
    const vars = { customerName: 'Budi', planName: 'Unlimited', expiryPhrase: '7 hari lagi', endDate: '06 September 2026' };
    const def = getDefinition('membership_expiry_reminder')!;
    const expected = Object.entries(vars)
      .reduce((body, [k, v]) => body.replace(new RegExp(`\\{${k}\\}`, 'g'), v), def.defaultBody);

    expect(renderNotificationText('expiry_reminder', vars)).toBe(expected);
  });

  it('omits the expiry line for a voucher with no expiry', () => {
    const t = renderNotificationText('voucher_delivery', {
      voucherName: 'Paket 10x', codeList: '1. ABC-1', expiryDate: '',
    })!;
    expect(t).toContain('ABC-1');
    expect(t).not.toContain('{expiryDate}');
  });

  it('never speaks as a hardcoded persona', () => {
    // The whole reason the bodies left this file: it said "Mau *Irene* bantu
    // perpanjang sekarang?" — the demo car wash's assistant — to whichever
    // tenant reached this fallback.
    for (const name of ['expiry_reminder', 'retention_offer', 'membership_recommendation']) {
      const t = renderNotificationText(name, { customerName: 'Budi', planName: 'X', expiryPhrase: 'hari ini', offer: 'Y' });
      expect(t).not.toMatch(/irene/i);
    }
  });

  it('covers every template the code actually sends', () => {
    for (const name of [
      'membership_welcome', 'expiry_reminder', 'voucher_delivery', 'campaign_bonus',
      'queue_completion', 'retention_offer', 'membership_recommendation',
      'action_proposal_pending', 'escalation',
    ]) {
      const t = renderNotificationText(name, {});
      expect(t, `${name} must have a body`).toBeTruthy();
      expect(t).not.toContain('undefined');
    }
  });

  it('returns null for an unknown template rather than an empty bubble', () => {
    expect(renderNotificationText('not_a_template', {})).toBeNull();
  });
});
