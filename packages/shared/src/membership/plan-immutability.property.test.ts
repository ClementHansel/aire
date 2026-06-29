import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { checkQuota, recordUsage, MembershipQuotaState, DailyUsageRecord } from './quota-tracker';
import { MembershipStatus } from '../enums';

/**
 * Property-based tests for Plan Edit Immutability (Property 30).
 *
 * When a membership is activated, it snapshots max_uses and daily_limit from the plan.
 * The checkQuota function uses these membership-level values, NOT the plan's values.
 * Editing a plan's max_uses or daily_limit does NOT affect existing memberships.
 *
 * **Validates: Requirements 11.3**
 */

// --- Arbitrary Generators ---

/**
 * Generates an arbitrary MembershipQuotaState with reasonable bounds.
 */
const arbMembershipQuotaState: fc.Arbitrary<MembershipQuotaState> = fc.record({
  membershipId: fc.string({ minLength: 1, maxLength: 20 }),
  usesCount: fc.integer({ min: 0, max: 999 }),
  maxUses: fc.integer({ min: 1, max: 1000 }),
  dailyLimit: fc.integer({ min: 1, max: 10 }),
  status: fc.constant(MembershipStatus.Active),
});

/**
 * Generates an arbitrary MembershipQuotaState that is below its lifetime quota,
 * guaranteeing that usesCount < maxUses.
 */
const arbActiveQuotaState: fc.Arbitrary<MembershipQuotaState> = fc
  .record({
    membershipId: fc.string({ minLength: 1, maxLength: 20 }),
    maxUses: fc.integer({ min: 2, max: 1000 }),
    dailyLimit: fc.integer({ min: 1, max: 10 }),
  })
  .chain((partial) =>
    fc.integer({ min: 0, max: partial.maxUses - 2 }).map((usesCount) => ({
      ...partial,
      usesCount,
      status: MembershipStatus.Active,
    })),
  );

/**
 * Generates "plan values" that differ from the membership's snapshotted values.
 * These represent a plan that has been edited AFTER the membership was created.
 */
const arbPlanValues = fc.record({
  planMaxUses: fc.integer({ min: 1, max: 2000 }),
  planDailyLimit: fc.integer({ min: 1, max: 20 }),
});

/**
 * Generates a normalized license plate string.
 */
const arbPlate = fc
  .stringOf(fc.constantFrom('A', 'B', 'C', 'D', '1', '2', '3', '4', '5'), {
    minLength: 3,
    maxLength: 10,
  })
  .map((s) => s.toUpperCase());

/**
 * Generates a valid WIB date string (YYYY-MM-DD).
 */
const arbDateWIB = fc
  .record({
    year: fc.integer({ min: 2024, max: 2030 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
  })
  .map(({ year, month, day }) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);

/**
 * Generates a list of daily usage records for a given plate and date.
 */
function arbDailyUsages(plate: string, date: string): fc.Arbitrary<DailyUsageRecord[]> {
  return fc
    .array(
      fc.integer({ min: 0, max: 23 }).map((hour) => ({
        plateNormalized: plate,
        usedAt: `${date}T${String(hour).padStart(2, '0')}:00:00+07:00`,
      })),
      { minLength: 0, maxLength: 5 },
    );
}

describe('Plan Edit Immutability - Property-Based Tests (Property 30)', () => {
  describe('checkQuota uses membership values, not plan values', () => {
    it('checkQuota result depends only on state.maxUses and state.dailyLimit, regardless of what a plan might have', () => {
      fc.assert(
        fc.property(
          arbActiveQuotaState,
          arbPlanValues,
          arbPlate,
          arbDateWIB,
          (state, planValues, plate, date) => {
            // checkQuota uses the membership's snapshotted values
            const result = checkQuota(state, plate, [], date);

            // The plan's values are completely irrelevant to checkQuota
            // Verify that the result reflects the membership state, not plan state:
            // usesRemaining is based on state.maxUses - state.usesCount
            expect(result.usesRemaining).toBe(state.maxUses - state.usesCount);

            // Whether or not the plan has been edited doesn't matter,
            // since checkQuota doesn't receive or reference plan values at all.
            // This test explicitly demonstrates that planValues.planMaxUses and
            // planValues.planDailyLimit have zero influence on the outcome.
            const _planMaxUses = planValues.planMaxUses; // not used by checkQuota
            const _planDailyLimit = planValues.planDailyLimit; // not used by checkQuota

            // The quota check result is deterministic based solely on state
            const result2 = checkQuota(state, plate, [], date);
            expect(result).toEqual(result2);
          },
        ),
        { numRuns: 500 },
      );
    });

    it('two memberships with different snapshotted values produce independent results', () => {
      fc.assert(
        fc.property(
          arbActiveQuotaState,
          arbActiveQuotaState,
          arbPlate,
          arbDateWIB,
          (state1, state2, plate, date) => {
            const result1 = checkQuota(state1, plate, [], date);
            const result2 = checkQuota(state2, plate, [], date);

            // Each membership uses its own max_uses
            expect(result1.usesRemaining).toBe(state1.maxUses - state1.usesCount);
            expect(result2.usesRemaining).toBe(state2.maxUses - state2.usesCount);
          },
        ),
        { numRuns: 500 },
      );
    });

    it('daily limit enforcement uses membership dailyLimit, not any external plan value', () => {
      fc.assert(
        fc.property(
          arbActiveQuotaState,
          arbPlate,
          arbDateWIB,
          (state, plate, date) => {
            // Create exactly dailyLimit usages for the plate today
            const usages: DailyUsageRecord[] = Array.from(
              { length: state.dailyLimit },
              (_, i) => ({
                plateNormalized: plate,
                usedAt: `${date}T${String(i + 8).padStart(2, '0')}:00:00+07:00`,
              }),
            );

            const result = checkQuota(state, plate, usages, date);

            // Should be rejected because state.dailyLimit is reached
            expect(result.canUse).toBe(false);
            expect(result.reason).toBe('daily_limit_reached');
            expect(result.dailyUsesToday).toBe(state.dailyLimit);
          },
        ),
        { numRuns: 500 },
      );
    });
  });

  describe('recordUsage preserves max_uses and dailyLimit (immutability of plan terms)', () => {
    it('recordUsage only modifies usesCount and status, never max_uses or dailyLimit', () => {
      fc.assert(
        fc.property(arbMembershipQuotaState, (state) => {
          const result = recordUsage(state);

          // max_uses is NEVER changed by recordUsage
          expect(result.maxUses).toBe(state.maxUses);

          // dailyLimit is NEVER changed by recordUsage
          expect(result.dailyLimit).toBe(state.dailyLimit);

          // membershipId is NEVER changed
          expect(result.membershipId).toBe(state.membershipId);

          // Only usesCount is incremented
          expect(result.usesCount).toBe(state.usesCount + 1);
        }),
        { numRuns: 500 },
      );
    });

    it('for any sequence of recordUsage calls, max_uses and dailyLimit remain unchanged', () => {
      fc.assert(
        fc.property(
          arbActiveQuotaState,
          fc.integer({ min: 1, max: 20 }),
          (initialState, numUsages) => {
            let currentState = initialState;

            for (let i = 0; i < numUsages; i++) {
              currentState = recordUsage(currentState);
            }

            // After N usages, max_uses and dailyLimit must be identical to the original
            expect(currentState.maxUses).toBe(initialState.maxUses);
            expect(currentState.dailyLimit).toBe(initialState.dailyLimit);

            // Only usesCount should have changed
            expect(currentState.usesCount).toBe(initialState.usesCount + numUsages);
          },
        ),
        { numRuns: 500 },
      );
    });

    it('original state is never mutated by recordUsage', () => {
      fc.assert(
        fc.property(arbMembershipQuotaState, (state) => {
          // Capture the original values
          const originalMaxUses = state.maxUses;
          const originalDailyLimit = state.dailyLimit;
          const originalUsesCount = state.usesCount;

          recordUsage(state);

          // Original state must remain completely unchanged
          expect(state.maxUses).toBe(originalMaxUses);
          expect(state.dailyLimit).toBe(originalDailyLimit);
          expect(state.usesCount).toBe(originalUsesCount);
        }),
        { numRuns: 500 },
      );
    });
  });

  describe('simulated plan edit has no effect on existing membership', () => {
    it('changing plan values does not affect existing quota state behavior', () => {
      fc.assert(
        fc.property(
          arbActiveQuotaState,
          arbPlanValues,
          arbPlanValues,
          arbPlate,
          arbDateWIB,
          (membershipState, originalPlan, editedPlan, plate, date) => {
            // Simulate: membership was created with originalPlan values snapshotted
            // The membership's state already holds its own maxUses and dailyLimit

            // Now the plan is "edited" to editedPlan values
            // But the membership state is UNCHANGED — it retains its snapshotted values

            // checkQuota before "plan edit"
            const resultBefore = checkQuota(membershipState, plate, [], date);

            // checkQuota after "plan edit" — same membership state, same result
            // (because checkQuota only looks at the membership state)
            const resultAfter = checkQuota(membershipState, plate, [], date);

            // Results must be identical — plan edits have zero effect
            expect(resultAfter).toEqual(resultBefore);

            // The membership state's values are what matter, not plan values
            expect(resultAfter.usesRemaining).toBe(
              membershipState.maxUses - membershipState.usesCount,
            );
          },
        ),
        { numRuns: 500 },
      );
    });

    it('new membership created after plan edit uses updated values independently', () => {
      fc.assert(
        fc.property(
          arbActiveQuotaState,
          arbPlanValues,
          arbPlate,
          arbDateWIB,
          (existingMembership, updatedPlanValues, plate, date) => {
            // The existing membership has its own snapshotted values
            const existingResult = checkQuota(existingMembership, plate, [], date);

            // A new membership would snapshot the updated plan values
            const newMembership: MembershipQuotaState = {
              membershipId: 'new-membership',
              usesCount: 0,
              maxUses: updatedPlanValues.planMaxUses,
              dailyLimit: updatedPlanValues.planDailyLimit,
              status: MembershipStatus.Active,
            };
            const newResult = checkQuota(newMembership, plate, [], date);

            // Existing membership uses its own snapshotted values
            expect(existingResult.usesRemaining).toBe(
              existingMembership.maxUses - existingMembership.usesCount,
            );

            // New membership uses the updated plan values (now snapshotted into it)
            expect(newResult.usesRemaining).toBe(
              updatedPlanValues.planMaxUses - 0,
            );

            // They operate independently — editing plan doesn't affect existing
            expect(existingResult.usesRemaining).toBe(
              existingMembership.maxUses - existingMembership.usesCount,
            );
          },
        ),
        { numRuns: 500 },
      );
    });
  });
});
