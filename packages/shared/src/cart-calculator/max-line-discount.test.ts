import { describe, it, expect } from 'vitest';
import { maxLineDiscount } from './index';

/**
 * AIRIN-121/122/123: a manual discount is a per-item permission set in the
 * dashboard, not a tenant-wide percentage every menu item inherits. 0 means the
 * item was never enabled, and callers must read that as "offer no discount
 * field", never as "unlimited".
 */
describe('maxLineDiscount', () => {
  it('returns 0 when the item has not opted in', () => {
    expect(maxLineDiscount({ enabled: false, kind: 'fixed', maxDiscount: 5000 }, 50000, 1)).toBe(0);
  });

  it('returns 0 for a missing or empty rule', () => {
    expect(maxLineDiscount(undefined, 50000, 1)).toBe(0);
    expect(maxLineDiscount(null, 50000, 1)).toBe(0);
    expect(maxLineDiscount({}, 50000, 1)).toBe(0);
  });

  it('returns 0 when enabled but no maximum was configured', () => {
    // The DB coherence CHECK forbids this, but an older row or a partial API
    // response must not become an unlimited discount.
    expect(maxLineDiscount({ enabled: true, kind: 'fixed', maxDiscount: null }, 50000, 1)).toBe(0);
    expect(maxLineDiscount({ enabled: true, kind: 'percentage', maxDiscount: 0 }, 50000, 1)).toBe(0);
    expect(maxLineDiscount({ enabled: true, kind: 'fixed', maxDiscount: -100 }, 50000, 1)).toBe(0);
  });

  it('treats a fixed maximum as Rupiah, independent of quantity', () => {
    expect(maxLineDiscount({ enabled: true, kind: 'fixed', maxDiscount: 5000 }, 50000, 1)).toBe(5000);
    expect(maxLineDiscount({ enabled: true, kind: 'fixed', maxDiscount: 5000 }, 50000, 3)).toBe(5000);
  });

  it('scales a percentage maximum with the whole line', () => {
    expect(maxLineDiscount({ enabled: true, kind: 'percentage', maxDiscount: 10 }, 50000, 1)).toBe(5000);
    // 10% of 3 × 50 000 = 15 000 — the cap is per line, not per unit.
    expect(maxLineDiscount({ enabled: true, kind: 'percentage', maxDiscount: 10 }, 50000, 3)).toBe(15000);
  });

  it('never allows a discount larger than the line total', () => {
    // A fixed cap above the line price would otherwise make the line negative.
    expect(maxLineDiscount({ enabled: true, kind: 'fixed', maxDiscount: 999999 }, 50000, 1)).toBe(50000);
    // A stored percentage above 100 is clamped rather than trusted.
    expect(maxLineDiscount({ enabled: true, kind: 'percentage', maxDiscount: 250 }, 50000, 1)).toBe(50000);
  });

  it('handles zero and negative price/quantity without going negative', () => {
    expect(maxLineDiscount({ enabled: true, kind: 'percentage', maxDiscount: 50 }, 0, 1)).toBe(0);
    expect(maxLineDiscount({ enabled: true, kind: 'fixed', maxDiscount: 5000 }, 50000, 0)).toBe(0);
    expect(maxLineDiscount({ enabled: true, kind: 'fixed', maxDiscount: 5000 }, -50000, 2)).toBe(0);
  });

  it('treats an unexpected kind as a Rupiah amount rather than throwing', () => {
    expect(
      maxLineDiscount({ enabled: true, kind: 'weird' as 'fixed', maxDiscount: 5000 }, 50000, 1),
    ).toBe(5000);
  });
});
