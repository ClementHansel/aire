import { describe, it, expect } from 'vitest';
import { renderNotificationText } from './notification-templates';

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

  it('says "hari ini" rather than "dalam 0 hari" on expiry day', () => {
    const t = renderNotificationText('expiry_reminder', {
      customerName: 'Budi', planName: 'Unlimited', daysRemaining: '0', endDate: '2026-08-07',
    })!;
    expect(t).toContain('habis *hari ini*');
    expect(t).not.toContain('0 hari');
  });

  it('counts down on the other reminder milestones', () => {
    const t = renderNotificationText('expiry_reminder', { planName: 'Unlimited', daysRemaining: '30' })!;
    expect(t).toContain('habis dalam *30 hari*');
  });

  it('omits the expiry line for a voucher with no expiry', () => {
    // The caller passes the literal string 'no expiry' when there is none.
    const t = renderNotificationText('voucher_delivery', { codes: 'ABC-1', expiryDate: 'no expiry' })!;
    expect(t).toContain('ABC-1');
    expect(t).not.toContain('no expiry');
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
