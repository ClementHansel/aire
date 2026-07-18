import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { DEFAULT_AUTOMATION_SETTINGS } from '../settings/settings.interfaces';

/**
 * Mock pool for database queries.
 */
function createMockPool() {
  return {
    query: vi.fn(),
  };
}

describe('AdminService', () => {
  let service: AdminService;
  let mockPool: ReturnType<typeof createMockPool>;
  let mockLegal: { create: ReturnType<typeof vi.fn> };
  let mockOutlets: { create: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = createMockPool();
    mockLegal = { create: vi.fn() };
    mockOutlets = { create: vi.fn() };
    service = new AdminService(mockPool as any, mockLegal as any, mockOutlets as any);
  });

  describe('listTenants', () => {
    it('should return mapped tenant records', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            id: 'tenant-001',
            name: 'AIRE Wash',
            slug: 'aire-wash',
            plan: 'standard',
            status: 'active',
            settings: {},
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          },
        ],
      });

      const result = await service.listTenants();

      expect(result).toEqual([
        {
          id: 'tenant-001',
          name: 'AIRE Wash',
          slug: 'aire-wash',
          plan: 'standard',
          status: 'active',
          settings: {},
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ]);
    });

    it('should return empty array when no tenants exist', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await service.listTenants();

      expect(result).toEqual([]);
    });
  });

  describe('createTenant', () => {
    it('should create a tenant with defaults', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            id: 'tenant-new',
            name: 'New Wash',
            slug: 'new-wash',
            plan: 'standard',
            status: 'active',
            settings: {},
            created_at: '2024-06-01T00:00:00Z',
            updated_at: '2024-06-01T00:00:00Z',
          },
        ],
      });

      const result = await service.createTenant({ name: 'New Wash', slug: 'new-wash' });

      expect(result.name).toBe('New Wash');
      expect(result.slug).toBe('new-wash');
      expect(result.plan).toBe('standard');
      // New tenants are seeded with the default automation settings (same as
      // self-service register), not an empty object.
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tenants'),
        ['New Wash', 'new-wash', 'standard', JSON.stringify(DEFAULT_AUTOMATION_SETTINGS)],
      );
    });

    it('should create a tenant with custom plan and settings', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            id: 'tenant-new',
            name: 'Premium Wash',
            slug: 'premium-wash',
            plan: 'premium',
            status: 'active',
            settings: { maxOutlets: 10 },
            created_at: '2024-06-01T00:00:00Z',
            updated_at: '2024-06-01T00:00:00Z',
          },
        ],
      });

      const result = await service.createTenant({
        name: 'Premium Wash',
        slug: 'premium-wash',
        plan: 'premium',
        settings: { maxOutlets: 10 },
      });

      expect(result.plan).toBe('premium');
      // Caller settings are merged over the defaults.
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tenants'),
        ['Premium Wash', 'premium-wash', 'premium', JSON.stringify({ ...DEFAULT_AUTOMATION_SETTINGS, maxOutlets: 10 })],
      );
    });

    it('should throw BadRequestException when name is missing', async () => {
      await expect(
        service.createTenant({ name: '', slug: 'test' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when slug is missing', async () => {
      await expect(
        service.createTenant({ name: 'Test', slug: '' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateTenant', () => {
    it('should update tenant fields dynamically', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            id: 'tenant-001',
            name: 'Updated Name',
            slug: 'updated-slug',
            plan: 'premium',
            status: 'active',
            settings: {},
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-06-01T00:00:00Z',
          },
        ],
      });

      const result = await service.updateTenant('tenant-001', {
        name: 'Updated Name',
        plan: 'premium',
      });

      expect(result.name).toBe('Updated Name');
      expect(result.plan).toBe('premium');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE tenants SET'),
        expect.arrayContaining(['Updated Name', 'premium', 'tenant-001']),
      );
    });

    it('should throw BadRequestException when no fields provided', async () => {
      await expect(service.updateTenant('tenant-001', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException when tenant does not exist', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await expect(
        service.updateTenant('nonexistent', { name: 'Test' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // Status transitions (suspend/reactivate/cancel) moved to TenantLifecycleService
  // — see tenant-lifecycle.service.test.ts.

  describe('getPlatformConfig', () => {
    it('should return platform config from database', async () => {
      const config = {
        defaultPlans: ['standard', 'premium'],
        pricingTiers: [{ name: 'basic', price: 100 }],
        featureFlags: { darkMode: true },
      };
      mockPool.query.mockResolvedValue({ rows: [{ config }] });

      const result = await service.getPlatformConfig();

      expect(result).toEqual(config);
    });

    it('should return default config when no config exists', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await service.getPlatformConfig();

      expect(result).toEqual({
        defaultPlans: ['standard', 'premium', 'enterprise'],
        pricingTiers: [],
        featureFlags: {},
      });
    });
  });

  describe('updatePlatformConfig', () => {
    it('should upsert platform config', async () => {
      const config = {
        defaultPlans: ['standard', 'premium', 'enterprise'],
        pricingTiers: [],
        featureFlags: { darkMode: true },
      };
      mockPool.query.mockResolvedValue({ rows: [{ config }] });

      const result = await service.updatePlatformConfig({
        featureFlags: { darkMode: true },
      });

      expect(result).toEqual(config);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO platform_config'),
        [JSON.stringify({ featureFlags: { darkMode: true } })],
      );
    });
  });
});
