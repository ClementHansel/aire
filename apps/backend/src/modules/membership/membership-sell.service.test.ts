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
    /**
     * Route mocked queries by the SQL they run instead of by call order.
     * Positional `mockResolvedValueOnce` chains broke en masse the moment
     * activation grew one query in the middle (the existing-plate dedupe
     * lookup), even though every assertion still held — routing by SQL means a
     * new best-effort query can't invalidate the whole suite.
     */
    const routeQueries = (opts: {
      membership?: MembershipRow | null;
      plan?: { max_plates: number; duration_months: number } | null;
      /** plate_normalized values already registered on the membership. */
      existingPlates?: string[];
    } = {}) => {
      const membership = opts.membership === undefined ? mockMembershipRow : opts.membership;
      const plan = opts.plan === undefined ? { max_plates: 3, duration_months: 3 } : opts.plan;
      mockPool.query.mockImplementation((sql: string) => {
        const s = String(sql);
        if (s.includes('FROM memberships WHERE id')) {
          return Promise.resolve({ rows: membership ? [membership] : [] });
        }
        if (s.includes('FROM membership_plans')) {
          return Promise.resolve({ rows: plan ? [plan] : [] });
        }
        if (s.includes('FROM membership_plates')) {
          return Promise.resolve({
            rows: (opts.existingPlates ?? []).map((p) => ({ plate_normalized: p })),
          });
        }
        if (s.includes('UPDATE memberships')) {
          return Promise.resolve({ rows: [{ ...membership, status: MembershipStatus.Active }] });
        }
        if (s.includes('INSERT INTO membership_plates')) {
          return Promise.resolve({
            rows: [{
              id: 'plate-x', membership_id: membershipId, plate: 'B 1234 ABC',
              plate_normalized: 'B1234ABC', brand: null, model: null, created_at: new Date(),
            }],
          });
        }
        return Promise.resolve({ rows: [] });
      });
    };

    const sqlsRun = () => mockPool.query.mock.calls.map((c: unknown[]) => String(c[0]));
    const plateInserts = () => mockPool.query.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('INSERT INTO membership_plates'));
    const todayStr = () => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    it('should activate membership with start_date = today and register plates', async () => {
      routeQueries();

      const result = await service.activateMembership(membershipId, {
        plates: [{ plate: 'B 1234 ABC', brand: 'Toyota', model: 'Avanza' }],
      });

      expect(result.status).toBe(MembershipStatus.Active);

      const updateCall = mockPool.query.mock.calls.find((c: unknown[]) =>
        String(c[0]).includes('UPDATE memberships'))!;
      const updateParams = updateCall[1] as unknown[];
      expect(updateParams[0]).toBe(MembershipStatus.Active);
      expect(updateParams[1]).toBe(todayStr());
      expect(plateInserts()).toHaveLength(1);
    });

    it('should throw NotFoundException if membership does not exist', async () => {
      routeQueries({ membership: null });

      await expect(
        service.activateMembership('nonexistent', { plates: [] }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if plates exceed max_plates', async () => {
      routeQueries({ plan: { max_plates: 2, duration_months: 3 } });

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

    it('should count plates already registered against max_plates', async () => {
      // The sale registered the order's car; the plan allows two vehicles, so
      // only ONE more may be added — asking for two must be rejected.
      routeQueries({ plan: { max_plates: 2, duration_months: 3 }, existingPlates: ['B1111AA'] });

      await expect(
        service.activateMembership(membershipId, {
          plates: [{ plate: 'B 2222 BB' }, { plate: 'B 3333 CC' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should not re-register a plate the membership already carries', async () => {
      // The POS pre-fills the order's plate, which the sale itself already
      // recorded. Re-submitting it must be a no-op, not a duplicate row — and
      // must not trip the max_plates limit on a single-plate plan.
      routeQueries({ plan: { max_plates: 1, duration_months: 3 }, existingPlates: ['B1234ABC'] });

      const result = await service.activateMembership(membershipId, {
        plates: [{ plate: 'B 1234 ABC', brand: 'Toyota', model: 'Avanza' }],
      });

      expect(result.status).toBe(MembershipStatus.Active);
      expect(plateInserts()).toHaveLength(0);
    });

    it('should keep an already-active membership term intact when adding a vehicle', async () => {
      // Payment activates the membership; adding a second vehicle afterwards
      // must not restart the paid term from today.
      routeQueries({
        membership: { ...mockMembershipRow, status: MembershipStatus.Active },
        plan: { max_plates: 3, duration_months: 3 },
        existingPlates: ['B1111AA'],
      });

      const result = await service.activateMembership(membershipId, {
        plates: [{ plate: 'B 2222 BB' }],
      });

      expect(result.startDate).toBe(mockMembershipRow.start_date);
      expect(result.endDate).toBe(mockMembershipRow.end_date);
      expect(sqlsRun().some((s: string) => s.includes('UPDATE memberships'))).toBe(false);
      expect(plateInserts()).toHaveLength(1);
    });

    it('should allow registering exactly max_plates plates', async () => {
      routeQueries({ plan: { max_plates: 3, duration_months: 3 } });

      const result = await service.activateMembership(membershipId, {
        plates: [
          { plate: 'B 1111 AA' },
          { plate: 'B 2222 BB' },
          { plate: 'B 3333 CC' },
        ],
      });

      expect(result.status).toBe(MembershipStatus.Active);
      expect(plateInserts()).toHaveLength(3);
    });

    it('should activate without plates (empty plate list)', async () => {
      routeQueries();

      const result = await service.activateMembership(membershipId, { plates: [] });

      expect(result.status).toBe(MembershipStatus.Active);
      const sqls = sqlsRun();
      expect(sqls.some((s: string) => s.includes('INSERT INTO membership_plates'))).toBe(false);
      expect(sqls.some((s: string) => s.includes('INSERT INTO order_tags'))).toBe(true);
      expect(sqls.some((s: string) => s.includes('INSERT INTO audit_logs'))).toBe(true);
    });

    it('should throw NotFoundException when tenantId is provided and does not match', async () => {
      routeQueries();

      await expect(
        service.activateMembership(membershipId, { plates: [] }, 'some-other-tenant'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should write an audit_logs row for the activation with operator + before/after', async () => {
      routeQueries();

      await service.activateMembership(membershipId, { plates: [] }, tenantId, 'operator-999');

      const auditCall = mockPool.query.mock.calls.find((c: unknown[]) =>
        String(c[0]).includes('INSERT INTO audit_logs'),
      )!;
      const params = auditCall[1] as unknown[];
      expect(params[0]).toBe(tenantId);
      expect(params[1]).toBe('operator-999');
      expect(params[2]).toBe('membership_activated');
      expect(params[3]).toBe('membership');
      expect(params[4]).toBe(membershipId);
      expect(JSON.parse(params[5] as string)).toEqual({ status: MembershipStatus.Pending });
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
