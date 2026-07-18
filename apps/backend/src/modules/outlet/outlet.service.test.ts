import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { OutletService, CreateOutletDto, UpdateOutletDto } from './outlet.service';

describe('OutletService', () => {
  let service: OutletService;
  let mockPool: { query: ReturnType<typeof vi.fn> };
  let mockEntitlements: { assertWithin: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = { query: vi.fn() };
    // Entitlement guard is a no-op in these unit tests (limits enforced elsewhere).
    mockEntitlements = { assertWithin: vi.fn().mockResolvedValue(undefined) };
    service = new OutletService(mockPool as any, mockEntitlements as any);
  });

  const mockOutletRow = {
    id: 'outlet-001',
    tenant_id: 'tenant-001',
    name: 'Outlet Jakarta',
    agent_id: 'jkt-001',
    address: 'Jl. Sudirman No. 1',
    timezone: 'Asia/Jakarta',
    is_active: true,
    settings: { service_charge_pct: 5, tax_pct: 11, free_void_window_minutes: 5 },
    created_at: new Date('2024-06-15T10:00:00.000Z'),
    updated_at: new Date('2024-06-15T10:00:00.000Z'),
  };

  describe('create', () => {
    it('should insert an outlet with all provided fields', async () => {
      const dto: CreateOutletDto = {
        tenantId: 'tenant-001',
        name: 'Outlet Jakarta',
        agentId: 'jkt-001',
        address: 'Jl. Sudirman No. 1',
        timezone: 'Asia/Jakarta',
        isActive: true,
        settings: { service_charge_pct: 5, tax_pct: 11, free_void_window_minutes: 5 },
      };

      mockPool.query.mockResolvedValueOnce({ rows: [mockOutletRow] });

      const result = await service.create(dto);

      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO outlets');
      expect(params[0]).toBe('tenant-001');
      expect(params[1]).toBe('Outlet Jakarta');
      expect(params[2]).toBe('jkt-001');
      expect(params[3]).toBe('OUT'); // code derived from name
      expect(params[4]).toBeNull(); // legalEntity
      expect(params[5]).toBe('Jl. Sudirman No. 1'); // address
      expect(params[6]).toBeNull(); // phone
      expect(params[7]).toBeNull(); // mapsUrl
      expect(params[8]).toBe('Asia/Jakarta'); // timezone
      expect(params[9]).toBe(true); // isActive
      expect(JSON.parse(params[10])).toEqual({
        service_charge_pct: 5,
        tax_pct: 11,
        free_void_window_minutes: 5,
      });

      expect(result.id).toBe('outlet-001');
      expect(result.tenantId).toBe('tenant-001');
      expect(result.agentId).toBe('jkt-001');
      expect(result.isActive).toBe(true);
    });

    it('should default timezone to Asia/Jakarta and isActive to true', async () => {
      const dto: CreateOutletDto = {
        tenantId: 'tenant-001',
        name: 'Outlet Bandung',
        agentId: 'bdg-001',
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockOutletRow, id: 'outlet-002', name: 'Outlet Bandung', agent_id: 'bdg-001', address: null }],
      });

      await service.create(dto);

      const [, params] = mockPool.query.mock.calls[0];
      expect(params[5]).toBeNull(); // address
      expect(params[8]).toBe('Asia/Jakarta'); // timezone default
      expect(params[9]).toBe(true); // isActive default
      expect(params[10]).toBe('{}'); // empty settings
    });
  });

  describe('findAll', () => {
    it('should return all outlets when no tenantId filter', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [mockOutletRow, { ...mockOutletRow, id: 'outlet-002', tenant_id: 'tenant-002' }],
      });

      const result = await service.findAll();

      expect(result).toHaveLength(2);
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).not.toContain('WHERE tenant_id');
      expect(sql).toContain('ORDER BY created_at DESC');
    });

    it('should filter by tenantId when provided', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockOutletRow] });

      const result = await service.findAll('tenant-001');

      expect(result).toHaveLength(1);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('WHERE tenant_id = $1');
      expect(params[0]).toBe('tenant-001');
    });
  });

  describe('findById', () => {
    it('should return an outlet when found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockOutletRow] });

      const result = await service.findById('outlet-001');

      expect(result.id).toBe('outlet-001');
      expect(result.name).toBe('Outlet Jakarta');
      expect(result.settings).toEqual({
        service_charge_pct: 5,
        tax_pct: 11,
        free_void_window_minutes: 5,
      });
    });

    it('should throw NotFoundException when outlet not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.findById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update specified fields only', async () => {
      const dto: UpdateOutletDto = { name: 'Outlet Surabaya', address: 'Jl. Tunjungan No. 5' };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockOutletRow, name: 'Outlet Surabaya', address: 'Jl. Tunjungan No. 5' }],
      });

      const result = await service.update('outlet-001', dto);

      expect(result.name).toBe('Outlet Surabaya');
      expect(result.address).toBe('Jl. Tunjungan No. 5');

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('name = $1');
      expect(sql).toContain('address = $2');
      expect(sql).toContain('updated_at = NOW()');
      expect(params[0]).toBe('Outlet Surabaya');
      expect(params[1]).toBe('Jl. Tunjungan No. 5');
      expect(params[2]).toBe('outlet-001'); // WHERE id
    });

    it('should update settings as JSON', async () => {
      const dto: UpdateOutletDto = {
        settings: { service_charge_pct: 10, tax_pct: 12 },
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockOutletRow, settings: { service_charge_pct: 10, tax_pct: 12 } }],
      });

      const result = await service.update('outlet-001', dto);

      expect(result.settings).toEqual({ service_charge_pct: 10, tax_pct: 12 });
      const [, params] = mockPool.query.mock.calls[0];
      expect(JSON.parse(params[0])).toEqual({ service_charge_pct: 10, tax_pct: 12 });
    });

    it('should return existing outlet if no fields to update', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockOutletRow] });

      const result = await service.update('outlet-001', {});

      expect(result.id).toBe('outlet-001');
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('SELECT');
    });

    it('should throw NotFoundException when outlet not found during update', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.update('nonexistent', { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('activate', () => {
    it('should set is_active to true', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockOutletRow, is_active: true }],
      });

      const result = await service.activate('outlet-001');

      expect(result.isActive).toBe(true);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('is_active = true');
      expect(sql).toContain('updated_at = NOW()');
      expect(params[0]).toBe('outlet-001');
    });

    it('should throw NotFoundException when outlet not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.activate('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('deactivate', () => {
    it('should set is_active to false', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockOutletRow, is_active: false }],
      });

      const result = await service.deactivate('outlet-001');

      expect(result.isActive).toBe(false);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('is_active = false');
      expect(sql).toContain('updated_at = NOW()');
      expect(params[0]).toBe('outlet-001');
    });

    it('should throw NotFoundException when outlet not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.deactivate('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});
