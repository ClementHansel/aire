import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { checkQuota, recordUsage, MembershipQuotaState, DailyUsageRecord } from './quota-tracker';
import { MembershipStatus } from '../enums';

/**
 * Property-based tests for membership quota integrity.
 *
 * **Validates: Requirements 13.1, 13.2, 13.3, 13.4**
 */

// --- Arbitrary Generators ---

/** Generates a valid WIB date string (YYYY-MM-DD) */
const arbDateWIB: fc.Arbitrary<string> = fc
  .record({
    year: fc.integer({ min: 2020, max: 2030 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
  })
  .map(({ year, month, day }) => {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  });

/** Generates a normalized license plate (uppercase, no spaces) */
const arbPlate: fc.Arbitrary<string> = fc
  .tuple(
    fc.string({ unit: fc.constantFrom('A', 'B', 'D', 'F', 'H', 'L', 'N'), minLength: 1, maxLength: 2 }),
    fc.string({ unit: fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), minLength: 1,
      maxLength: 4, }),
    fc.string({ unit: fc.constantFrom('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'), minLength: 1,
      maxLength: 3, }),
  )
  .map(([prefix, digits, suffix]) => `${prefix}${digits}${suffix}`);

/** Generates a MembershipQuotaState with valid constraints */
const arbMembershipState: fc.Arbitrary<MembershipQuotaState> = fc
  .record({
    membershipId: fc.uuid(),
    maxUses: fc.integer({ min: 1, max: 200 }),
    dailyLimit: fc.integer({ min: 1, max: 10 }),
  })
  .chain(({ membershipId, maxUses, dailyLimit }) =>
    fc
      .integer({ min: 0, max: maxUses + 5 }) // allow usesCount to exceed maxUses (edge case)
      .map((usesCount) => ({
        membershipId,
        usesCount,
        maxUses,
        dailyLimit,
        status: MembershipStatus.Active,
      })),
  );

/**
 * Generates daily usage records for a given plate and date.
 * All records match the plate and date, simulating "today's usages".
 */
function arbTodayUsagesForPlate(plate: string, dateWIB: string): fc.Arbitrary<DailyUsageRecord[]> {
  return fc
    .array(
      fc.integer({ min: 0, max: 23 }).map((hour) => ({
        plateNormalized: plate,
        usedAt: `${dateWIB}T${String(hour).padStart(2, '0')}:00:00+07:00`,
      })),
      { minLength: 0, maxLength: 15 },
    );
}

/**
 * Generates a set of daily usage records that may include records from
 * different dates and plates to test filtering.
 */
function arbMixedUsages(
  plate: string,
  dateWIB: string,
  todayCount: number,
): fc.Arbitrary<DailyUsageRecord[]> {
  const todayRecords: DailyUsageRecord[] = Array.from({ length: todayCount }, (_, i) => ({
    plateNormalized: plate,
    usedAt: `${dateWIB}T${String(8 + i).padStart(2, '0')}:00:00+07:00`,
  }));

  return fc
    .array(
      fc.tuple(arbPlate, arbDateWIB, fc.integer({ min: 0, max: 23 })).map(([p, d, h]) => ({
        plateNormalized: p,
        usedAt: `${d}T${String(h).padStart(2, '0')}:00:00+07:00`,
      })),
      { minLength: 0, maxLength: 5 },
    )
    .map((noise) => [...todayRecords, ...noise]);
}

// --- Property Tests ---

describe('Membership Quota Integrity - Property-Based Tests', () => {
  describe('Property 9: Membership Quota Integrity', () => {
    it('(a) Daily limit: if dailyUsesToday >= dailyLimit, then canUse === false with reason daily_limit_reached', () => {
      fc.assert(
        fc.property(
          arbMembershipState,
          arbPlate,
          arbDateWIB,
          (state, plate, dateWIB) => {
            // Only test states where lifetime quota is NOT exhausted
            // (otherwise quota_exhausted takes priority)
            fc.pre(state.usesCount < state.maxUses);

            // Generate exactly dailyLimit usages for this plate today
            const usages: DailyUsageRecord[] = Array.from(
              { length: state.dailyLimit },
              (_, i) => ({
                plateNormalized: plate,
                usedAt: `${dateWIB}T${String(8 + i).padStart(2, '0')}:00:00+07:00`,
              }),
            );

            const result = checkQuota(state, plate, usages, dateWIB);

            expect(result.canUse).toBe(false);
            expect(result.reason).toBe('daily_limit_reached');
            expect(result.dailyUsesToday).toBeGreaterThanOrEqual(state.dailyLimit);
          },
        ),
        { numRuns: 500 },
      );
    });

    it('(b) Lifetime cap: if usesCount >= maxUses, then canUse === false with reason quota_exhausted', () => {
      fc.assert(
        fc.property(
          fc.record({
            membershipId: fc.uuid(),
            maxUses: fc.integer({ min: 1, max: 200 }),
            dailyLimit: fc.integer({ min: 1, max: 10 }),
          }).chain(({ membershipId, maxUses, dailyLimit }) =>
            fc
              .integer({ min: maxUses, max: maxUses + 50 }) // usesCount >= maxUses
              .map((usesCount) => ({
                membershipId,
                usesCount,
                maxUses,
                dailyLimit,
                status: MembershipStatus.Active,
              })),
          ),
          arbPlate,
          arbDateWIB,
          (state, plate, dateWIB) => {
            const result = checkQuota(state, plate, [], dateWIB);

            expect(result.canUse).toBe(false);
            expect(result.reason).toBe('quota_exhausted');
            expect(result.usesRemaining).toBe(0);
            expect(result.shouldExpire).toBe(true);
          },
        ),
        { numRuns: 500 },
      );
    });

    it('(c) Expiry on exhaustion: recordUsage when usesCount + 1 >= maxUses sets status to expired', () => {
      fc.assert(
        fc.property(
          fc.record({
            membershipId: fc.uuid(),
            maxUses: fc.integer({ min: 1, max: 200 }),
            dailyLimit: fc.integer({ min: 1, max: 10 }),
          }).chain(({ membershipId, maxUses, dailyLimit }) =>
            // usesCount such that usesCount + 1 >= maxUses (i.e., usesCount >= maxUses - 1)
            fc
              .integer({ min: maxUses - 1, max: maxUses + 10 })
              .map((usesCount) => ({
                membershipId,
                usesCount,
                maxUses,
                dailyLimit,
                status: MembershipStatus.Active,
              })),
          ),
          (state) => {
            const result = recordUsage(state);

            expect(result.status).toBe(MembershipStatus.Expired);
          },
        ),
        { numRuns: 500 },
      );
    });

    it('(d) Daily reset: usages from a different date are not counted toward daily limit', () => {
      fc.assert(
        fc.property(
          arbMembershipState,
          arbPlate,
          arbDateWIB,
          (state, plate, todayDateWIB) => {
            // Only test states within lifetime limits
            fc.pre(state.usesCount < state.maxUses);

            // Create usages that are from a DIFFERENT date than todayDateWIB
            const differentDate = '1999-01-01'; // guaranteed different from any generated date
            const usagesFromOtherDay: DailyUsageRecord[] = Array.from(
              { length: state.dailyLimit + 5 }, // more than dailyLimit
              (_, i) => ({
                plateNormalized: plate,
                usedAt: `${differentDate}T${String(8 + (i % 16)).padStart(2, '0')}:00:00+07:00`,
              }),
            );

            const result = checkQuota(state, plate, usagesFromOtherDay, todayDateWIB);

            // Usages from different date should not count → daily uses today should be 0
            expect(result.dailyUsesToday).toBe(0);
            // Since quota is not exhausted and no today-usages, canUse should be true
            expect(result.canUse).toBe(true);
          },
        ),
        { numRuns: 500 },
      );
    });

    it('non-negativity: usesRemaining is always >= 0', () => {
      fc.assert(
        fc.property(
          arbMembershipState,
          arbPlate,
          arbDateWIB,
          fc.array(
            fc.tuple(arbPlate, arbDateWIB, fc.integer({ min: 0, max: 23 })).map(([p, d, h]) => ({
              plateNormalized: p,
              usedAt: `${d}T${String(h).padStart(2, '0')}:00:00+07:00`,
            })),
            { minLength: 0, maxLength: 10 },
          ),
          (state, plate, dateWIB, usages) => {
            const result = checkQuota(state, plate, usages, dateWIB);

            expect(result.usesRemaining).toBeGreaterThanOrEqual(0);
          },
        ),
        { numRuns: 500 },
      );
    });

    it('determinism: same input always produces the same output', () => {
      fc.assert(
        fc.property(
          arbMembershipState,
          arbPlate,
          arbDateWIB,
          fc.array(
            fc.tuple(arbPlate, arbDateWIB, fc.integer({ min: 0, max: 23 })).map(([p, d, h]) => ({
              plateNormalized: p,
              usedAt: `${d}T${String(h).padStart(2, '0')}:00:00+07:00`,
            })),
            { minLength: 0, maxLength: 10 },
          ),
          (state, plate, dateWIB, usages) => {
            const result1 = checkQuota(state, plate, usages, dateWIB);
            const result2 = checkQuota(state, plate, usages, dateWIB);

            expect(result1).toEqual(result2);

            // Also test recordUsage determinism
            const record1 = recordUsage(state);
            const record2 = recordUsage(state);

            expect(record1).toEqual(record2);
          },
        ),
        { numRuns: 500 },
      );
    });
  });
});
