import { describe, it, expect } from 'vitest';
import { calculateUpgradeCredit, UpgradeCreditInput } from './upgrade-credit';

describe('calculateUpgradeCredit', () => {
  it('charges the difference when plan price exceeds wash value', () => {
    const input: UpgradeCreditInput = {
      planPrice: 300000,
      washItems: [{ quantity: 1, unitPrice: 50000, discount: 0 }],
    };

    const result = calculateUpgradeCredit(input);

    expect(result.planPrice).toBe(300000);
    expect(result.washCredit).toBe(50000);
    expect(result.chargedAmount).toBe(250000);
  });

  it('floors charged amount at 0 when wash credit exceeds plan price', () => {
    const input: UpgradeCreditInput = {
      planPrice: 100000,
      washItems: [{ quantity: 3, unitPrice: 50000, discount: 0 }],
    };

    const result = calculateUpgradeCredit(input);

    expect(result.planPrice).toBe(100000);
    expect(result.washCredit).toBe(150000);
    expect(result.chargedAmount).toBe(0);
  });

  it('charges full plan price when there are no wash items', () => {
    const input: UpgradeCreditInput = {
      planPrice: 300000,
      washItems: [],
    };

    const result = calculateUpgradeCredit(input);

    expect(result.planPrice).toBe(300000);
    expect(result.washCredit).toBe(0);
    expect(result.chargedAmount).toBe(300000);
  });

  it('sums values from multiple wash items', () => {
    const input: UpgradeCreditInput = {
      planPrice: 300000,
      washItems: [
        { quantity: 1, unitPrice: 50000, discount: 0 },
        { quantity: 2, unitPrice: 40000, discount: 0 },
        { quantity: 1, unitPrice: 75000, discount: 0 },
      ],
    };

    const result = calculateUpgradeCredit(input);

    // washCredit = 50000 + (2*40000) + 75000 = 205000
    expect(result.washCredit).toBe(205000);
    expect(result.chargedAmount).toBe(95000);
  });

  it('subtracts discounts from wash item values', () => {
    const input: UpgradeCreditInput = {
      planPrice: 300000,
      washItems: [
        { quantity: 1, unitPrice: 80000, discount: 10000 },
        { quantity: 1, unitPrice: 50000, discount: 5000 },
      ],
    };

    const result = calculateUpgradeCredit(input);

    // washCredit = (80000 - 10000) + (50000 - 5000) = 70000 + 45000 = 115000
    expect(result.washCredit).toBe(115000);
    expect(result.chargedAmount).toBe(185000);
  });

  it('floors individual item values at 0 when discount exceeds item value', () => {
    const input: UpgradeCreditInput = {
      planPrice: 200000,
      washItems: [
        { quantity: 1, unitPrice: 30000, discount: 50000 }, // would be negative, floored to 0
        { quantity: 1, unitPrice: 60000, discount: 0 },
      ],
    };

    const result = calculateUpgradeCredit(input);

    // washCredit = 0 + 60000 = 60000
    expect(result.washCredit).toBe(60000);
    expect(result.chargedAmount).toBe(140000);
  });

  it('returns charged amount of 0 when wash credit exactly equals plan price', () => {
    const input: UpgradeCreditInput = {
      planPrice: 100000,
      washItems: [{ quantity: 2, unitPrice: 50000, discount: 0 }],
    };

    const result = calculateUpgradeCredit(input);

    expect(result.washCredit).toBe(100000);
    expect(result.chargedAmount).toBe(0);
  });
});
