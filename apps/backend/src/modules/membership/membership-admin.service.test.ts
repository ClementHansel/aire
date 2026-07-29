import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import {
  ERR_MEMBERSHIP_NOT_FOUND,
  ERR_MEMBERSHIP_MAX_PLATES_EXCEEDED,
  ERR_MEMBERSHIP_MIN_ONE_PLATE,
  ERR_MEMBERSHIP_ALREADY_CANCELLED,
} from '@aire/shared';
import { MembershipAdminService } from './membership-admin.service';
import { MembershipPlate } from './interfaces';

/**
 * MembershipAdminService.updatePlates / .cancel — POS plate CRUD + cancel.
 *
 * These orchestration methods delegate every actual plate mutation to
 * MembershipPlateService (already covered by membership-plate.service.test.ts,
 * including its own audit_logs entries), so here we fake that collaborator and
 * assert MembershipAdminService's own decisions: tenant scoping, max/min
 * plate enforcement, add/update/remove diffing, and the cancel audit + event.
 */
describe('MembershipAdminService', () => {
  let service: MembershipAdminService;
  let mockPool: { query: ReturnType<typeof vi.fn> };
  let lifecycle: { recordEvent: ReturnType<typeof vi.fn>; history: ReturnType<typeof vi.fn> };
  let plateService: {
    getPlates: ReturnType<typeof vi.fn>;
    addPlate: ReturnType<typeof vi.fn>;
    updatePlate: ReturnType<typeof vi.fn>;
    removePlate: ReturnType<typeof vi.fn>;
    releasePlates: ReturnType<typeof vi.fn>;
  };
  let eventBus: { emit: ReturnType<typeof vi.fn> };

  const tenantId = 'tenant-001';
  const membershipId = 'membership-001';
  const planId = 'plan-001';
  const operatorId = 'operator-001';

  const existingPlate = (over: Partial<MembershipPlate> = {}): MembershipPlate => ({
    id: 'plate-001',
    membershipId,
    plate: 'B 1234 ABC',
    plateNormalized: 'B1234ABC',
    brand: 'Toyota',
    model: 'Avanza',
    createdAt: new Date('2024-01-01'),
    ...over,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = { query: vi.fn() };
    lifecycle = { recordEvent: vi.fn().mockResolvedValue(undefined), history: vi.fn() };
    plateService = {
      getPlates: vi.fn().mockResolvedValue([existingPlate()]),
      addPlate: vi.fn().mockResolvedValue(existingPlate({ id: 'plate-new' })),
      updatePlate: vi.fn().mockResolvedValue(existingPlate()),
      removePlate: vi.fn().mockResolvedValue(undefined),
      releasePlates: vi.fn().mockResolvedValue(undefined),
    };
    eventBus = { emit: vi.fn() };
    service = new MembershipAdminService(mockPool as any, lifecycle as any, plateService as any, eventBus as any);
  });

  describe('updatePlates', () => {
    it('throws NotFoundException when the membership is not in the caller tenant', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // membership lookup scoped by tenant
      await expect(
        service.updatePlates(tenantId, membershipId, [{ plate: 'B 9999 ZZ' }], operatorId),
      ).rejects.toThrow(NotFoundException);

      mockPool.query.mockResolvedValueOnce({ rows: [] });
      await expect(
        service.updatePlates(tenantId, membershipId, [{ plate: 'B 9999 ZZ' }], operatorId),
      ).rejects.toThrow(ERR_MEMBERSHIP_NOT_FOUND);
    });

    it('rejects an empty plate list (at least one plate required)', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ plan_id: planId }] });
      mockPool.query.mockResolvedValueOnce({ rows: [{ max_plates: 3 }] });

      await expect(
        service.updatePlates(tenantId, membershipId, [], operatorId),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects more plates than the plan allows', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ plan_id: planId }] });
      mockPool.query.mockResolvedValueOnce({ rows: [{ max_plates: 1 }] });

      await expect(
        service.updatePlates(
          tenantId, membershipId,
          [{ plate: 'B 1111 AA' }, { plate: 'B 2222 BB' }],
          operatorId,
        ),
      ).rejects.toThrow(ERR_MEMBERSHIP_MAX_PLATES_EXCEEDED);
    });

    it('adds a genuinely new plate and leaves the unchanged one alone', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ plan_id: planId }] });
      mockPool.query.mockResolvedValueOnce({ rows: [{ max_plates: 3 }] });
      plateService.getPlates.mockResolvedValueOnce([existingPlate()]);

      await service.updatePlates(
        tenantId, membershipId,
        [{ plate: 'B 1234 ABC', brand: 'Toyota', model: 'Avanza' }, { plate: 'D 5678 XYZ', brand: 'Honda' }],
        operatorId,
      );

      expect(plateService.removePlate).not.toHaveBeenCalled();
      expect(plateService.updatePlate).not.toHaveBeenCalled();
      expect(plateService.addPlate).toHaveBeenCalledWith(membershipId, 'D 5678 XYZ', 'Honda', undefined, operatorId);
    });

    it('updates a plate whose brand/model changed', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ plan_id: planId }] });
      mockPool.query.mockResolvedValueOnce({ rows: [{ max_plates: 3 }] });
      plateService.getPlates.mockResolvedValueOnce([existingPlate()]);

      await service.updatePlates(
        tenantId, membershipId,
        [{ plate: 'B 1234 ABC', brand: 'Toyota', model: 'Innova' }],
        operatorId,
      );

      expect(plateService.updatePlate).toHaveBeenCalledWith('plate-001', 'B 1234 ABC', 'Toyota', 'Innova', operatorId);
      expect(plateService.addPlate).not.toHaveBeenCalled();
      expect(plateService.removePlate).not.toHaveBeenCalled();
    });

    it('removes a plate that is no longer in the submitted list', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ plan_id: planId }] });
      mockPool.query.mockResolvedValueOnce({ rows: [{ max_plates: 3 }] });
      plateService.getPlates.mockResolvedValueOnce([existingPlate(), existingPlate({ id: 'plate-002', plate: 'D 5678 XYZ', plateNormalized: 'D5678XYZ' })]);

      await service.updatePlates(
        tenantId, membershipId,
        [{ plate: 'B 1234 ABC', brand: 'Toyota', model: 'Avanza' }],
        operatorId,
      );

      expect(plateService.removePlate).toHaveBeenCalledWith('plate-002', operatorId);
      expect(plateService.updatePlate).not.toHaveBeenCalled();
      expect(plateService.addPlate).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('throws NotFoundException when the membership is not in the caller tenant', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.cancel(tenantId, membershipId, 'no longer needed', operatorId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects cancelling an already-cancelled membership', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ status: 'cancelled' }] });

      await expect(service.cancel(tenantId, membershipId, undefined, operatorId)).rejects.toThrow(
        ERR_MEMBERSHIP_ALREADY_CANCELLED,
      );
    });

    it('cancels an active membership: updates status, releases plates, records event + audit log', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ status: 'active' }] }); // lookup
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // UPDATE
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // audit_logs INSERT

      await service.cancel(tenantId, membershipId, 'customer request', operatorId);

      expect(plateService.releasePlates).toHaveBeenCalledWith(membershipId);
      expect(lifecycle.recordEvent).toHaveBeenCalledWith(
        mockPool, tenantId, membershipId, 'cancelled', { reason: 'customer request' }, operatorId,
      );

      const auditCall = mockPool.query.mock.calls.find((c: unknown[]) => String(c[0]).includes('INSERT INTO audit_logs'))!;
      const params = auditCall[1] as unknown[];
      expect(params[0]).toBe(tenantId);
      expect(params[1]).toBe(operatorId);
      expect(params[2]).toBe('membership_cancelled');
      expect(params[3]).toBe('membership');
      expect(params[4]).toBe(membershipId);
      expect(JSON.parse(params[5] as string)).toEqual({ status: 'active' });
      expect(JSON.parse(params[6] as string)).toEqual({ status: 'cancelled', reason: 'customer request' });

      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'membership.cancelled', tenantId, payload: { membershipId, reason: 'customer request' } }),
      );
    });
  });

  /**
   * list — the CRM members list AND the dashboard's "Membership purchases"
   * section (AIRIN-133) share this endpoint. dateFrom/dateTo/outletIds are
   * optional so the CRM (which passes none of them) keeps seeing the full
   * tenant list; the dashboard passes them to filter by purchase date
   * (the linked fee order's created_at) and branch.
   */
  describe('list', () => {
    it('queries with no filter clauses and no extra params when no filters are given', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      await service.list(tenantId);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).not.toContain('o.outlet_id = ANY');
      expect(sql).not.toContain('o.created_at >=');
      expect(sql).toContain('LEFT JOIN orders o ON o.id = m.order_id');
      expect(params).toEqual([tenantId]);
    });

    it('adds outlet_id/date filter clauses (and their params) only when provided', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      await service.list(tenantId, undefined, {
        dateFrom: '2026-07-01', dateTo: '2026-07-31', outletIds: ['outlet-1'],
      });
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('o.outlet_id = ANY($2::uuid[])');
      expect(sql).toContain('o.created_at >= $3::timestamptz');
      expect(sql).toContain("o.created_at < ($4::date + INTERVAL '1 day')");
      expect(params).toEqual([tenantId, ['outlet-1'], '2026-07-01', '2026-07-31']);
    });

    it('maps the linked order\'s created_at to purchaseDate (dropping the startDate proxy)', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: membershipId, customer_name: 'Budi', customer_phone: '0811', membership_number: 'M-001',
          plan_name: 'Unlimited Wash', status: 'active', start_date: '2026-07-01', end_date: '2026-08-01',
          uses_count: 0, max_uses: 31, suspended_reason: null,
          purchase_date: new Date('2026-06-28T03:00:00Z'), display_status: 'active',
        }],
      });
      const rows = await service.list(tenantId);
      expect(rows[0]!.purchaseDate).toBe(new Date('2026-06-28T03:00:00Z').toISOString());
    });

    it('leaves purchaseDate null for a membership with no linked order', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: membershipId, customer_name: 'Budi', customer_phone: '0811', membership_number: null,
          plan_name: 'Unlimited Wash', status: 'active', start_date: '2026-07-01', end_date: '2026-08-01',
          uses_count: 0, max_uses: 31, suspended_reason: null,
          purchase_date: null, display_status: 'active',
        }],
      });
      const rows = await service.list(tenantId);
      expect(rows[0]!.purchaseDate).toBeNull();
    });
  });
});
