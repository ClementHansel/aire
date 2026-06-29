import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { TenantService, CreateTenantDto, UpdateTenantDto } from './tenant.service';

describe('TenantService', () => {
  let service: TenantService;
  let mockPool: { query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = { query: vi.fn() };
    service = new TenantService(mockPool as any);
  });

  describe('create', () => {
    it('should insert a tenant with all provided fields', async () => {
      const dto: CreateTenantDto = {
        name: 'AIRE Car Wash',
        slug: 'aire-car-wash',
        plan: 'premium',
        status: 'active',
        settings: { featureFlags: { alpr: true }, paymentConfig: { provider: 'xendit' } },
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'tenant-001',
            name: 'AIRE Car Wash',
            slug: 'aire-car-wash',
            plan: 'premium',
            status: 'active',
            settings: { featureFlags: { alpr: true }, paymentConfig: { provider: 'xendit' } },
            created_at: new Date('2024-06-15T10:00:00.000Z'),
            updated_at: new Date('2024-06-15T10:00:00.000Z'),
          },
        ],
      });

      const result = await service.create(dto);

      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO tenants');
      expect(params[0]).toBe('AIRE Car Wash');
      expect(params[1]).toBe('aire-car-wash');
      expect(params[2]).toBe('premium');
      expect(params[3]).toBe('active');
      expect(JSON.parse(params[4])).toEqual({
        featureFlags: { alpr: true },
        paymentConfig: { provider: 'xendit' },
      });

      expect(result.id).toBe('tenant-001');
      expect(result.name).toBe('AIRE Car Wash');
      expect(result.slug).toBe('aire-car-wash');
      expect(result.plan).toBe('premium');
      expect(result.status).toBe('active');
      expect(result.createdAt).toBe('2024-06-15T10:00:00.000Z');
    });

    it('should default plan to "standard" and status to "active"', async () => {
      const dto: CreateTenantDto = { name: 'Basic Wash', slug: 'basic-wash' };

      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'tenant-002',
            name: 'Basic Wash',
            slug: 'basic-wash',
            plan: 'standard',
            status: 'active',
            settings: {},
            created_at: new Date('2024-06-15T10:00:00.000Z'),
            updated_at: new Date('2024-06-15T10:00:00.000Z'),
          },
        ],
      });

      await service.create(dto);

      const [, params] = mockPool.query.mock.calls[0];
      expect(params[2]).toBe('standard');
      expect(params[3]).toBe('active');
      expect(params[4]).toBe('{}');
    });
  });

  describe('findAll', () => {
    it('should return all tenants ordered by created_at DESC', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'tenant-002',
            name: 'Tenant B',
            slug: 'tenant-b',
            plan: 'standard',
            status: 'active',
            settings: {},
            created_at: new Date('2024-06-16T10:00:00.000Z'),
            updated_at: new Date('2024-06-16T10:00:00.000Z'),
          },
          {
            id: 'tenant-001',
            name: 'Tenant A',
            slug: 'tenant-a',
            plan: 'premium',
            status: 'suspended',
            settings: { featureFlags: { alpr: false } },
            created_at: new Date('2024-06-15T10:00:00.000Z'),
            updated_at: new Date('2024-06-15T10:00:00.000Z'),
          },
        ],
      });

      const result = await service.findAll();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('tenant-002');
      expect(result[1].id).toBe('tenant-001');
      expect(result[1].status).toBe('suspended');

      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('ORDER BY created_at DESC');
    });
  });

  describe('findById', () => {
    it('should return a tenant when found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'tenant-001',
            name: 'AIRE',
            slug: 'aire',
            plan: 'premium',
            status: 'active',
            settings: { featureFlags: { alpr: true } },
            created_at: new Date('2024-06-15T10:00:00.000Z'),
            updated_at: new Date('2024-06-15T10:00:00.000Z'),
          },
        ],
      });

      const result = await service.findById('tenant-001');

      expect(result.id).toBe('tenant-001');
      expect(result.name).toBe('AIRE');
      expect(result.settings).toEqual({ featureFlags: { alpr: true } });
    });

    it('should throw NotFoundException when tenant not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.findById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update specified fields only', async () => {
      const dto: UpdateTenantDto = { name: 'Updated Name', status: 'suspended' };

      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'tenant-001',
            name: 'Updated Name',
            slug: 'aire',
            plan: 'premium',
            status: 'suspended',
            settings: {},
            created_at: new Date('2024-06-15T10:00:00.000Z'),
            updated_at: new Date('2024-06-16T10:00:00.000Z'),
          },
        ],
      });

      const result = await service.update('tenant-001', dto);

      expect(result.name).toBe('Updated Name');
      expect(result.status).toBe('suspended');

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('name = $1');
      expect(sql).toContain('status = $2');
      expect(sql).toContain('updated_at = NOW()');
      expect(params[0]).toBe('Updated Name');
      expect(params[1]).toBe('suspended');
      expect(params[2]).toBe('tenant-001'); // WHERE id
    });

    it('should update settings as JSON', async () => {
      const dto: UpdateTenantDto = {
        settings: { featureFlags: { alpr: false, kiosk: true } },
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'tenant-001',
            name: 'AIRE',
            slug: 'aire',
            plan: 'premium',
            status: 'active',
            settings: { featureFlags: { alpr: false, kiosk: true } },
            created_at: new Date('2024-06-15T10:00:00.000Z'),
            updated_at: new Date('2024-06-16T10:00:00.000Z'),
          },
        ],
      });

      const result = await service.update('tenant-001', dto);

      expect(result.settings).toEqual({ featureFlags: { alpr: false, kiosk: true } });
      const [, params] = mockPool.query.mock.calls[0];
      expect(JSON.parse(params[0])).toEqual({ featureFlags: { alpr: false, kiosk: true } });
    });

    it('should return existing tenant if no fields to update', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'tenant-001',
            name: 'AIRE',
            slug: 'aire',
            plan: 'premium',
            status: 'active',
            settings: {},
            created_at: new Date('2024-06-15T10:00:00.000Z'),
            updated_at: new Date('2024-06-15T10:00:00.000Z'),
          },
        ],
      });

      const result = await service.update('tenant-001', {});

      expect(result.id).toBe('tenant-001');
      // Should call findById (SELECT) not UPDATE
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('SELECT');
    });

    it('should throw NotFoundException when tenant not found during update', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.update('nonexistent', { name: 'New' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
