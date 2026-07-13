import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { checkVoidAuthorization, VoidAuthorizationInput } from './void-authorization';
import { Role } from '../enums';
import {
  ERR_VOID_REASON_REQUIRED,
  ERR_VOID_PIN_REQUIRED,
  ERR_VOID_PIN_INVALID,
} from '../error-codes';

/**
 * Property-based tests for void authorization rules.
 *
 * **Validates: Requirements 21.1, 21.2, 21.3**
 */

// --- Arbitrary Generators ---

/** Generates a non-TenantOwner role */
const arbNonOwnerRole: fc.Arbitrary<Role> = fc.constantFrom(
  Role.PlatformSuperAdmin,
  Role.OutletAdmin,
  Role.Cashier,
);

/** Generates any valid role */
const arbRole: fc.Arbitrary<Role> = fc.constantFrom(
  Role.PlatformSuperAdmin,
  Role.TenantOwner,
  Role.OutletAdmin,
  Role.Cashier,
);

/** Generates a non-empty reason string (at least one non-whitespace character) */
const arbNonEmptyReason: fc.Arbitrary<string> = fc
  .tuple(
    fc.string({ minLength: 0, maxLength: 10 }),
    fc.string({ unit: fc.string({ unit: 'binary-ascii', minLength: 1, maxLength: 1 }).filter((c) => c.trim().length > 0), minLength: 1, maxLength: 50 }),
    fc.string({ minLength: 0, maxLength: 10 }),
  )
  .map(([prefix, core, suffix]) => `${prefix}${core}${suffix}`);

/** Generates an empty or whitespace-only reason */
const arbEmptyReason: fc.Arbitrary<string> = fc.constantFrom('', ' ', '  ', '\t', '\n', '  \t\n  ');

/** Generates a valid ISO datetime string within a reasonable range */
const arbIsoDateTime: fc.Arbitrary<string> = fc
  .record({
    year: fc.integer({ min: 2020, max: 2030 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
    hour: fc.integer({ min: 0, max: 23 }),
    minute: fc.integer({ min: 0, max: 59 }),
    second: fc.integer({ min: 0, max: 59 }),
  })
  .map(
    ({ year, month, day, hour, minute, second }) =>
      `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.000Z`,
  );

/** Generates a free void window in minutes (0 to 60) */
const arbFreeVoidWindow: fc.Arbitrary<number> = fc.integer({ min: 0, max: 60 });

/** Generates a valid 6-digit PIN string */
const arbValidPin: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: 999999 })
  .map((n) => String(n).padStart(6, '0'));

/** Generates an invalid PIN (wrong length or non-numeric) */
const arbInvalidFormatPin: fc.Arbitrary<string> = fc.oneof(
  // Too short
  fc.integer({ min: 0, max: 99999 }).map((n) => String(n).padStart(5, '0')),
  // Too long
  fc.integer({ min: 0, max: 9999999 }).map((n) => String(n).padStart(7, '0')),
  // Non-numeric
  fc.string({ minLength: 6, maxLength: 6 }).filter((s) => !/^\d{6}$/.test(s)),
);

/**
 * Generates a pair of (orderCreatedAt, currentTime) such that
 * elapsed minutes <= freeVoidWindowMinutes.
 */
function arbTimesWithinWindow(freeVoidWindowMinutes: number): fc.Arbitrary<{ orderCreatedAt: string; currentTime: string }> {
  return fc
    .tuple(
      arbIsoDateTime,
      fc.integer({ min: 0, max: Math.max(0, freeVoidWindowMinutes) * 60 }), // elapsed seconds
    )
    .map(([baseTime, elapsedSeconds]) => {
      const orderDate = new Date(baseTime);
      const currentDate = new Date(orderDate.getTime() + elapsedSeconds * 1000);
      return {
        orderCreatedAt: orderDate.toISOString(),
        currentTime: currentDate.toISOString(),
      };
    });
}

/**
 * Generates a pair of (orderCreatedAt, currentTime) such that
 * elapsed minutes > freeVoidWindowMinutes (strictly after window).
 */
function arbTimesAfterWindow(freeVoidWindowMinutes: number): fc.Arbitrary<{ orderCreatedAt: string; currentTime: string }> {
  return fc
    .tuple(
      arbIsoDateTime,
      fc.integer({ min: freeVoidWindowMinutes * 60 + 1, max: freeVoidWindowMinutes * 60 + 86400 }), // 1 second past window up to 24h
    )
    .map(([baseTime, elapsedSeconds]) => {
      const orderDate = new Date(baseTime);
      const currentDate = new Date(orderDate.getTime() + elapsedSeconds * 1000);
      return {
        orderCreatedAt: orderDate.toISOString(),
        currentTime: currentDate.toISOString(),
      };
    });
}

/** PIN verifier that accepts a specific known PIN */
const KNOWN_VALID_PIN = '123456';
const verifyPin = (pin: string) => pin === KNOWN_VALID_PIN;

/** PIN verifier that always rejects */
const alwaysRejectPin = () => false;

// --- Property Tests ---

describe('Void Authorization Rules - Property-Based Tests', () => {
  describe('Property 15: Void Authorization Rules', () => {
    it('TenantOwner bypass: for any TenantOwner with non-empty reason, always authorized without PIN', () => {
      fc.assert(
        fc.property(
          arbNonEmptyReason,
          arbIsoDateTime,
          arbFreeVoidWindow,
          fc.option(arbValidPin, { nil: undefined }),
          (reason, baseTime, freeVoidWindowMinutes, adminPin) => {
            // Generate a currentTime that could be anywhere (before or after window)
            const orderDate = new Date(baseTime);
            const currentDate = new Date(orderDate.getTime() + Math.random() * 86400000);

            const input: VoidAuthorizationInput = {
              role: Role.TenantOwner,
              reason,
              adminPin,
              orderCreatedAt: orderDate.toISOString(),
              currentTime: currentDate.toISOString(),
              freeVoidWindowMinutes,
            };

            const result = checkVoidAuthorization(input, alwaysRejectPin);

            expect(result.authorized).toBe(true);
            expect(result.requiresPin).toBe(false);
            expect(result.error).toBeUndefined();
          },
        ),
        { numRuns: 500 },
      );
    });

    it('Empty reason rejection: for any role with empty/whitespace reason, always unauthorized', () => {
      fc.assert(
        fc.property(
          arbRole,
          arbEmptyReason,
          arbIsoDateTime,
          arbFreeVoidWindow,
          fc.option(arbValidPin, { nil: undefined }),
          (role, reason, baseTime, freeVoidWindowMinutes, adminPin) => {
            const orderDate = new Date(baseTime);
            const currentDate = new Date(orderDate.getTime() + 60000); // 1 min later

            const input: VoidAuthorizationInput = {
              role,
              reason,
              adminPin,
              orderCreatedAt: orderDate.toISOString(),
              currentTime: currentDate.toISOString(),
              freeVoidWindowMinutes,
            };

            const result = checkVoidAuthorization(input, verifyPin);

            expect(result.authorized).toBe(false);
            expect(result.error?.code).toBe(ERR_VOID_REASON_REQUIRED);
          },
        ),
        { numRuns: 500 },
      );
    });

    it('Within free window: non-TenantOwner when elapsed <= freeVoidWindowMinutes and reason non-empty → authorized without PIN', () => {
      fc.assert(
        fc.property(
          arbNonOwnerRole,
          arbNonEmptyReason,
          fc.integer({ min: 0, max: 60 }),
          (role, reason, freeVoidWindowMinutes) => {
            return fc.assert(
              fc.property(
                arbTimesWithinWindow(freeVoidWindowMinutes),
                ({ orderCreatedAt, currentTime }) => {
                  const input: VoidAuthorizationInput = {
                    role,
                    reason,
                    adminPin: undefined,
                    orderCreatedAt,
                    currentTime,
                    freeVoidWindowMinutes,
                  };

                  const result = checkVoidAuthorization(input, alwaysRejectPin);

                  expect(result.authorized).toBe(true);
                  expect(result.requiresPin).toBe(false);
                  expect(result.error).toBeUndefined();
                },
              ),
              { numRuns: 50 },
            );
          },
        ),
        { numRuns: 10 },
      );
    });

    it('After free window without PIN: non-TenantOwner when elapsed > freeVoidWindowMinutes and no PIN → unauthorized with ERR_VOID_PIN_REQUIRED', () => {
      fc.assert(
        fc.property(
          arbNonOwnerRole,
          arbNonEmptyReason,
          fc.integer({ min: 0, max: 60 }),
          (role, reason, freeVoidWindowMinutes) => {
            return fc.assert(
              fc.property(
                arbTimesAfterWindow(freeVoidWindowMinutes),
                ({ orderCreatedAt, currentTime }) => {
                  const input: VoidAuthorizationInput = {
                    role,
                    reason,
                    adminPin: undefined,
                    orderCreatedAt,
                    currentTime,
                    freeVoidWindowMinutes,
                  };

                  const result = checkVoidAuthorization(input, verifyPin);

                  expect(result.authorized).toBe(false);
                  expect(result.requiresPin).toBe(true);
                  expect(result.error?.code).toBe(ERR_VOID_PIN_REQUIRED);
                },
              ),
              { numRuns: 50 },
            );
          },
        ),
        { numRuns: 10 },
      );
    });

    it('After free window with valid PIN: non-TenantOwner after window with valid PIN → authorized', () => {
      fc.assert(
        fc.property(
          arbNonOwnerRole,
          arbNonEmptyReason,
          fc.integer({ min: 0, max: 60 }),
          (role, reason, freeVoidWindowMinutes) => {
            return fc.assert(
              fc.property(
                arbTimesAfterWindow(freeVoidWindowMinutes),
                ({ orderCreatedAt, currentTime }) => {
                  const input: VoidAuthorizationInput = {
                    role,
                    reason,
                    adminPin: KNOWN_VALID_PIN,
                    orderCreatedAt,
                    currentTime,
                    freeVoidWindowMinutes,
                  };

                  const result = checkVoidAuthorization(input, verifyPin);

                  expect(result.authorized).toBe(true);
                  expect(result.requiresPin).toBe(true);
                  expect(result.error).toBeUndefined();
                },
              ),
              { numRuns: 50 },
            );
          },
        ),
        { numRuns: 10 },
      );
    });

    it('After free window with invalid PIN: non-TenantOwner after window with invalid PIN → unauthorized with ERR_VOID_PIN_INVALID', () => {
      fc.assert(
        fc.property(
          arbNonOwnerRole,
          arbNonEmptyReason,
          fc.integer({ min: 0, max: 60 }),
          arbValidPin.filter((pin) => pin !== KNOWN_VALID_PIN),
          (role, reason, freeVoidWindowMinutes, invalidPinValue) => {
            return fc.assert(
              fc.property(
                arbTimesAfterWindow(freeVoidWindowMinutes),
                ({ orderCreatedAt, currentTime }) => {
                  const input: VoidAuthorizationInput = {
                    role,
                    reason,
                    adminPin: invalidPinValue,
                    orderCreatedAt,
                    currentTime,
                    freeVoidWindowMinutes,
                  };

                  const result = checkVoidAuthorization(input, alwaysRejectPin);

                  expect(result.authorized).toBe(false);
                  expect(result.requiresPin).toBe(true);
                  expect(result.error?.code).toBe(ERR_VOID_PIN_INVALID);
                },
              ),
              { numRuns: 50 },
            );
          },
        ),
        { numRuns: 10 },
      );
    });
  });
});
