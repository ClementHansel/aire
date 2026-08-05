import { describe, it, expect } from 'vitest';
import { describeMembershipEvent, membershipEventLabel } from './membership-history';

describe('membershipEventLabel', () => {
  it('turns an event type into a readable badge label', () => {
    expect(membershipEventLabel('plates_released')).toBe('Plates released');
    expect(membershipEventLabel('purchased')).toBe('Purchased');
    expect(membershipEventLabel('entered_grace')).toBe('Entered grace');
  });
});

describe('describeMembershipEvent', () => {
  it('describes a purchase without leaking variable names (AIRIN-141)', () => {
    const detail = describeMembershipEvent({
      eventType: 'purchased',
      payload: {
        orderNumber: 'ORD-20260805-003',
        amount: 349000,
        agent: 'Cashier Budi',
        cashier: 'Cashier Budi',
      },
    });

    expect(detail).toBe('Order ORD-20260805-003 · Rp 349.000 · sold by Cashier Budi');
    // The old rendering was a raw key dump — no key names may survive.
    expect(detail).not.toContain('orderNumber');
    expect(detail).not.toContain('amount');
    expect(detail).not.toContain('cashier:');
  });

  it('names both people when the agent is not the cashier', () => {
    expect(describeMembershipEvent({
      eventType: 'purchased',
      payload: { orderNumber: 'ORD-1', amount: 100000, agent: 'Sales Ani', cashier: 'Cashier Budi' },
    })).toBe('Order ORD-1 · Rp 100.000 · sold by Sales Ani · rung up by Cashier Budi');
  });

  it('shows a plate change as from → to', () => {
    expect(describeMembershipEvent({
      eventType: 'plate_updated',
      payload: { from: 'B 1111 AA', plate: 'B 2222 BB', vehicle: 'Toyota Avanza' },
    })).toBe('B 1111 AA → B 2222 BB — Toyota Avanza');
  });

  it('reads a reminder milestone as days left', () => {
    expect(describeMembershipEvent({ eventType: 'reminder', payload: { milestone: 7, source: 'system' } }))
      .toBe('Expiry reminder sent — 7 days left');
    expect(describeMembershipEvent({ eventType: 'reminder', payload: { milestone: 0, source: 'system' } }))
      .toBe('Expiry reminder sent — expires today');
    expect(describeMembershipEvent({ eventType: 'reminder', payload: { milestone: 1, source: 'system' } }))
      .toBe('Expiry reminder sent — 1 day left');
  });

  it('surfaces a suspension reason and nothing else', () => {
    expect(describeMembershipEvent({ eventType: 'suspended', payload: { reason: 'Payment dispute' } }))
      .toBe('Reason: Payment dispute');
    expect(describeMembershipEvent({ eventType: 'suspended', payload: null })).toBe('');
  });

  it('distinguishes the two kinds of renewal', () => {
    expect(describeMembershipEvent({ eventType: 'renewed', payload: { type: 'extension', orderId: 'o1', planId: 'p1' } }))
      .toBe('Current term extended');
    expect(describeMembershipEvent({ eventType: 'renewed', payload: { type: 'new_parallel', orderId: 'o1', planId: 'p1' } }))
      .toBe('Started a new term alongside the current one');
  });

  it('degrades an unknown event to humanised keys, dropping internal ids', () => {
    const detail = describeMembershipEvent({
      eventType: 'some_new_event',
      payload: { planId: 'plan-uuid', someField: 'value', amount: 50000, blank: '' },
    });

    expect(detail).toBe('Some field: value · Amount: Rp 50.000');
    expect(detail).not.toContain('plan-uuid');
  });

  it('returns empty for self-explanatory events with no payload', () => {
    expect(describeMembershipEvent({ eventType: 'welcome_sent', payload: { planId: 'p1' } }))
      .toBe('Welcome message sent on WhatsApp');
    expect(describeMembershipEvent({ eventType: 'revoked', payload: null }))
      .toBe('Grace period passed — benefits withdrawn');
  });
});
