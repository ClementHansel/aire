import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role } from '@aire/shared';
import type { JWTPayload } from '@aire/shared';
import { AdminController } from './admin.controller';
import { AdminService, TenantRecord, PlatformConfig } from './admin.service';

describe('AdminController', () => {
  let controller: AdminController;
  let mockAdminService: {
    listTenants: ReturnType<typeof vi.fn>;
    createTenant: ReturnType<typeof vi.fn>;
    updateTenant: ReturnType<typeof vi.fn>;
    getPlatformConfig: ReturnType<typeof vi.fn>;
    updatePlatformConfig: ReturnType<typeof vi.fn>;
    resolveTenantId: ReturnType<typeof vi.fn>;
  };
  let mockLifecycle: {
    suspend: ReturnType<typeof vi.fn>;
    reactivate: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    history: ReturnType<typeof vi.fn>;
    recordPlanChange: ReturnType<typeof vi.fn>;
  };

  // A super-admin actor for endpoints that take @CurrentUser().
  const superUser = { sub: 'admin-1', role: Role.PlatformSuperAdmin } as unknown as JWTPayload;

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
      getPlatformConfig: vi.fn().mockResolvedValue(mockConfig),
      updatePlatformConfig: vi.fn().mockResolvedValue(mockConfig),
      // Slug/UUID resolver used by the :id tenant routes (identity passthrough for tests).
      resolveTenantId: vi.fn().mockImplementation(async (id: string) => id),
    };
    // Status transitions now live in TenantLifecycleService (the single writer).
    mockLifecycle = {
      suspend: vi.fn().mockResolvedValue({ ...mockTenant, status: 'suspended' }),
      reactivate: vi.fn().mockResolvedValue(mockTenant),
      cancel: vi.fn().mockResolvedValue({ ...mockTenant, status: 'cancelled' }),
      history: vi.fn().mockResolvedValue([]),
      recordPlanChange: vi.fn().mockResolvedValue(undefined),
    };
    controller = new AdminController(mockAdminService as unknown as AdminService);
    (controller as unknown as { lifecycle: typeof mockLifecycle }).lifecycle = mockLifecycle;
  });

  describe('listTenants', () => {
    it('should return list of all tenants', async () => {
      // A super-admin sees every tenant unfiltered.
      const result = await controller.listTenants(superUser);

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

      const result = await controller.updateTenant(superUser, 'tenant-001', dto);

      expect(mockAdminService.updateTenant).toHaveBeenCalledWith('tenant-001', dto);
      expect(result).toEqual(mockTenant);
    });
  });

  describe('suspendTenant', () => {
    it('should suspend a tenant by id via the lifecycle service', async () => {
      const result = await controller.suspendTenant(superUser, 'tenant-001', { reason: 'nonpayment' });

      expect(mockLifecycle.suspend).toHaveBeenCalledWith('tenant-001', {
        reason: 'nonpayment',
        actorUserId: 'admin-1',
        source: 'admin',
      });
      expect(result.status).toBe('suspended');
    });
  });

  describe('reactivateTenant', () => {
    it('should reactivate a suspended tenant via the lifecycle service', async () => {
      const result = await controller.reactivateTenant(superUser, 'tenant-001', {});

      expect(mockLifecycle.reactivate).toHaveBeenCalledWith('tenant-001', {
        reason: undefined,
        actorUserId: 'admin-1',
        source: 'admin',
      });
      expect(result.status).toBe('active');
    });
  });

  describe('cancelTenant', () => {
    it('should cancel a tenant via the lifecycle service', async () => {
      const result = await controller.cancelTenant(superUser, 'tenant-001', { reason: 'churned' });

      expect(mockLifecycle.cancel).toHaveBeenCalledWith('tenant-001', {
        reason: 'churned',
        actorUserId: 'admin-1',
        source: 'admin',
      });
      expect(result.status).toBe('cancelled');
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
