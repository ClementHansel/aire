import { describe, it, expect } from 'vitest';
import {
  calculateCommission,
  CommissionInput,
  CommissionRule,
} from './index';

/** Helper to build a CommissionInput with sensible defaults */
function makeInput(overrides: Partial<CommissionInput> = {}): CommissionInput {
  return {
    rule: { type: 'percentage', value: 0.05 },
    completedOrders: [
      { total: 100000, isVoided: false },
      { total: 150000, isVoided: false },
    ],
    ...overrides,
  };
}

describe('calculateCommission', () => {
  describe('voided order exclusion', () => {
    it('excludes voided orders from calculation', () => {
      const input = makeInput({
        rule: { type: 'percentage', value: 0.1 },
        completedOrders: [
          { total: 100000, isVoided: false },
          { total: 200000, isVoided: true },
          { total: 50000, isVoided: false },
        ],
      });

      const result = calculateCommission(input);

      expect(result.ordersConsidered).toBe(2);
      expect(result.totalRevenue).toBe(150000);
      expect(result.totalCommission).toBe(15000); // 150000 * 0.1
    });

    it('returns zero commission when all orders are voided', () => {
      const input = makeInput({
        rule: { type: 'percentage', value: 0.05 },
        completedOrders: [
          { total: 100000, isVoided: true },
          { total: 200000, isVoided: true },
        ],
      });

      const result = calculateCommission(input);

      expect(result.ordersConsidered).toBe(0);
      expect(result.totalRevenue).toBe(0);
      expect(result.totalCommission).toBe(0);
    });

    it('returns zero commission when there are no orders', () => {
      const input = makeInput({
        rule: { type: 'percentage', value: 0.05 },
        completedOrders: [],
      });

      const result = calculateCommission(input);

      expect(result.ordersConsidered).toBe(0);
      expect(result.totalRevenue).toBe(0);
      expect(result.totalCommission).toBe(0);
    });
  });

  describe('percentage commission', () => {
    it('calculates commission as percentage of revenue', () => {
      const input = makeInput({
        rule: { type: 'percentage', value: 0.05 },
        completedOrders: [
          { total: 200000, isVoided: false },
          { total: 300000, isVoided: false },
        ],
      });

      const result = calculateCommission(input);

      expect(result.totalRevenue).toBe(500000);
      expect(result.totalCommission).toBe(25000); // 500000 * 0.05
      expect(result.ordersConsidered).toBe(2);
    });

    it('handles zero percentage', () => {
      const input = makeInput({
        rule: { type: 'percentage', value: 0 },
        completedOrders: [{ total: 500000, isVoided: false }],
      });

      const result = calculateCommission(input);

      expect(result.totalCommission).toBe(0);
      expect(result.totalRevenue).toBe(500000);
    });

    it('handles 100% commission', () => {
      const input = makeInput({
        rule: { type: 'percentage', value: 1.0 },
        completedOrders: [{ total: 100000, isVoided: false }],
      });

      const result = calculateCommission(input);

      expect(result.totalCommission).toBe(100000);
    });
  });

  describe('per-order fixed commission', () => {
    it('calculates commission as fixed amount per order', () => {
      const input = makeInput({
        rule: { type: 'per_order', value: 5000 },
        completedOrders: [
          { total: 100000, isVoided: false },
          { total: 200000, isVoided: false },
          { total: 150000, isVoided: false },
        ],
      });

      const result = calculateCommission(input);

      expect(result.ordersConsidered).toBe(3);
      expect(result.totalCommission).toBe(15000); // 3 * 5000
    });

    it('per-order commission is independent of order amounts', () => {
      const input = makeInput({
        rule: { type: 'per_order', value: 10000 },
        completedOrders: [
          { total: 50000, isVoided: false },
          { total: 5000000, isVoided: false },
        ],
      });

      const result = calculateCommission(input);

      expect(result.totalCommission).toBe(20000); // 2 * 10000
    });

    it('excludes voided orders from per-order count', () => {
      const input = makeInput({
        rule: { type: 'per_order', value: 5000 },
        completedOrders: [
          { total: 100000, isVoided: false },
          { total: 200000, isVoided: true },
          { total: 150000, isVoided: false },
        ],
      });

      const result = calculateCommission(input);

      expect(result.ordersConsidered).toBe(2);
      expect(result.totalCommission).toBe(10000); // 2 * 5000
    });
  });

  describe('tiered commission', () => {
    const tieredRule: CommissionRule = {
      type: 'tiered',
      tiers: [
        { minRevenue: 0, percentage: 0.03 }, // 3% for 0+
        { minRevenue: 500000, percentage: 0.05 }, // 5% for 500k+
        { minRevenue: 1000000, percentage: 0.08 }, // 8% for 1M+
      ],
    };

    it('applies lowest tier for low revenue', () => {
      const input = makeInput({
        rule: tieredRule,
        completedOrders: [{ total: 200000, isVoided: false }],
      });

      const result = calculateCommission(input);

      expect(result.totalRevenue).toBe(200000);
      expect(result.totalCommission).toBe(6000); // 200000 * 0.03
    });

    it('applies middle tier when revenue exceeds threshold', () => {
      const input = makeInput({
        rule: tieredRule,
        completedOrders: [
          { total: 300000, isVoided: false },
          { total: 300000, isVoided: false },
        ],
      });

      const result = calculateCommission(input);

      expect(result.totalRevenue).toBe(600000);
      expect(result.totalCommission).toBe(30000); // 600000 * 0.05
    });

    it('applies highest tier for high revenue', () => {
      const input = makeInput({
        rule: tieredRule,
        completedOrders: [
          { total: 500000, isVoided: false },
          { total: 600000, isVoided: false },
        ],
      });

      const result = calculateCommission(input);

      expect(result.totalRevenue).toBe(1100000);
      expect(result.totalCommission).toBe(88000); // 1100000 * 0.08
    });

    it('applies tier at exact boundary', () => {
      const input = makeInput({
        rule: tieredRule,
        completedOrders: [{ total: 500000, isVoided: false }],
      });

      const result = calculateCommission(input);

      expect(result.totalRevenue).toBe(500000);
      expect(result.totalCommission).toBe(25000); // 500000 * 0.05
    });

    it('returns zero when no tiers apply (empty tiers array)', () => {
      const input = makeInput({
        rule: { type: 'tiered', tiers: [] },
        completedOrders: [{ total: 500000, isVoided: false }],
      });

      const result = calculateCommission(input);

      expect(result.totalCommission).toBe(0);
    });

    it('returns zero when revenue is below all tier thresholds', () => {
      const input = makeInput({
        rule: {
          type: 'tiered',
          tiers: [
            { minRevenue: 1000000, percentage: 0.05 },
            { minRevenue: 2000000, percentage: 0.1 },
          ],
        },
        completedOrders: [{ total: 500000, isVoided: false }],
      });

      const result = calculateCommission(input);

      expect(result.totalRevenue).toBe(500000);
      expect(result.totalCommission).toBe(0);
    });

    it('applies highest tier percentage to total revenue (not incremental)', () => {
      // Verify it's "find highest applicable tier" not progressive/incremental
      const input = makeInput({
        rule: {
          type: 'tiered',
          tiers: [
            { minRevenue: 0, percentage: 0.02 },
            { minRevenue: 100000, percentage: 0.05 },
          ],
        },
        completedOrders: [{ total: 150000, isVoided: false }],
      });

      const result = calculateCommission(input);

      // Entire revenue * highest applicable tier percentage
      expect(result.totalCommission).toBe(7500); // 150000 * 0.05, NOT (100000*0.02 + 50000*0.05)
    });
  });

  describe('revenue and order count tracking', () => {
    it('correctly tallies totalRevenue from non-voided orders', () => {
      const input = makeInput({
        rule: { type: 'percentage', value: 0.1 },
        completedOrders: [
          { total: 75000, isVoided: false },
          { total: 125000, isVoided: false },
          { total: 50000, isVoided: true },
        ],
      });

      const result = calculateCommission(input);

      expect(result.totalRevenue).toBe(200000);
      expect(result.ordersConsidered).toBe(2);
    });

    it('handles single order correctly', () => {
      const input = makeInput({
        rule: { type: 'per_order', value: 3000 },
        completedOrders: [{ total: 250000, isVoided: false }],
      });

      const result = calculateCommission(input);

      expect(result.ordersConsidered).toBe(1);
      expect(result.totalRevenue).toBe(250000);
      expect(result.totalCommission).toBe(3000);
    });
  });
});
