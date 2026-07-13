import { describe, it, expect, vi, beforeEach } from 'vitest';
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

    it('should retain the original start_date (not update it)', async () => {
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
      // Verify start_date is NOT part of the UPDATE (retained)
      const queryStr = mockPool.query.mock.calls[0][0] as string;
      expect(queryStr).not.toContain('start_date');
      // The returned membership should still have the original start_date
      expect(result.membership.startDate).toEqual(originalStartDate);
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

      const existingMembership = makeActiveMembership({
        endDate: new Date('2024-01-31'),
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
      // Jan 31 + 1 month: Feb only has 29 days in 2024 (leap year)
      expect(passedEndDate.getFullYear()).toBe(2024);
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
