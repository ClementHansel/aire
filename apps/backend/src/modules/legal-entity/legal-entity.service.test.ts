import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { LegalEntityService } from './legal-entity.service';

describe('LegalEntityService', () => {
  let service: LegalEntityService;
  let mockPool: { query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = { query: vi.fn() };
    service = new LegalEntityService(mockPool as any);
  });

  const row = {
    id: 'le-001',
    tenant_id: 'tenant-001',
    name: 'PT Aire Bersih Nusantara',
    npwp: '01.234.567.8-901.000',
    address: 'Jl. Sudirman',
    phone: '021-123',
    is_active: true,
    created_at: new Date('2026-07-12T00:00:00.000Z'),
    updated_at: new Date('2026-07-12T00:00:00.000Z'),
  };

  describe('findAll', () => {
    it('scopes to the tenant and orders by name', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [row] });
      const result = await service.findAll('tenant-001');
      expect(result).toHaveLength(1);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('WHERE tenant_id = $1');
      expect(sql).toContain('ORDER BY name');
      expect(params[0]).toBe('tenant-001');
    });

    it('adds an active-only filter when requested', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      await service.findAll('tenant-001', true);
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('is_active = true');
    });
  });

  describe('create', () => {
    it('inserts a trimmed name with the tenant id', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [row] });
      const result = await service.create('tenant-001', { name: '  PT Aire Bersih Nusantara  ', npwp: '01.234.567.8-901.000' });
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO legal_entities');
      expect(params[0]).toBe('tenant-001');
      expect(params[1]).toBe('PT Aire Bersih Nusantara');
      expect(params[2]).toBe('01.234.567.8-901.000');
      expect(result.id).toBe('le-001');
    });

    it('rejects a blank name without hitting the db', async () => {
      await expect(service.create('tenant-001', { name: '   ' })).rejects.toThrow(BadRequestException);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('maps a unique-violation to a friendly BadRequest', async () => {
      mockPool.query.mockRejectedValueOnce({ code: '23505' });
      await expect(service.create('tenant-001', { name: 'PT Dup' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('scopes the update to id AND tenant', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [row] });
      await service.update('tenant-001', 'le-001', { npwp: '99' });
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('npwp = $1');
      expect(sql).toMatch(/WHERE id = \$2 AND tenant_id = \$3/);
      expect(params[1]).toBe('le-001');
      expect(params[2]).toBe('tenant-001');
    });

    it('throws NotFound when nothing matched', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      await expect(service.update('tenant-001', 'missing', { npwp: '1' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('throws NotFound when no row was deleted', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0 });
      await expect(service.remove('tenant-001', 'missing')).rejects.toThrow(NotFoundException);
    });
  });
});
