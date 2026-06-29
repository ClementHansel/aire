import { describe, it, expect } from 'vitest';
import {
  CartItem,
  CartConfig,
  calculateCartSummary,
  addToCart,
  removeFromCart,
  updateQuantity,
  applyManualDiscount,
} from './index';

const defaultConfig: CartConfig = {
  serviceChargePct: 0.05,
  taxPct: 0.11,
};

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    serviceId: 'svc-1',
    serviceName: 'Basic Wash',
    quantity: 1,
    unitPrice: 50000,
    discount: 0,
    isMainService: true,
    ...overrides,
  };
}

describe('calculateCartSummary', () => {
  it('calculates correct totals for a single item with no discounts', () => {
    const items = [makeItem()];
    const result = calculateCartSummary(items, defaultConfig);

    expect(result.subtotal).toBe(50000);
    expect(result.serviceCharge).toBe(2500); // 50000 * 0.05
    expect(result.tax).toBe(5500); // 50000 * 0.11
    expect(result.voucherDiscount).toBe(0);
    expect(result.promoDiscount).toBe(0);
    expect(result.total).toBe(58000); // 50000 + 2500 + 5500
  });

  it('calculates correct totals for multiple items', () => {
    const items = [
      makeItem({ serviceId: 'svc-1', unitPrice: 50000, quantity: 2 }),
      makeItem({ serviceId: 'svc-2', serviceName: 'Wax', unitPrice: 30000, quantity: 1, isMainService: false }),
    ];
    const result = calculateCartSummary(items, defaultConfig);

    // subtotal = (2 * 50000 - 0) + (1 * 30000 - 0) = 130000
    expect(result.subtotal).toBe(130000);
    expect(result.serviceCharge).toBe(6500); // 130000 * 0.05
    expect(result.tax).toBe(14300); // 130000 * 0.11
    expect(result.total).toBe(150800); // 130000 + 6500 + 14300
  });

  it('applies item discount to subtotal', () => {
    const items = [makeItem({ unitPrice: 50000, discount: 10000 })];
    const result = calculateCartSummary(items, defaultConfig);

    // subtotal = 1 * 50000 - 10000 = 40000
    expect(result.subtotal).toBe(40000);
    expect(result.serviceCharge).toBe(2000); // 40000 * 0.05
    expect(result.tax).toBe(4400); // 40000 * 0.11
    expect(result.total).toBe(46400); // 40000 + 2000 + 4400
  });

  it('applies voucher discount to total', () => {
    const items = [makeItem({ unitPrice: 50000 })];
    const result = calculateCartSummary(items, defaultConfig, 10000);

    // total = 50000 + 2500 + 5500 - 10000 = 48000
    expect(result.subtotal).toBe(50000);
    expect(result.voucherDiscount).toBe(10000);
    expect(result.total).toBe(48000);
  });

  it('applies promo discount to total', () => {
    const items = [makeItem({ unitPrice: 50000 })];
    const result = calculateCartSummary(items, defaultConfig, 0, 5000);

    // total = 50000 + 2500 + 5500 - 0 - 5000 = 53000
    expect(result.total).toBe(53000);
    expect(result.promoDiscount).toBe(5000);
  });

  it('applies both voucher and promo discounts', () => {
    const items = [makeItem({ unitPrice: 100000 })];
    const result = calculateCartSummary(items, defaultConfig, 20000, 10000);

    // subtotal = 100000
    // serviceCharge = 5000
    // tax = 11000
    // total = 100000 + 5000 + 11000 - 20000 - 10000 = 86000
    expect(result.total).toBe(86000);
  });

  it('floors total at 0 when discounts exceed subtotal + charges', () => {
    const items = [makeItem({ unitPrice: 10000 })];
    const result = calculateCartSummary(items, defaultConfig, 50000, 50000);

    // subtotal = 10000, serviceCharge = 500, tax = 1100
    // raw total = 10000 + 500 + 1100 - 50000 - 50000 = -88400
    expect(result.total).toBe(0);
  });

  it('returns zero subtotal for empty cart', () => {
    const result = calculateCartSummary([], defaultConfig);

    expect(result.subtotal).toBe(0);
    expect(result.serviceCharge).toBe(0);
    expect(result.tax).toBe(0);
    expect(result.total).toBe(0);
  });

  it('floors individual item contribution at 0 when discount exceeds item value', () => {
    const items = [makeItem({ unitPrice: 10000, quantity: 1, discount: 50000 })];
    const result = calculateCartSummary(items, defaultConfig);

    // item contribution floored at 0
    expect(result.subtotal).toBe(0);
    expect(result.total).toBe(0);
  });

  it('handles zero service charge and tax percentages', () => {
    const items = [makeItem({ unitPrice: 50000 })];
    const config: CartConfig = { serviceChargePct: 0, taxPct: 0 };
    const result = calculateCartSummary(items, config);

    expect(result.serviceCharge).toBe(0);
    expect(result.tax).toBe(0);
    expect(result.total).toBe(50000);
  });
});

describe('addToCart', () => {
  it('adds a new item to an empty cart', () => {
    const result = addToCart([], makeItem());
    expect(result).toHaveLength(1);
    expect(result[0].serviceId).toBe('svc-1');
    expect(result[0].quantity).toBe(1);
  });

  it('increments quantity when adding an existing item', () => {
    const items = [makeItem({ quantity: 2 })];
    const result = addToCart(items, makeItem({ quantity: 1 }));

    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(3);
  });

  it('adds a different item alongside existing items', () => {
    const items = [makeItem()];
    const newItem = makeItem({ serviceId: 'svc-2', serviceName: 'Wax' });
    const result = addToCart(items, newItem);

    expect(result).toHaveLength(2);
    expect(result[1].serviceId).toBe('svc-2');
  });

  it('does not mutate the original array', () => {
    const items = [makeItem({ quantity: 1 })];
    const result = addToCart(items, makeItem({ quantity: 1 }));

    expect(items[0].quantity).toBe(1); // original unchanged
    expect(result[0].quantity).toBe(2);
  });
});

describe('removeFromCart', () => {
  it('removes an item by serviceId', () => {
    const items = [makeItem({ serviceId: 'svc-1' }), makeItem({ serviceId: 'svc-2' })];
    const result = removeFromCart(items, 'svc-1');

    expect(result).toHaveLength(1);
    expect(result[0].serviceId).toBe('svc-2');
  });

  it('returns the same items if serviceId not found', () => {
    const items = [makeItem()];
    const result = removeFromCart(items, 'nonexistent');

    expect(result).toHaveLength(1);
    expect(result[0].serviceId).toBe('svc-1');
  });

  it('does not mutate the original array', () => {
    const items = [makeItem()];
    removeFromCart(items, 'svc-1');

    expect(items).toHaveLength(1);
  });
});

describe('updateQuantity', () => {
  it('updates quantity for an existing item', () => {
    const items = [makeItem({ quantity: 1 })];
    const result = updateQuantity(items, 'svc-1', 5);

    expect(result[0].quantity).toBe(5);
  });

  it('removes item when quantity is set to 0', () => {
    const items = [makeItem({ quantity: 3 })];
    const result = updateQuantity(items, 'svc-1', 0);

    expect(result).toHaveLength(0);
  });

  it('removes item when quantity is negative', () => {
    const items = [makeItem({ quantity: 3 })];
    const result = updateQuantity(items, 'svc-1', -1);

    expect(result).toHaveLength(0);
  });

  it('does not mutate the original array', () => {
    const items = [makeItem({ quantity: 1 })];
    updateQuantity(items, 'svc-1', 10);

    expect(items[0].quantity).toBe(1);
  });
});

describe('applyManualDiscount', () => {
  it('applies discount to the specified item', () => {
    const items = [makeItem({ unitPrice: 50000, quantity: 1 })];
    const result = applyManualDiscount(items, 'svc-1', 10000, defaultConfig);

    expect(result[0].discount).toBe(10000);
  });

  it('caps discount at maxManualDiscountPct * unitPrice * quantity', () => {
    const config: CartConfig = { serviceChargePct: 0.05, taxPct: 0.11, maxManualDiscountPct: 0.5 };
    const items = [makeItem({ unitPrice: 50000, quantity: 2 })]; // max = 0.5 * 50000 * 2 = 50000

    const result = applyManualDiscount(items, 'svc-1', 80000, config);
    expect(result[0].discount).toBe(50000);
  });

  it('allows full discount when no maxManualDiscountPct is configured', () => {
    const config: CartConfig = { serviceChargePct: 0.05, taxPct: 0.11 };
    const items = [makeItem({ unitPrice: 50000, quantity: 1 })];

    const result = applyManualDiscount(items, 'svc-1', 80000, config);
    expect(result[0].discount).toBe(80000); // no cap applied
  });

  it('floors negative discounts to 0', () => {
    const items = [makeItem()];
    const result = applyManualDiscount(items, 'svc-1', -5000, defaultConfig);

    expect(result[0].discount).toBe(0);
  });

  it('does not modify other items', () => {
    const items = [
      makeItem({ serviceId: 'svc-1', discount: 0 }),
      makeItem({ serviceId: 'svc-2', discount: 5000 }),
    ];
    const result = applyManualDiscount(items, 'svc-1', 10000, defaultConfig);

    expect(result[0].discount).toBe(10000);
    expect(result[1].discount).toBe(5000); // unchanged
  });

  it('does not mutate the original array', () => {
    const items = [makeItem({ discount: 0 })];
    applyManualDiscount(items, 'svc-1', 10000, defaultConfig);

    expect(items[0].discount).toBe(0);
  });
});
