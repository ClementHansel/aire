import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import {
  ERR_MEMBERSHIP_PLAN_NOT_FOUND,
  ERR_MEMBERSHIP_ONE_PLAN_PER_ORDER,
  ERR_MEMBERSHIP_MAX_PLATES_EXCEEDED,
  ERR_MEMBERSHIP_NOT_FOUND,
  MembershipStatus,
} from '@aire/shared';
import { MembershipSellService } from './membership-sell.service';
import { MembershipRow } from './interfaces';

describe('MembershipSellService', () => {
  let service: MembershipSellService;
  let mockPool: { query: ReturnType<typeof vi.fn> };

  const tenantId = 'tenant-001';
  const customerId = 'customer-001';
  const planId = 'plan-001';
  const orderId = 'order-001';
  const membershipId = 'membership-001';

  const mockPlanRow = {
    id: planId,
    tenant_id: tenantId,
    name: 'Gold Plan',
    duration_months: 3,
    max_uses: 30,
    daily_limit: 1,
    max_plates: 3,
    price: '150000.00',
    outlet_ids: null,
    free_service_ids: ['svc-1'],
    discounted_services: [],
    whatsapp_welcome_enabled: false,
    is_active: true,
    created_at: new Date('2024-01-01'),
    updated_at: new Date('2024-01-01'),
  };

  const mockMembershipRow: MembershipRow = {
    id: membershipId,
    tenant_id: tenantId,
    customer_id: customerId,
    plan_id: planId,
    status: MembershipStatus.Pending,
    start_date: '2024-06-15',
    end_date: '2024-09-15',
    uses_count: 0,
    max_uses: 30,
    daily_limit: 1,
    order_id: orderId,
    created_at: new Date('2024-06-15'),
    updated_at: new Date('2024-06-15'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = { query: vi.fn() };
    service = new MembershipSellService(mockPool as any);
  });

  describe('sellMembership', () => {
    it('should create a pending membership with plan terms snapshot', async () => {
      // No existing membership for this order
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      // Plan exists
      mockPool.query.mockResolvedValueOnce({ rows: [mockPlanRow] });
      // Insert returns the new membership
      mockPool.query.mockResolvedValueOnce({ rows: [mockMembershipRow] });

      const result = await service.sellMembership({
        planId,
        customerId,
        orderId,
        tenantId,
      });

      expect(result.id).toBe(membershipId);
      expect(result.tenantId).toBe(tenantId);
      expect(result.customerId).toBe(customerId);
      expect(result.planId).toBe(planId);
      expect(result.status).toBe(MembershipStatus.Pending);
      expect(result.maxUses).toBe(30);
      expect(result.dailyLimit).toBe(1);
      expect(result.orderId).toBe(orderId);
      expect(result.usesCount).toBe(0);
    });

    it('should enforce max one membership plan per order', async () => {
      // Existing membership already linked to this order
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'existing-membership' }] });

      await expect(
        service.sellMembership({ planId, customerId, orderId, tenantId }),
      ).rejects.toThrow(ConflictException);

      // Verify the error message contains the correct error code
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'existing-membership' }] });
      try {
        await service.sellMembership({ planId, customerId, orderId, tenantId });
      } catch (error: any) {
        expect(error.message).toBe(ERR_MEMBERSHIP_ONE_PLAN_PER_ORDER);
      }
    });

    it('should throw NotFoundException if plan does not exist', async () => {
      // No existing membership for this order
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      // Plan not found
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.sellMembership({ planId: 'nonexistent', customerId, orderId, tenantId }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should snapshot maxUses and dailyLimit from plan at creation', async () => {
      const customPlan = { ...mockPlanRow, max_uses: 60, daily_limit: 2 };
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      mockPool.query.mockResolvedValueOnce({ rows: [customPlan] });
      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockMembershipRow, max_uses: 60, daily_limit: 2 }],
      });

      const result = await service.sellMembership({
        planId,
        customerId,
        orderId,
        tenantId,
      });

      expect(result.maxUses).toBe(60);
      expect(result.dailyLimit).toBe(2);

      // Verify insert query passes plan's max_uses and daily_limit
      const insertCall = mockPool.query.mock.calls[2];
      const params = insertCall[1];
      expect(params[7]).toBe(60); // max_uses
      expect(params[8]).toBe(2); // daily_limit
    });
  });

  describe('activateMembership', () => {
    it('should activate membership with start_date = today and register plates', async () => {
      // Fetch membership
      mockPool.query.mockResolvedValueOnce({ rows: [mockMembershipRow] });
      // Fetch plan
      mockPool.query.mockResolvedValueOnce({ rows: [{ max_plates: 3, duration_months: 3 }] });
      // Update membership to active
      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockMembershipRow, status: MembershipStatus.Active }],
      });
      // Register plate 1
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'plate-1',
          membership_id: membershipId,
          plate: 'B 1234 ABC',
          plate_normalized: 'B1234ABC',
          brand: 'Toyota',
          model: 'Avanza',
          created_at: new Date(),
        }],
      });

      const result = await service.activateMembership(membershipId, {
        plates: [{ plate: 'B 1234 ABC', brand: 'Toyota', model: 'Avanza' }],
      });

      expect(result.status).toBe(MembershipStatus.Active);

      // Verify update query sets active status and dates
      const updateCall = mockPool.query.mock.calls[2];
      const updateParams = updateCall[1];
      expect(updateParams[0]).toBe(MembershipStatus.Active);
      // start_date should be today
      const today = new Date();
      const expectedStartDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      expect(updateParams[1]).toBe(expectedStartDate);
    });

    it('should throw NotFoundException if membership does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.activateMembership('nonexistent', { plates: [] }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if plates exceed max_plates', async () => {
      // Fetch membership
      mockPool.query.mockResolvedValueOnce({ rows: [mockMembershipRow] });
      // Plan max_plates = 2
      mockPool.query.mockResolvedValueOnce({ rows: [{ max_plates: 2, duration_months: 3 }] });

      await expect(
        service.activateMembership(membershipId, {
          plates: [
            { plate: 'B 1111 AA' },
            { plate: 'B 2222 BB' },
            { plate: 'B 3333 CC' }, // exceeds max_plates = 2
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow registering exactly max_plates plates', async () => {
      // Fetch membership
      mockPool.query.mockResolvedValueOnce({ rows: [mockMembershipRow] });
      // Plan max_plates = 3
      mockPool.query.mockResolvedValueOnce({ rows: [{ max_plates: 3, duration_months: 3 }] });
      // Update membership
      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockMembershipRow, status: MembershipStatus.Active }],
      });
      // Register 3 plates
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'p1', membership_id: membershipId, plate: 'B 1111 AA', plate_normalized: 'B1111AA', brand: null, model: null, created_at: new Date() }],
      });
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'p2', membership_id: membershipId, plate: 'B 2222 BB', plate_normalized: 'B2222BB', brand: null, model: null, created_at: new Date() }],
      });
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'p3', membership_id: membershipId, plate: 'B 3333 CC', plate_normalized: 'B3333CC', brand: null, model: null, created_at: new Date() }],
      });

      // Should not throw
      const result = await service.activateMembership(membershipId, {
        plates: [
          { plate: 'B 1111 AA' },
          { plate: 'B 2222 BB' },
          { plate: 'B 3333 CC' },
        ],
      });

      expect(result.status).toBe(MembershipStatus.Active);
    });

    it('should activate without plates (empty plate list)', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockMembershipRow] });
      mockPool.query.mockResolvedValueOnce({ rows: [{ max_plates: 3, duration_months: 3 }] });
      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockMembershipRow, status: MembershipStatus.Active }],
      });
      // 6b: membership-number issuance looks up the order's outlet (best-effort).
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.activateMembership(membershipId, { plates: [] });

      expect(result.status).toBe(MembershipStatus.Active);
      // No plate INSERT should run: fetch, plan, update, order-outlet lookup = 4.
      expect(mockPool.query).toHaveBeenCalledTimes(4);
      const sqls = mockPool.query.mock.calls.map((c: unknown[]) => String(c[0]));
      expect(sqls.some((s: string) => s.includes('INSERT INTO membership_plates'))).toBe(false);
    });
  });

  describe('calculateEndDate', () => {
    it('should add correct months to start date', () => {
      const start = new Date('2024-01-15');

      expect(service.calculateEndDate(start, 1)).toBe('2024-02-15');
      expect(service.calculateEndDate(start, 3)).toBe('2024-04-15');
      expect(service.calculateEndDate(start, 12)).toBe('2025-01-15');
    });

    it('should handle month overflow (e.g., Jan 31 + 1 month)', () => {
      const start = new Date('2024-01-31');
      // Adding 1 month to Jan 31 → March 2 (Feb has 29 days in 2024)
      const result = service.calculateEndDate(start, 1);
      // Date overflow: Jan 31 + 1 month = March 2nd (since Feb 2024 has 29 days)
      expect(result).toBe('2024-03-02');
    });

    it('should handle year crossing', () => {
      const start = new Date('2024-11-15');
      expect(service.calculateEndDate(start, 3)).toBe('2025-02-15');
    });
  });

  describe('scheduleExpiryReminders', () => {
    it('should calculate H-30, H-7, and H-day reminder dates', async () => {
      const endDate = '2024-09-15';

      const result = await service.scheduleExpiryReminders(membershipId, endDate);

      expect(result.reminderDates).toHaveLength(3);
      expect(result.reminderDates[0]).toBe('2024-08-16'); // H-30
      expect(result.reminderDates[1]).toBe('2024-09-08'); // H-7
      expect(result.reminderDates[2]).toBe('2024-09-15'); // H-day
    });

    it('should handle end date at start of month for H-30', async () => {
      const endDate = '2024-03-01';

      const result = await service.scheduleExpiryReminders(membershipId, endDate);

      expect(result.reminderDates[0]).toBe('2024-01-31'); // H-30 from March 1
      expect(result.reminderDates[1]).toBe('2024-02-23'); // H-7
      expect(result.reminderDates[2]).toBe('2024-03-01'); // H-day
    });
  });
});
