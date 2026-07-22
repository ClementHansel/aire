import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { CampaignService } from './campaign.service';

describe('CampaignService', () => {
  let service: CampaignService;
  let mockPool: { query: ReturnType<typeof vi.fn> };

  const tenantId = 'tenant-001';
  const campaignId = 'campaign-001';
  const planId = 'plan-001';
  const bonusTemplateId = 'template-001';

  const mockRow = {
    id: campaignId,
    tenant_id: tenantId,
    name: 'July Membership Bonus',
    plan_id: planId,
    bonus_template_id: bonusTemplateId,
    start_date: '2026-07-01',
    end_date: '2026-07-31',
    cap: 100,
    per_customer_limit: 1,
    grants_count: 0,
    status: 'active',
    created_at: new Date('2026-07-01'),
    updated_at: new Date('2026-07-01'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = { query: vi.fn() };
    service = new CampaignService(mockPool as any);
  });

  describe('create', () => {
    it('creates a campaign scoped to the tenant with default status/limits', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await service.create(tenantId, {
        name: 'July Membership Bonus',
        planId,
        bonusTemplateId,
        startDate: '2026-07-01',
        endDate: '2026-07-31',
        cap: 100,
      });

      expect(result.id).toBe(campaignId);
      expect(result.tenantId).toBe(tenantId);
      expect(result.status).toBe('active');
      expect(result.grantsCount).toBe(0);

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO campaigns');
      expect(params[0]).toBe(tenantId);
      expect(params[7]).toBe(1); // perCustomerLimit default
      expect(params[8]).toBe('active'); // status default
    });

    it('rejects a campaign whose startDate is after endDate', async () => {
      await expect(
        service.create(tenantId, {
          name: 'Bad window',
          planId,
          bonusTemplateId,
          startDate: '2026-08-01',
          endDate: '2026-07-01',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('rejects a missing name', async () => {
      await expect(
        service.create(tenantId, {
          name: '  ',
          planId,
          bonusTemplateId,
          startDate: '2026-07-01',
          endDate: '2026-07-31',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('updates only the provided fields and is tenant-scoped', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ ...mockRow, status: 'paused' }] });

      const result = await service.update(tenantId, campaignId, { status: 'paused' });

      expect(result.status).toBe('paused');
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('UPDATE campaigns');
      expect(sql).toContain('WHERE id = $2 AND tenant_id = $3');
      expect(params).toEqual(['paused', campaignId, tenantId]);
    });

    it('throws NotFoundException when the campaign does not belong to the tenant', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.update(tenantId, campaignId, { status: 'paused' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects an invalid status', async () => {
      await expect(
        service.update(tenantId, campaignId, { status: 'bogus' as any }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('deactivate', () => {
    it('sets status to paused', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ ...mockRow, status: 'paused' }] });

      const result = await service.deactivate(tenantId, campaignId);

      expect(result.status).toBe('paused');
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain("status = 'paused'");
      expect(params).toEqual([campaignId, tenantId]);
    });

    it('throws NotFoundException when no row matches', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.deactivate(tenantId, campaignId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('list / get', () => {
    it('lists campaigns for the tenant', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await service.list(tenantId);

      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe(campaignId);
      expect(mockPool.query.mock.calls[0][1]).toEqual([tenantId]);
    });

    it('throws NotFoundException when getting a campaign outside the tenant', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.get(tenantId, campaignId)).rejects.toThrow(NotFoundException);
    });
  });
});
