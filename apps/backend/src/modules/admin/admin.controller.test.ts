import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdminController } from './admin.controller';
import { AdminService, TenantRecord, PlatformConfig } from './admin.service';

describe('AdminController', () => {
  let controller: AdminController;
  let mockAdminService: {
    listTenants: ReturnType<typeof vi.fn>;
    createTenant: ReturnType<typeof vi.fn>;
    updateTenant: ReturnType<typeof vi.fn>;
    suspendTenant: ReturnType<typeof vi.fn>;
    reactivateTenant: ReturnType<typeof vi.fn>;
    getPlatformConfig: ReturnType<typeof vi.fn>;
    updatePlatformConfig: ReturnType<typeof vi.fn>;
  };

  const mockTenant: TenantRecord = {
    id: 'tenant-001',
    name: 'AIRE Car Wash',
    slug: 'aire-car-wash',
    plan: 'standard',
    status: 'active',
    settings: {},
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  const mockConfig: PlatformConfig = {
    defaultPlans: ['standard', 'premium', 'enterprise'],
    pricingTiers: [],
    featureFlags: { darkMode: true },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminService = {
      listTenants: vi.fn().mockResolvedValue([mockTenant]),
      createTenant: vi.fn().mockResolvedValue(mockTenant),
      updateTenant: vi.fn().mockResolvedValue(mockTenant),
      suspendTenant: vi.fn().mockResolvedValue({ ...mockTenant, status: 'suspended' }),
      reactivateTenant: vi.fn().mockResolvedValue(mockTenant),
      getPlatformConfig: vi.fn().mockResolvedValue(mockConfig),
      updatePlatformConfig: vi.fn().mockResolvedValue(mockConfig),
    };
    controller = new AdminController(mockAdminService as unknown as AdminService);
  });

  describe('listTenants', () => {
    it('should return list of all tenants', async () => {
      const result = await controller.listTenants();

      expect(mockAdminService.listTenants).toHaveBeenCalled();
      expect(result).toEqual([mockTenant]);
    });
  });

  describe('createTenant', () => {
    it('should create a tenant with provided data', async () => {
      const dto = { name: 'AIRE Car Wash', slug: 'aire-car-wash' };

      const result = await controller.createTenant(dto);

      expect(mockAdminService.createTenant).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockTenant);
    });

    it('should pass optional fields when provided', async () => {
      const dto = {
        name: 'Premium Wash',
        slug: 'premium-wash',
        plan: 'premium',
        settings: { featureX: true },
      };

      await controller.createTenant(dto);

      expect(mockAdminService.createTenant).toHaveBeenCalledWith(dto);
    });
  });

  describe('updateTenant', () => {
    it('should update a tenant by id', async () => {
      const dto = { name: 'Updated Name' };

      const result = await controller.updateTenant('tenant-001', dto);

      expect(mockAdminService.updateTenant).toHaveBeenCalledWith('tenant-001', dto);
      expect(result).toEqual(mockTenant);
    });
  });

  describe('suspendTenant', () => {
    it('should suspend a tenant by id', async () => {
      const result = await controller.suspendTenant('tenant-001');

      expect(mockAdminService.suspendTenant).toHaveBeenCalledWith('tenant-001');
      expect(result.status).toBe('suspended');
    });
  });

  describe('reactivateTenant', () => {
    it('should reactivate a suspended tenant', async () => {
      const result = await controller.reactivateTenant('tenant-001');

      expect(mockAdminService.reactivateTenant).toHaveBeenCalledWith('tenant-001');
      expect(result.status).toBe('active');
    });
  });

  describe('getPlatformConfig', () => {
    it('should return the platform configuration', async () => {
      const result = await controller.getPlatformConfig();

      expect(mockAdminService.getPlatformConfig).toHaveBeenCalled();
      expect(result).toEqual(mockConfig);
    });
  });

  describe('updatePlatformConfig', () => {
    it('should update platform configuration', async () => {
      const update = { featureFlags: { darkMode: true } };

      const result = await controller.updatePlatformConfig(update);

      expect(mockAdminService.updatePlatformConfig).toHaveBeenCalledWith(update);
      expect(result).toEqual(mockConfig);
    });
  });
});
