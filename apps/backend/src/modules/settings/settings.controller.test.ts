import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  UnprocessableEntityException,
  InternalServerErrorException,
} from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { DEFAULT_AUTOMATION_SETTINGS, TenantAutomationSettings } from './settings.interfaces';
import { JWTPayload } from '@aire/shared';

describe('SettingsController', () => {
  let controller: SettingsController;
  let mockSettingsService: {
    getSettings: ReturnType<typeof vi.fn>;
    updateSettings: ReturnType<typeof vi.fn>;
    enforceOwnerRole: ReturnType<typeof vi.fn>;
  };

  const mockTenantId = 'tenant-001';
  const mockUserId = 'user-001';

  const mockUser: JWTPayload = {
    sub: mockUserId,
    tenant_id: mockTenantId,
    outlet_id: null,
    role: 'tenant_owner',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };

  const mockSettings: TenantAutomationSettings = {
    ...DEFAULT_AUTOMATION_SETTINGS,
    ai_enabled: true,
    llm_provider: 'hermes_ai',
    whatsapp_phone: '+6281234567890',
    whatsapp_token_encrypted: 'decrypted-token',
    automation_toggles: {
      campaigns: true,
      retention_offers: false,
      pricing_suggestions: false,
      anomaly_alerts: false,
      queue_optimization: false,
      membership_recommendations: false,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsService = {
      getSettings: vi.fn().mockResolvedValue(mockSettings),
      updateSettings: vi.fn().mockResolvedValue(mockSettings),
      enforceOwnerRole: vi.fn().mockResolvedValue(undefined),
    };
    controller = new SettingsController(
      mockSettingsService as unknown as SettingsService,
    );
  });

  describe('GET /api/settings/:tenantId', () => {
    it('should retrieve decrypted settings for authorized user', async () => {
      const result = await controller.getSettings(mockTenantId);

      expect(mockSettingsService.getSettings).toHaveBeenCalledWith(mockTenantId);
      expect(result).toEqual(mockSettings);
      expect(result.ai_enabled).toBe(true);
      expect(result.whatsapp_phone).toBe('+6281234567890');
    });

    it('should return full TenantAutomationSettings structure', async () => {
      const result = await controller.getSettings(mockTenantId);

      expect(result).toHaveProperty('ai_enabled');
      expect(result).toHaveProperty('automation_toggles');
      expect(result).toHaveProperty('approval_modes');
      expect(result).toHaveProperty('llm_provider');
      expect(result).toHaveProperty('discovered_devices');
    });

    it('should throw NotFoundException when tenant does not exist (404)', async () => {
      mockSettingsService.getSettings.mockRejectedValue(
        new NotFoundException('Tenant nonexistent not found'),
      );

      await expect(controller.getSettings('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should propagate InternalServerErrorException on encryption failure (500)', async () => {
      mockSettingsService.getSettings.mockRejectedValue(
        new InternalServerErrorException('Internal configuration error'),
      );

      await expect(controller.getSettings(mockTenantId)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('PATCH /api/settings/:tenantId', () => {
    it('should update settings with a valid partial payload', async () => {
      const patch: Partial<TenantAutomationSettings> = {
        ai_enabled: true,
        llm_provider: 'openrouter',
      };

      const result = await controller.updateSettings(mockTenantId, mockUser, patch);

      expect(mockSettingsService.enforceOwnerRole).toHaveBeenCalledWith(
        mockTenantId,
        mockUserId,
      );
      expect(mockSettingsService.updateSettings).toHaveBeenCalledWith(
        mockTenantId,
        mockUserId,
        patch,
      );
      expect(result).toEqual(mockSettings);
    });

    it('should enforce owner role before performing update', async () => {
      const patch: Partial<TenantAutomationSettings> = { ai_enabled: false };

      await controller.updateSettings(mockTenantId, mockUser, patch);

      // enforceOwnerRole should be called before updateSettings
      const enforceCallOrder = mockSettingsService.enforceOwnerRole.mock.invocationCallOrder[0];
      const updateCallOrder = mockSettingsService.updateSettings.mock.invocationCallOrder[0];
      expect(enforceCallOrder).toBeLessThan(updateCallOrder!);
    });

    it('should throw ForbiddenException for unauthorized user (403)', async () => {
      mockSettingsService.enforceOwnerRole.mockRejectedValue(
        new ForbiddenException('Only Tenant_Owner can modify settings'),
      );

      const cashierUser: JWTPayload = {
        ...mockUser,
        sub: 'cashier-001',
        role: 'cashier',
      };

      await expect(
        controller.updateSettings(mockTenantId, cashierUser, { ai_enabled: true }),
      ).rejects.toThrow(ForbiddenException);

      // updateSettings should not be called if owner role check fails
      expect(mockSettingsService.updateSettings).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException for invalid JSON schema payload (400)', async () => {
      mockSettingsService.updateSettings.mockRejectedValue(
        new BadRequestException({
          error: 'Validation failed',
          details: [
            {
              instancePath: '/whatsapp_phone',
              message: 'must match pattern "^\\+[1-9]\\d{1,14}$"',
            },
          ],
        }),
      );

      await expect(
        controller.updateSettings(mockTenantId, mockUser, {
          whatsapp_phone: 'invalid-phone',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw UnprocessableEntityException when prerequisite not met (422)', async () => {
      mockSettingsService.updateSettings.mockRejectedValue(
        new UnprocessableEntityException({
          error: 'Prerequisite not met',
          details: { missing: 'llm_api_key', toggle: 'campaigns' },
        }),
      );

      await expect(
        controller.updateSettings(mockTenantId, mockUser, {
          automation_toggles: { campaigns: true } as any,
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should throw NotFoundException when tenant not found during update (404)', async () => {
      mockSettingsService.updateSettings.mockRejectedValue(
        new NotFoundException('Tenant nonexistent not found'),
      );

      await expect(
        controller.updateSettings('nonexistent', mockUser, { ai_enabled: true }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should propagate InternalServerErrorException on encryption failure (500)', async () => {
      mockSettingsService.updateSettings.mockRejectedValue(
        new InternalServerErrorException('Internal configuration error'),
      );

      await expect(
        controller.updateSettings(mockTenantId, mockUser, {
          whatsapp_token_encrypted: 'some-token',
        }),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should pass user sub (userId) from JWT payload to service', async () => {
      const adminUser: JWTPayload = {
        sub: 'admin-999',
        tenant_id: mockTenantId,
        outlet_id: null,
        role: 'platform_super_admin',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      };

      await controller.updateSettings(mockTenantId, adminUser, { ai_enabled: true });

      expect(mockSettingsService.enforceOwnerRole).toHaveBeenCalledWith(
        mockTenantId,
        'admin-999',
      );
      expect(mockSettingsService.updateSettings).toHaveBeenCalledWith(
        mockTenantId,
        'admin-999',
        { ai_enabled: true },
      );
    });

    it('should allow partial update of nested automation_toggles', async () => {
      const patch = {
        automation_toggles: { retention_offers: true },
      } as Partial<TenantAutomationSettings>;

      await controller.updateSettings(mockTenantId, mockUser, patch);

      expect(mockSettingsService.updateSettings).toHaveBeenCalledWith(
        mockTenantId,
        mockUserId,
        patch,
      );
    });

    it('should allow partial update of approval_modes', async () => {
      const patch = {
        approval_modes: { campaigns: 'autonomous' },
      } as Partial<TenantAutomationSettings>;

      await controller.updateSettings(mockTenantId, mockUser, patch);

      expect(mockSettingsService.updateSettings).toHaveBeenCalledWith(
        mockTenantId,
        mockUserId,
        patch,
      );
    });
  });
});
