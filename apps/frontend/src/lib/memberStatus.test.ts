import { describe, it, expect } from 'vitest';
import { memberBadge, MEMBER_STATUS_BADGE } from './memberStatus';

describe('memberBadge', () => {
  it('never labels a pending membership as a past member', () => {
    // AIRIN-124: the customer list had no 'pending' entry, so an unpaid
    // membership fell through and read as "Past member" — telling staff the sale
    // was over when payment was still collectable.
    const b = memberBadge('pending');
    expect(b.label).toBe('Pending member');
    expect(b.label).not.toContain('Past');
  });

  it('visually separates pending from the finished states', () => {
    const pending = memberBadge('pending').cls;
    expect(pending).not.toBe(memberBadge('expired').cls);
    expect(pending).not.toBe(memberBadge('revoked').cls);
    expect(pending).not.toBe(memberBadge('inactive').cls);
  });

  it('covers every status the API can return', () => {
    // Mirrors MembershipStatus in @aire/shared, plus the list-only 'inactive'.
    for (const s of ['active', 'grace', 'revoked', 'expired', 'pending', 'cancelled', 'suspended', 'inactive']) {
      expect(MEMBER_STATUS_BADGE[s], `missing badge for '${s}'`).toBeDefined();
    }
  });

  it('surfaces an unknown status instead of silently mislabelling it', () => {
    const b = memberBadge('some_new_status');
    expect(b.label).toBe('some_new_status');
    expect(b.cls).toContain('text-text-secondary');
  });

  it('gives every status a distinct i18n key', () => {
    const keys = Object.values(MEMBER_STATUS_BADGE).map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
