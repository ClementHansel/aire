import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MembershipRenewalService } from './membership-renewal.service';
import { Membership } from './interfaces';
import { MembershipPlanService } from './membership-plan.service';

describe('MembershipRenewalService', () => {
  let service: MembershipRenewalService;
  let mockPool: { query: ReturnType<typeof vi.fn> };
  let mockPlanService: { getPlan: ReturnType<typeof vi.fn> };
  let mockLifecycle: { recordEvent: ReturnType<typeof vi.fn> };

  const customerId = 'customer-001';
  const planId = 'plan-001';
  const orderId = 'order-001';

  const mockPlan = {
    id: planId,
    tenantId: 'tenant-001',
    name: 'Gold Wash Plan',
    durationMonths: 3,
    maxUses: 30,
    dailyLimit: 1,
    maxPlates: 3,
    price: 150000,
    outletIds: null,
    freeServiceIds: ['service-1'],
    discountedServices: [],
    whatsappWelcomeEnabled: false,
    isActive: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  const makeActiveMembership = (overrides: Partial<Membership> = {}): Membership => ({
    id: 'membership-001',
    tenantId: 'tenant-001',
    customerId,
    planId,
    status: 'active',
    startDate: new Date('2024-01-15'),
    endDate: new Date('2024-04-15'),
    usesCount: 5,
    maxUses: 30,
    dailyLimit: 1,
    orderId: 'order-original',
    createdAt: new Date('2024-01-15'),
    updatedAt: new Date('2024-01-15'),
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // The period start now depends on TODAY (AIRIN-156: a renewal taken after the
    // membership lapsed starts fresh instead of back-dating itself to the old
    // expiry), so these fixtures — all dated 2024 — need "today" pinned inside
    // their term for the early-renewal cases to mean what they say. The lapsed
    // case has its own test below.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2024-03-01T00:00:00'));
    mockPool = { query: vi.fn() };
    mockPlanService = { getPlan: vi.fn() };
    mockLifecycle = { recordEvent: vi.fn().mockResolvedValue(undefined) };
    service = new MembershipRenewalService(
      mockPool as any,
      mockPlanService as unknown as MembershipPlanService,
      mockLifecycle as any,
      {} as any, // PosCheckoutService — unused by renewMembership
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('renewMembership - same plan renewal (extension)', () => {
    it('should extend end_date from current expiry by plan duration_months', async () => {
      mockPlanService.getPlan.mockResolvedValueOnce(mockPlan);

      const existingMembership = makeActiveMembership({
        endDate: new Date('2024-04-15'),
      });

      // Mock the UPDATE query return
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: existingMembership.id,
          tenant_id: 'tenant-001',
          customer_id: customerId,
          plan_id: planId,
          status: 'active',
          start_date: new Date('2024-01-15'),
          end_date: new Date('2024-07-15'), // extended by 3 months from April 15
          uses_count: 5,
          max_uses: 30,
          daily_limit: 1,
          order_id: 'order-original',
          created_at: new Date('2024-01-15'),
          updated_at: new Date(),
        }],
      });

      const result = await service.renewMembership(
        customerId,
        planId,
        orderId,
        [existingMembership],
      );

      expect(result.type).toBe('extension');
      expect(result.membership.id).toBe(existingMembership.id);

      // Verify the UPDATE query was called with correct end_date
      const queryCall = mockPool.query.mock.calls[0];
      const queryStr = queryCall[0] as string;
      expect(queryStr).toContain('UPDATE memberships');
      expect(queryStr).toContain('SET end_date');

      // The new end_date should be April 15 + 3 months = July 15
      const passedEndDate = queryCall[1][0] as Date;
      expect(passedEndDate.getFullYear()).toBe(2024);
      expect(passedEndDate.getMonth()).toBe(6); // July (0-indexed)
      expect(passedEndDate.getDate()).toBe(15);
    });

    it('moves start_date to the day after the current term (AIRIN-156)', async () => {
      mockPlanService.getPlan.mockResolvedValueOnce(mockPlan);

      const originalStartDate = new Date('2024-01-15');
      const existingMembership = makeActiveMembership({
        startDate: originalStartDate,
        endDate: new Date('2024-04-15'),
      });

      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: existingMembership.id,
          tenant_id: 'tenant-001',
          customer_id: customerId,
          plan_id: planId,
          status: 'active',
          start_date: originalStartDate,
          end_date: new Date('2024-07-15'),
          uses_count: 5,
          max_uses: 30,
          daily_limit: 1,
          order_id: 'order-original',
          created_at: new Date('2024-01-15'),
          updated_at: new Date(),
        }],
      });

      const result = await service.renewMembership(
        customerId,
        planId,
        orderId,
        [existingMembership],
      );

      expect(result.type).toBe('extension');
      // The renewed period begins the day AFTER the term the member is still
      // using — 16 Apr, not 15 Apr, which they have already paid for — and
      // start_date says so (AIRIN-156).
      const queryStr = mockPool.query.mock.calls[0][0] as string;
      expect(queryStr).toContain('start_date = $3::date');
      const periodStart = mockPool.query.mock.calls[0][1][2] as Date;
      expect([periodStart.getFullYear(), periodStart.getMonth(), periodStart.getDate()])
        .toEqual([2024, 3, 16]);
      // …while the end keeps the anniversary: 15 Apr + 3 months = 15 Jul.
      const endDate = mockPool.query.mock.calls[0][1][0] as Date;
      expect([endDate.getMonth(), endDate.getDate()]).toEqual([6, 15]);
    });

    it('starts a LAPSED membership fresh from today, not from its old expiry (AIRIN-156)', async () => {
      mockPlanService.getPlan.mockResolvedValueOnce(mockPlan);

      // Expired three weeks ago and renewed during grace. Extending from the old
      // expiry would silently charge for a full term and deliver three weeks less.
      const lapsed = makeActiveMembership({
        status: 'grace',
        startDate: new Date('2023-11-08'),
        endDate: new Date('2024-02-08'),
      });

      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: lapsed.id, tenant_id: 'tenant-001', customer_id: customerId, plan_id: planId,
          status: 'active', start_date: new Date('2024-03-01'), end_date: new Date('2024-06-01'),
          uses_count: 5, max_uses: 30, daily_limit: 1, order_id: 'order-original',
          created_at: new Date('2023-11-08'), updated_at: new Date(),
        }],
      });

      const result = await service.renewMembership(customerId, planId, orderId, [lapsed]);

      expect(result.type).toBe('extension');
      const [endDate, , periodStart] = mockPool.query.mock.calls[0][1] as [Date, string, Date];
      // Today (pinned to 2024-03-01) + 3 months, and the term is re-based to today.
      expect([periodStart.getFullYear(), periodStart.getMonth(), periodStart.getDate()]).toEqual([2024, 2, 1]);
      expect(endDate.getFullYear()).toBe(2024);
      expect(endDate.getMonth()).toBe(5); // June
      expect(endDate.getDate()).toBe(1);
    });

    it('honours an explicit later start, bounded to 7 days past expiry (AIRIN-157)', async () => {
      mockPlanService.getPlan.mockResolvedValueOnce(mockPlan);
      const m = makeActiveMembership({ endDate: new Date('2024-04-15') });
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: m.id, tenant_id: 'tenant-001', customer_id: customerId, plan_id: planId,
          status: 'active', start_date: new Date('2024-04-20'), end_date: new Date('2024-07-20'),
          uses_count: 0, max_uses: 30, daily_limit: 1, order_id: 'order-original',
          created_at: new Date('2024-01-15'), updated_at: new Date(),
        }],
      });

      await service.renewMembership(customerId, planId, orderId, [m], '2024-04-20');

      const endDate = mockPool.query.mock.calls[0][1][0] as Date;
      expect(endDate.getMonth()).toBe(6); // July — three months from April 20
      expect(endDate.getDate()).toBe(20);

      // …and the bounds are enforced where the fee order is created.
      expect(() => service.validateNextStart('2024-04-10', '2024-04-15')).toThrow();
      // The expiry itself is now too early: the member already owns that day.
      expect(() => service.validateNextStart('2024-04-15', '2024-04-15')).toThrow();
      expect(service.validateNextStart('2024-04-16', '2024-04-15')).toBe('2024-04-16');
      expect(() => service.validateNextStart('2024-04-30', '2024-04-15')).toThrow();
      expect(service.validateNextStart('2024-04-22', '2024-04-15')).toBe('2024-04-22');
      expect(service.validateNextStart(undefined, '2024-04-15')).toBeNull();
    });

    it('should NOT create a new membership record (uses UPDATE)', async () => {
      mockPlanService.getPlan.mockResolvedValueOnce(mockPlan);

      const existingMembership = makeActiveMembership();

      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: existingMembership.id,
          tenant_id: 'tenant-001',
          customer_id: customerId,
          plan_id: planId,
          status: 'active',
          start_date: new Date('2024-01-15'),
          end_date: new Date('2024-07-15'),
          uses_count: 5,
          max_uses: 30,
          daily_limit: 1,
          order_id: 'order-original',
          created_at: new Date('2024-01-15'),
          updated_at: new Date(),
        }],
      });

      await service.renewMembership(customerId, planId, orderId, [existingMembership]);

      // Should only have 1 query call (the UPDATE), no INSERT
      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const queryStr = mockPool.query.mock.calls[0][0] as string;
      expect(queryStr).toContain('UPDATE');
      expect(queryStr).not.toContain('INSERT');
    });
  });

  describe('renewMembership - different plan (new parallel)', () => {
    it('should create a new parallel membership when plan_id differs', async () => {
      const differentPlanId = 'plan-002';
      const differentPlan = { ...mockPlan, id: differentPlanId, durationMonths: 1 };
      mockPlanService.getPlan.mockResolvedValueOnce(differentPlan);

      // Existing membership is for plan-001 (different from plan-002)
      const existingMembership = makeActiveMembership({ planId: 'plan-001' });

      const now = new Date();
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'membership-new',
          tenant_id: 'tenant-001',
          customer_id: customerId,
          plan_id: differentPlanId,
          status: 'active',
          start_date: now,
          end_date: new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()),
          uses_count: 0,
          max_uses: 30,
          daily_limit: 1,
          order_id: orderId,
          created_at: now,
          updated_at: now,
        }],
      });

      const result = await service.renewMembership(
        customerId,
        differentPlanId,
        orderId,
        [existingMembership],
      );

      expect(result.type).toBe('new_parallel');
      expect(result.membership.planId).toBe(differentPlanId);

      // Verify INSERT query was used
      const queryStr = mockPool.query.mock.calls[0][0] as string;
      expect(queryStr).toContain('INSERT INTO memberships');
    });

    it('queues the new plan behind the term still running, instead of overlapping it (AIRIN-156)', async () => {
      const differentPlanId = 'plan-different';
      mockPlanService.getPlan.mockResolvedValueOnce({ ...mockPlan, id: differentPlanId, durationMonths: 1 });

      // Today is pinned to 2024-03-01 by the suite's fake timers; the member is
      // paid up to 2024-04-15. Starting the new plan today would sell them a
      // period they already own — Samuel saw exactly that, a "new" period
      // identical to the running one.
      const running = makeActiveMembership({
        startDate: new Date('2024-01-15'),
        endDate: new Date('2024-04-15'),
      });
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'membership-queued', tenant_id: 'tenant-001', customer_id: customerId,
          plan_id: differentPlanId, status: 'active',
          start_date: new Date('2024-04-16'), end_date: new Date('2024-05-15'),
          uses_count: 0, max_uses: 30, daily_limit: 1, order_id: orderId,
          created_at: new Date(), updated_at: new Date(),
        }],
      });

      await service.renewMembership(customerId, differentPlanId, orderId, [running]);

      const params = mockPool.query.mock.calls[0][1] as unknown[];
      const startDate = params[2] as Date;
      const endDate = params[3] as Date;
      expect([startDate.getMonth(), startDate.getDate()]).toEqual([3, 16]); // 16 Apr
      expect([endDate.getMonth(), endDate.getDate()]).toEqual([4, 15]);     // 15 May
    });
  });

  describe('renewMembership - no existing membership', () => {
    it('should create a new membership when no existing memberships', async () => {
      mockPlanService.getPlan.mockResolvedValueOnce(mockPlan);

      const now = new Date();
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'membership-new',
          tenant_id: 'tenant-001',
          customer_id: customerId,
          plan_id: planId,
          status: 'active',
          start_date: now,
          end_date: new Date(now.getFullYear(), now.getMonth() + 3, now.getDate()),
          uses_count: 0,
          max_uses: 30,
          daily_limit: 1,
          order_id: orderId,
          created_at: now,
          updated_at: now,
        }],
      });

      const result = await service.renewMembership(
        customerId,
        planId,
        orderId,
        [], // empty array = no existing memberships
      );

      expect(result.type).toBe('new_parallel');
      expect(result.membership.usesCount).toBe(0);

      const queryStr = mockPool.query.mock.calls[0][0] as string;
      expect(queryStr).toContain('INSERT INTO memberships');
    });

    it('should create new membership with start_date = today', async () => {
      mockPlanService.getPlan.mockResolvedValueOnce(mockPlan);

      const now = new Date();
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'membership-new',
          tenant_id: 'tenant-001',
          customer_id: customerId,
          plan_id: planId,
          status: 'active',
          start_date: now,
          end_date: new Date(now.getFullYear(), now.getMonth() + 3, now.getDate()),
          uses_count: 0,
          max_uses: 30,
          daily_limit: 1,
          order_id: orderId,
          created_at: now,
          updated_at: now,
        }],
      });

      await service.renewMembership(customerId, planId, orderId, []);

      // Verify start_date passed to INSERT is approximately "now"
      const params = mockPool.query.mock.calls[0][1];
      const passedStartDate = params[2] as Date;
      // Should be within a few seconds of now
      expect(Math.abs(passedStartDate.getTime() - now.getTime())).toBeLessThan(5000);
    });
  });

  describe('renewMembership - end_date calculation', () => {
    it('should correctly calculate end_date for 1-month plan', async () => {
      const oneMonthPlan = { ...mockPlan, durationMonths: 1 };
      mockPlanService.getPlan.mockResolvedValueOnce(oneMonthPlan);

      const existingMembership = makeActiveMembership({
        endDate: new Date('2024-03-15'),
      });

      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: existingMembership.id,
          tenant_id: 'tenant-001',
          customer_id: customerId,
          plan_id: planId,
          status: 'active',
          start_date: new Date('2024-01-15'),
          end_date: new Date('2024-04-15'),
          uses_count: 5,
          max_uses: 30,
          daily_limit: 1,
          order_id: 'order-original',
          created_at: new Date('2024-01-15'),
          updated_at: new Date(),
        }],
      });

      await service.renewMembership(customerId, planId, orderId, [existingMembership]);

      const passedEndDate = mockPool.query.mock.calls[0][1][0] as Date;
      // March 15 + 1 month = April 15
      expect(passedEndDate.getFullYear()).toBe(2024);
      expect(passedEndDate.getMonth()).toBe(3); // April (0-indexed)
      expect(passedEndDate.getDate()).toBe(15);
    });

    it('should correctly calculate end_date for 12-month plan', async () => {
      const yearPlan = { ...mockPlan, durationMonths: 12 };
      mockPlanService.getPlan.mockResolvedValueOnce(yearPlan);

      const existingMembership = makeActiveMembership({
        endDate: new Date('2024-06-01'),
      });

      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: existingMembership.id,
          tenant_id: 'tenant-001',
          customer_id: customerId,
          plan_id: planId,
          status: 'active',
          start_date: new Date('2024-01-15'),
          end_date: new Date('2025-06-01'),
          uses_count: 5,
          max_uses: 30,
          daily_limit: 1,
          order_id: 'order-original',
          created_at: new Date('2024-01-15'),
          updated_at: new Date(),
        }],
      });

      await service.renewMembership(customerId, planId, orderId, [existingMembership]);

      const passedEndDate = mockPool.query.mock.calls[0][1][0] as Date;
      // June 1 + 12 months = June 1 next year
      expect(passedEndDate.getFullYear()).toBe(2025);
      expect(passedEndDate.getMonth()).toBe(5); // June (0-indexed)
      expect(passedEndDate.getDate()).toBe(1);
    });

    it('should handle month overflow (e.g., Jan 31 + 1 month)', async () => {
      const oneMonthPlan = { ...mockPlan, durationMonths: 1 };
      mockPlanService.getPlan.mockResolvedValueOnce(oneMonthPlan);

      // A FUTURE Jan 31 — the extension has to run from the expiry, which only
      // happens while the term is still live (AIRIN-156).
      const existingMembership = makeActiveMembership({
        endDate: new Date('2025-01-31'),
      });

      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: existingMembership.id,
          tenant_id: 'tenant-001',
          customer_id: customerId,
          plan_id: planId,
          status: 'active',
          start_date: new Date('2023-10-31'),
          end_date: new Date('2024-02-29'), // 2024 is leap year
          uses_count: 5,
          max_uses: 30,
          daily_limit: 1,
          order_id: 'order-original',
          created_at: new Date('2023-10-31'),
          updated_at: new Date(),
        }],
      });

      await service.renewMembership(customerId, planId, orderId, [existingMembership]);

      const passedEndDate = mockPool.query.mock.calls[0][1][0] as Date;
      // Jan 31 + 1 month: February is short, so the date clamps into February
      // rather than spilling into March.
      expect(passedEndDate.getFullYear()).toBe(2025);
      expect(passedEndDate.getMonth()).toBe(1); // February
      expect(passedEndDate.getDate()).toBeLessThanOrEqual(29);
    });

    it('should only match ACTIVE memberships for same-plan renewal', async () => {
      mockPlanService.getPlan.mockResolvedValueOnce(mockPlan);

      // Same plan but status is 'expired', not 'active'
      const expiredMembership = makeActiveMembership({
        status: 'expired',
        planId,
      });

      const now = new Date();
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'membership-new',
          tenant_id: 'tenant-001',
          customer_id: customerId,
          plan_id: planId,
          status: 'active',
          start_date: now,
          end_date: new Date(now.getFullYear(), now.getMonth() + 3, now.getDate()),
          uses_count: 0,
          max_uses: 30,
          daily_limit: 1,
          order_id: orderId,
          created_at: now,
          updated_at: now,
        }],
      });

      const result = await service.renewMembership(
        customerId,
        planId,
        orderId,
        [expiredMembership],
      );

      // Should create new since expired membership doesn't count
      expect(result.type).toBe('new_parallel');
      const queryStr = mockPool.query.mock.calls[0][0] as string;
      expect(queryStr).toContain('INSERT');
    });
  });

  describe('addMonths helper', () => {
    it('should add months correctly for standard dates', () => {
      const date = new Date('2024-01-15');
      const result = service.addMonths(date, 3);
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(3); // April
      expect(result.getDate()).toBe(15);
    });

    it('should handle year boundary', () => {
      const date = new Date('2024-11-15');
      const result = service.addMonths(date, 3);
      expect(result.getFullYear()).toBe(2025);
      expect(result.getMonth()).toBe(1); // February
      expect(result.getDate()).toBe(15);
    });

    it('should handle end-of-month overflow', () => {
      const date = new Date('2024-01-31');
      const result = service.addMonths(date, 1);
      // Feb 2024 has 29 days (leap year), so Jan 31 + 1 month = Feb 29
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(1); // February
      expect(result.getDate()).toBe(29);
    });

    it('should not mutate the original date', () => {
      const date = new Date('2024-01-15');
      const originalTime = date.getTime();
      service.addMonths(date, 3);
      expect(date.getTime()).toBe(originalTime);
    });
  });
});
