import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { MembershipRenewalService } from './membership-renewal.service';
import { Membership } from './interfaces';
import { MembershipPlanService } from './membership-plan.service';

/**
 * Property-Based Test: Membership Renewal Date Logic (Property 17)
 *
 * **Validates: Requirements 15.1, 15.2**
 *
 * Properties:
 * - Same plan → extend end_date from expiry, retain start_date, no duplicate
 * - Different plan → new independent parallel membership
 * - Only ACTIVE memberships are considered for same-plan extension
 */

// --- Arbitraries ---

const uuidArbitrary = fc.uuid({ version: 4 });

/** Duration months as supported by plans: 1, 3, or 12 */
const durationMonthsArbitrary = fc.constantFrom(1, 3, 12);

/** A date in a reasonable range for membership dates */
const dateArbitrary = fc.date({
  min: new Date('2023-01-01'),
  max: new Date('2026-12-31'),
  noInvalidDate: true,
});

const membershipStatusArbitrary = fc.constantFrom(
  'active' as const,
  'expired' as const,
  'pending' as const,
  'cancelled' as const,
);

const nonActiveStatusArbitrary = fc.constantFrom(
  'expired' as const,
  'pending' as const,
  'cancelled' as const,
);

/** Generate an arbitrary membership plan */
const planArbitrary = fc.record({
  id: uuidArbitrary,
  tenantId: uuidArbitrary,
  name: fc.string({ minLength: 1, maxLength: 50 }),
  durationMonths: durationMonthsArbitrary,
  maxUses: fc.integer({ min: 1, max: 365 }),
  dailyLimit: fc.integer({ min: 1, max: 5 }),
  maxPlates: fc.integer({ min: 1, max: 5 }),
  price: fc.integer({ min: 10000, max: 1000000 }),
  outletIds: fc.constant(null),
  freeServiceIds: fc.constant(null),
  discountedServices: fc.constant([]),
  whatsappWelcomeEnabled: fc.boolean(),
  isActive: fc.constant(true),
  createdAt: fc.constant(new Date()),
  updatedAt: fc.constant(new Date()),
});

/** Generate an arbitrary membership given a specific planId and status */
function membershipArbitrary(
  planId: string,
  status: 'active' | 'expired' | 'pending' | 'cancelled',
): fc.Arbitrary<Membership> {
  return fc.record({
    id: uuidArbitrary,
    tenantId: uuidArbitrary,
    customerId: uuidArbitrary,
    planId: fc.constant(planId),
    status: fc.constant(status),
    startDate: dateArbitrary,
    endDate: dateArbitrary,
    usesCount: fc.integer({ min: 0, max: 100 }),
    maxUses: fc.integer({ min: 1, max: 365 }),
    dailyLimit: fc.integer({ min: 1, max: 5 }),
    orderId: fc.oneof(uuidArbitrary, fc.constant(null)),
    createdAt: fc.constant(new Date()),
    updatedAt: fc.constant(new Date()),
  });
}

// --- Test Suite ---

describe('Property 17: Membership Renewal Date Logic', () => {
  let service: MembershipRenewalService;
  let mockPool: { query: ReturnType<typeof vi.fn> };
  let mockPlanService: { getPlan: ReturnType<typeof vi.fn> };
  let queryCalls: Array<{ sql: string; params: unknown[] }>;

  beforeEach(() => {
    vi.clearAllMocks();
    queryCalls = [];
    mockPool = {
      query: vi.fn().mockImplementation((sql: string, params: unknown[]) => {
        queryCalls.push({ sql, params });
        // Return a default row depending on query type
        const isUpdate = sql.includes('UPDATE');
        const isInsert = sql.includes('INSERT');
        const now = new Date();
        return Promise.resolve({
          rows: [
            {
              id: 'result-membership-id',
              tenant_id: 'tenant-001',
              customer_id: 'customer-001',
              plan_id: 'plan-001',
              status: 'active',
              start_date: now,
              end_date: now,
              uses_count: 0,
              max_uses: 30,
              daily_limit: 1,
              order_id: isInsert ? 'order-001' : null,
              created_at: now,
              updated_at: now,
            },
          ],
        });
      }),
    };
    mockPlanService = { getPlan: vi.fn() };
    const mockLifecycle = { recordEvent: vi.fn().mockResolvedValue(undefined) };
    service = new MembershipRenewalService(
      mockPool as any,
      mockPlanService as unknown as MembershipPlanService,
      mockLifecycle as any,
      {} as any, // PosCheckoutService — unused by renewMembership
    );
  });

  it('same plan extension: result.type is always "extension" when active membership with matching planId exists', async () => {
    await fc.assert(
      fc.asyncProperty(
        planArbitrary,
        uuidArbitrary, // customerId
        uuidArbitrary, // orderId
        dateArbitrary, // startDate for existing membership
        dateArbitrary, // endDate for existing membership
        async (plan, customerId, orderId, startDate, endDate) => {
          queryCalls = [];
          mockPlanService.getPlan.mockResolvedValueOnce(plan);

          const existingMembership: Membership = {
            id: 'existing-id',
            tenantId: plan.tenantId,
            customerId,
            planId: plan.id,
            status: 'active',
            startDate,
            endDate,
            usesCount: 5,
            maxUses: plan.maxUses,
            dailyLimit: plan.dailyLimit,
            orderId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          const result = await service.renewMembership(
            customerId,
            plan.id,
            orderId,
            [existingMembership],
          );

          expect(result.type).toBe('extension');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('same plan extension: start_date is re-based ONLY when the term had already lapsed', async () => {
    await fc.assert(
      fc.asyncProperty(
        planArbitrary,
        uuidArbitrary,
        uuidArbitrary,
        dateArbitrary,
        dateArbitrary,
        async (plan, customerId, orderId, startDate, endDate) => {
          queryCalls = [];
          mockPlanService.getPlan.mockResolvedValueOnce(plan);

          const existingMembership: Membership = {
            id: 'existing-id',
            tenantId: plan.tenantId,
            customerId,
            planId: plan.id,
            status: 'active',
            startDate,
            endDate,
            usesCount: 3,
            maxUses: plan.maxUses,
            dailyLimit: plan.dailyLimit,
            orderId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          await service.renewMembership(customerId, plan.id, orderId, [existingMembership]);

          const updateQuery = queryCalls.find((q) => q.sql.includes('UPDATE'));
          expect(updateQuery).toBeDefined();

          // A live term keeps the start it already has; a lapsed one starts over
          // today, so the member is not charged for days that already passed
          // (AIRIN-156).
          const today = new Date(); today.setHours(0, 0, 0, 0);
          const expiry = new Date(endDate); expiry.setHours(0, 0, 0, 0);
          const shouldRebase = expiry.getTime() < today.getTime();
          expect(updateQuery!.params[2] as boolean).toBe(shouldRebase);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('same plan extension: new end_date is one full term from the period start (expiry, or today if lapsed)', async () => {
    await fc.assert(
      fc.asyncProperty(
        planArbitrary,
        uuidArbitrary,
        uuidArbitrary,
        dateArbitrary,
        async (plan, customerId, orderId, endDate) => {
          queryCalls = [];
          mockPlanService.getPlan.mockResolvedValueOnce(plan);

          const existingMembership: Membership = {
            id: 'existing-id',
            tenantId: plan.tenantId,
            customerId,
            planId: plan.id,
            status: 'active',
            startDate: new Date('2024-01-01'),
            endDate,
            usesCount: 2,
            maxUses: plan.maxUses,
            dailyLimit: plan.dailyLimit,
            orderId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          await service.renewMembership(customerId, plan.id, orderId, [existingMembership]);

          // The end_date passed to the UPDATE should equal addMonths(existingEndDate, plan.durationMonths)
          const updateQuery = queryCalls.find((q) => q.sql.includes('UPDATE'));
          expect(updateQuery).toBeDefined();

          const passedEndDate = updateQuery!.params[0] as Date;
          // Renewing early stacks onto the expiry; renewing late starts today.
          // Either way the member gets a WHOLE term — never a shortened one.
          const expectedEndDate = service.addMonths(
            service.renewalPeriodStart(endDate),
            plan.durationMonths,
          );

          expect(passedEndDate.getFullYear()).toBe(expectedEndDate.getFullYear());
          expect(passedEndDate.getMonth()).toBe(expectedEndDate.getMonth());
          expect(passedEndDate.getDate()).toBe(expectedEndDate.getDate());
        },
      ),
      { numRuns: 100 },
    );
  });

  it('different plan: result.type is always "new_parallel" when planId differs from all existing', async () => {
    await fc.assert(
      fc.asyncProperty(
        planArbitrary,
        uuidArbitrary, // customerId
        uuidArbitrary, // orderId
        uuidArbitrary, // existingPlanId (will be different from plan.id)
        dateArbitrary,
        dateArbitrary,
        async (plan, customerId, orderId, existingPlanId, startDate, endDate) => {
          // Ensure plans are different
          fc.pre(existingPlanId !== plan.id);

          queryCalls = [];
          mockPlanService.getPlan.mockResolvedValueOnce(plan);

          const existingMembership: Membership = {
            id: 'existing-id',
            tenantId: plan.tenantId,
            customerId,
            planId: existingPlanId,
            status: 'active',
            startDate,
            endDate,
            usesCount: 5,
            maxUses: 30,
            dailyLimit: 1,
            orderId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          const result = await service.renewMembership(
            customerId,
            plan.id,
            orderId,
            [existingMembership],
          );

          expect(result.type).toBe('new_parallel');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('no duplicate records: extension uses UPDATE (not INSERT) for same plan', async () => {
    await fc.assert(
      fc.asyncProperty(
        planArbitrary,
        uuidArbitrary,
        uuidArbitrary,
        dateArbitrary,
        dateArbitrary,
        async (plan, customerId, orderId, startDate, endDate) => {
          queryCalls = [];
          mockPlanService.getPlan.mockResolvedValueOnce(plan);

          const existingMembership: Membership = {
            id: 'existing-id',
            tenantId: plan.tenantId,
            customerId,
            planId: plan.id,
            status: 'active',
            startDate,
            endDate,
            usesCount: 1,
            maxUses: plan.maxUses,
            dailyLimit: plan.dailyLimit,
            orderId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          await service.renewMembership(customerId, plan.id, orderId, [existingMembership]);

          // Only 1 query call (the UPDATE), no INSERT
          expect(queryCalls).toHaveLength(1);
          expect(queryCalls[0]!.sql).toContain('UPDATE');
          expect(queryCalls[0]!.sql).not.toContain('INSERT');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('only ACTIVE memberships match: expired/cancelled/pending memberships with same plan_id are treated as "different" (create new)', async () => {
    await fc.assert(
      fc.asyncProperty(
        planArbitrary,
        uuidArbitrary,
        uuidArbitrary,
        nonActiveStatusArbitrary,
        dateArbitrary,
        dateArbitrary,
        async (plan, customerId, orderId, nonActiveStatus, startDate, endDate) => {
          queryCalls = [];
          mockPlanService.getPlan.mockResolvedValueOnce(plan);

          // Same plan_id but NOT active
          const nonActiveMembership: Membership = {
            id: 'non-active-id',
            tenantId: plan.tenantId,
            customerId,
            planId: plan.id, // same plan!
            status: nonActiveStatus,
            startDate,
            endDate,
            usesCount: 10,
            maxUses: plan.maxUses,
            dailyLimit: plan.dailyLimit,
            orderId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          const result = await service.renewMembership(
            customerId,
            plan.id,
            orderId,
            [nonActiveMembership],
          );

          // Should create new since expired/cancelled/pending doesn't count
          expect(result.type).toBe('new_parallel');

          // Verify INSERT was used (not UPDATE)
          const insertQuery = queryCalls.find((q) => q.sql.includes('INSERT'));
          expect(insertQuery).toBeDefined();
          const updateQuery = queryCalls.find((q) => q.sql.includes('UPDATE'));
          expect(updateQuery).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});
