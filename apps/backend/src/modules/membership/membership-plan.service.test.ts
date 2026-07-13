import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ERR_MEMBERSHIP_PLAN_NOT_FOUND, ERR_VALIDATION_FAILED } from '@aire/shared';
import { MembershipPlanService } from './membership-plan.service';
import { MembershipPlanRow } from './interfaces';

describe('MembershipPlanService', () => {
  let service: MembershipPlanService;
  let mockPool: { query: ReturnType<typeof vi.fn> };

  const tenantId = 'tenant-001';
  const planId = 'plan-001';

  const mockPlanRow: MembershipPlanRow = {
    id: planId,
    tenant_id: tenantId,
    name: 'Gold Wash Plan',
    duration_months: 3,
    max_uses: 30,
    daily_limit: 1,
    max_plates: 3,
    price: '150000.00',
    outlet_ids: null,
    free_service_ids: ['service-1', 'service-2'],
    discounted_services: [{ serviceId: 'service-3', discountPct: 20 }],
    whatsapp_welcome_enabled: true,
    is_active: true,
    created_at: new Date('2024-01-01'),
    updated_at: new Date('2024-01-01'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = { query: vi.fn() };
    service = new MembershipPlanService(mockPool as any);
  });

  describe('createPlan', () => {
    it('should create a plan with all fields and return mapped entity', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockPlanRow] });

      const result = await service.createPlan(tenantId, {
        name: 'Gold Wash Plan',
        durationMonths: 3,
        maxUses: 30,
        dailyLimit: 1,
        maxPlates: 3,
        price: 150000,
        outletIds: null,
        freeServiceIds: ['service-1', 'service-2'],
        discountedServices: [{ serviceId: 'service-3', discountPct: 20 }],
        whatsappWelcomeEnabled: true,
      });

      expect(result.id).toBe(planId);
      expect(result.tenantId).toBe(tenantId);
      expect(result.name).toBe('Gold Wash Plan');
      expect(result.durationMonths).toBe(3);
      expect(result.maxUses).toBe(30);
      expect(result.dailyLimit).toBe(1);
      expect(result.maxPlates).toBe(3);
      expect(result.price).toBe(150000);
      expect(result.outletIds).toBeNull();
      expect(result.freeServiceIds).toEqual(['service-1', 'service-2']);
      expect(result.discountedServices).toEqual([{ serviceId: 'service-3', discountPct: 20 }]);
      expect(result.whatsappWelcomeEnabled).toBe(true);
      expect(result.isActive).toBe(true);
    });

    it('should apply default values for dailyLimit and maxPlates', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockPlanRow, daily_limit: 1, max_plates: 3 }],
      });

      await service.createPlan(tenantId, {
        name: 'Basic Plan',
        durationMonths: 1,
        maxUses: 10,
        price: 50000,
      });

      // Verify defaults are passed to the query
      const queryCall = mockPool.query.mock.calls[0];
      const params = queryCall[1];
      expect(params[4]).toBe(1); // dailyLimit default
      expect(params[5]).toBe(3); // maxPlates default
    });

    it('should throw BadRequestException for invalid duration', async () => {
      await expect(
        service.createPlan(tenantId, {
          name: 'Bad Plan',
          durationMonths: 5, // not an allowed duration (1, 3, 6, 12)
          maxUses: 10,
          price: 50000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept the 6-month duration tier', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockPlanRow, duration_months: 6 }],
      });

      const result = await service.createPlan(tenantId, {
        name: '6 Month Plan',
        durationMonths: 6,
        maxUses: 180,
        price: 1500000,
      });

      expect(result.durationMonths).toBe(6);
    });

    it('should throw BadRequestException for discountPct out of range', async () => {
      await expect(
        service.createPlan(tenantId, {
          name: 'Plan',
          durationMonths: 1,
          maxUses: 10,
          price: 50000,
          discountedServices: [{ serviceId: 'svc-1', discountPct: 150 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for empty name', async () => {
      await expect(
        service.createPlan(tenantId, {
          name: '',
          durationMonths: 1,
          maxUses: 10,
          price: 50000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for maxUses <= 0', async () => {
      await expect(
        service.createPlan(tenantId, {
          name: 'Plan',
          durationMonths: 1,
          maxUses: 0,
          price: 50000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for negative price', async () => {
      await expect(
        service.createPlan(tenantId, {
          name: 'Plan',
          durationMonths: 1,
          maxUses: 10,
          price: -100,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for dailyLimit <= 0', async () => {
      await expect(
        service.createPlan(tenantId, {
          name: 'Plan',
          durationMonths: 1,
          maxUses: 10,
          price: 50000,
          dailyLimit: 0,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for maxPlates <= 0', async () => {
      await expect(
        service.createPlan(tenantId, {
          name: 'Plan',
          durationMonths: 1,
          maxUses: 10,
          price: 50000,
          maxPlates: -1,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should pass outlet_ids as array when specified', async () => {
      const outletIds = ['outlet-a', 'outlet-b'];
      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockPlanRow, outlet_ids: outletIds }],
      });

      await service.createPlan(tenantId, {
        name: 'Scoped Plan',
        durationMonths: 1,
        maxUses: 10,
        price: 50000,
        outletIds,
      });

      const params = mockPool.query.mock.calls[0][1];
      expect(params[7]).toEqual(outletIds);
    });
  });

  describe('updatePlan', () => {
    it('should update specified fields only', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockPlanRow, name: 'Updated Plan', price: '200000.00' }],
      });

      const result = await service.updatePlan(planId, {
        name: 'Updated Plan',
        price: 200000,
      });

      expect(result.name).toBe('Updated Plan');
      expect(result.price).toBe(200000);

      const queryStr = mockPool.query.mock.calls[0][0] as string;
      expect(queryStr).toContain('name = $1');
      expect(queryStr).toContain('price = $2');
      expect(queryStr).toContain('WHERE id = $3');
    });

    it('should throw NotFoundException if plan does not exist or is inactive', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.updatePlan('nonexistent-plan', { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for invalid durationMonths in update', async () => {
      await expect(
        service.updatePlan(planId, { durationMonths: 7 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should return current plan if no fields to update', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockPlanRow] });

      const result = await service.updatePlan(planId, {});

      // Should call getPlan (SELECT query)
      const queryStr = mockPool.query.mock.calls[0][0] as string;
      expect(queryStr).toContain('SELECT');
      expect(result.id).toBe(planId);
    });

    it('should serialize discountedServices as JSON', async () => {
      const discounted = [{ serviceId: 'svc-1', discountPct: 15 }];
      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockPlanRow, discounted_services: discounted }],
      });

      await service.updatePlan(planId, { discountedServices: discounted });

      const params = mockPool.query.mock.calls[0][1];
      expect(params[0]).toBe(JSON.stringify(discounted));
    });
  });

  describe('getPlan', () => {
    it('should return the plan mapped to camelCase entity', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockPlanRow] });

      const result = await service.getPlan(planId);

      expect(result.id).toBe(planId);
      expect(result.tenantId).toBe(tenantId);
      expect(result.durationMonths).toBe(3);
      expect(result.maxUses).toBe(30);
      expect(result.price).toBe(150000);
    });

    it('should throw NotFoundException if plan not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.getPlan('missing-id')).rejects.toThrow(NotFoundException);
    });

    it('should use correct query with is_active filter', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockPlanRow] });

      await service.getPlan(planId);

      const queryStr = mockPool.query.mock.calls[0][0] as string;
      expect(queryStr).toContain('is_active = true');
    });
  });

  describe('listPlans', () => {
    it('should list all active plans for a tenant', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockPlanRow, mockPlanRow] });

      const result = await service.listPlans(tenantId);

      expect(result).toHaveLength(2);
      const queryStr = mockPool.query.mock.calls[0][0] as string;
      expect(queryStr).toContain('tenant_id = $1');
      expect(queryStr).toContain('is_active = true');
    });

    it('should filter by outlet scope when outletId is provided', async () => {
      const outletId = 'outlet-xyz';
      mockPool.query.mockResolvedValueOnce({ rows: [mockPlanRow] });

      const result = await service.listPlans(tenantId, outletId);

      expect(result).toHaveLength(1);
      const queryStr = mockPool.query.mock.calls[0][0] as string;
      expect(queryStr).toContain('outlet_ids IS NULL OR $2 = ANY(outlet_ids)');
      const params = mockPool.query.mock.calls[0][1];
      expect(params[1]).toBe(outletId);
    });

    it('should return empty array when no plans exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.listPlans(tenantId);
      expect(result).toEqual([]);
    });
  });

  describe('deletePlan', () => {
    it('should soft delete by setting is_active = false', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

      await service.deletePlan(planId);

      const queryStr = mockPool.query.mock.calls[0][0] as string;
      expect(queryStr).toContain('is_active = false');
      expect(queryStr).toContain('WHERE id = $1');
    });

    it('should throw NotFoundException if plan not found or already deleted', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0 });

      await expect(service.deletePlan('missing-id')).rejects.toThrow(NotFoundException);
    });
  });
});
