import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { assignCustomerTags, OrderContext, CustomerTag } from './index';

/**
 * Property-based tests for customer type tagging correctness.
 *
 * **Validates: Requirements 22.1, 22.2, 22.4**
 */

// --- Arbitrary Generators ---

/**
 * Generates an arbitrary OrderContext with all boolean combinations.
 */
const arbOrderContext: fc.Arbitrary<OrderContext> = fc.record({
  hasVoucherPackPurchase: fc.boolean(),
  hasNewMembership: fc.boolean(),
  hasMembershipRenewal: fc.boolean(),
  hasVoucherRedemption: fc.boolean(),
  hasMemberBenefitsApplied: fc.boolean(),
});

/**
 * All valid customer tag values.
 */
const VALID_TAGS: CustomerTag[] = [
  'regular',
  'member',
  'voucher',
  'new_member',
  'renewal',
  'buy_voucher_pack',
];

/**
 * Checks if any non-regular condition is true in the context.
 */
function hasAnyCondition(ctx: OrderContext): boolean {
  return (
    ctx.hasVoucherPackPurchase ||
    ctx.hasNewMembership ||
    ctx.hasMembershipRenewal ||
    ctx.hasVoucherRedemption ||
    ctx.hasMemberBenefitsApplied
  );
}

describe('Customer Type Tagging Correctness - Property-Based Tests', () => {
  describe('Property 16: Customer Type Tagging Correctness', () => {
    it('non-empty: assignCustomerTags always returns at least one tag', () => {
      fc.assert(
        fc.property(arbOrderContext, (context) => {
          const tags = assignCustomerTags(context);
          expect(tags.length).toBeGreaterThanOrEqual(1);
        }),
        { numRuns: 500 },
      );
    });

    it('regular exclusivity: "regular" is assigned iff no other condition is true', () => {
      fc.assert(
        fc.property(arbOrderContext, (context) => {
          const tags = assignCustomerTags(context);
          const hasNonRegularCondition = hasAnyCondition(context);

          if (hasNonRegularCondition) {
            // When any condition is true, 'regular' must NOT be present
            expect(tags).not.toContain('regular');
          } else {
            // When no condition is true, 'regular' MUST be present (and be the only tag)
            expect(tags).toContain('regular');
            expect(tags).toHaveLength(1);
          }
        }),
        { numRuns: 500 },
      );
    });

    it('tag-condition correspondence: each non-regular tag is present iff its corresponding condition is true', () => {
      fc.assert(
        fc.property(arbOrderContext, (context) => {
          const tags = assignCustomerTags(context);

          // Each condition maps to exactly one tag
          const conditionTagPairs: [boolean, CustomerTag][] = [
            [context.hasVoucherPackPurchase, 'buy_voucher_pack'],
            [context.hasNewMembership, 'new_member'],
            [context.hasMembershipRenewal, 'renewal'],
            [context.hasVoucherRedemption, 'voucher'],
            [context.hasMemberBenefitsApplied, 'member'],
          ];

          for (const [condition, tag] of conditionTagPairs) {
            if (condition) {
              expect(tags).toContain(tag);
            } else {
              expect(tags).not.toContain(tag);
            }
          }
        }),
        { numRuns: 500 },
      );
    });

    it('no duplicates: result array never contains duplicate tags', () => {
      fc.assert(
        fc.property(arbOrderContext, (context) => {
          const tags = assignCustomerTags(context);
          const unique = new Set(tags);
          expect(unique.size).toBe(tags.length);
        }),
        { numRuns: 500 },
      );
    });

    it('all valid: every returned tag is a valid CustomerTag value', () => {
      fc.assert(
        fc.property(arbOrderContext, (context) => {
          const tags = assignCustomerTags(context);
          for (const tag of tags) {
            expect(VALID_TAGS).toContain(tag);
          }
        }),
        { numRuns: 500 },
      );
    });

    it('deterministic: same input always produces same output', () => {
      fc.assert(
        fc.property(arbOrderContext, (context) => {
          const tags1 = assignCustomerTags(context);
          const tags2 = assignCustomerTags(context);
          expect(tags1).toEqual(tags2);
        }),
        { numRuns: 500 },
      );
    });
  });
});
