import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, ForbiddenException, BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { DEFAULT_AUTOMATION_SETTINGS } from './settings.interfaces';

// Mock the encryption utilities
vi.mock('./encryption.util', () => ({
  encrypt: vi.fn((value: string) => `encrypted:${value}`),
  decrypt: vi.fn((value: string) => {
    if (value.startsWith('encrypted:')) {
      return value.replace('encrypted:', '');
    }
    return value;
  }),
}));

function createMockPool() {
  return { query: vi.fn() };
}

function createMockAuditService() {
  return { log: vi.fn().mockResolvedValue(undefined) };
}

describe('SettingsService', () => {
  let service: SettingsService;
  let mockPool: ReturnType<typeof createMockPool>;
  let mockAudit: ReturnType<typeof createMockAuditService>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = createMockPool();
    mockAudit = createMockAuditService();
    service = new SettingsService(mockPool as any, mockAudit as any);
  });

  describe('getSettings', () => {
    it('should retrieve and decrypt settings for a tenant', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          settings: {
            ai_enabled: true,
            whatsapp_phone: '+6281234567890',
            whatsapp_token_encrypted: 'encrypted:my-token',
            llm_provider: 'openrouter',
            llm_api_key_encrypted: 'encrypted:my-api-key',
            automation_toggles: { campaigns: true, retention_offers: false, pricing_suggestions: false, anomaly_alerts: false, queue_optimization: false, membership_recommendations: false },
            approval_modes: { campaigns: 'autonomous', retention_offers: 'approval_required', pricing_suggestions: 'approval_required', anomaly_alerts: 'approval_required', queue_optimization: 'approval_required', membership_recommendations: 'approval_required' },
            schedule_interval: 'daily',
            discovered_devices: [],
          },
        }],
      });

      const result = await service.getSettings('tenant-001');

      expect(result.ai_enabled).toBe(true);
      expect(result.whatsapp_phone).toBe('+6281234567890');
      expect(result.whatsapp_token_encrypted).toBe('my-token');
      expect(result.llm_api_key_encrypted).toBe('my-api-key');
      expect(result.automation_toggles.campaigns).toBe(true);
      expect(result.approval_modes.campaigns).toBe('autonomous');
    });

    it('should apply defaults for missing optional fields', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          settings: {
            ai_enabled: false,
            automation_toggles: {},
            approval_modes: {},
          },
        }],
      });

      const result = await service.getSettings('tenant-001');

      // Default provider is 'openrouter' (see DEFAULT_AUTOMATION_SETTINGS).
      expect(result.llm_provider).toBe('openrouter');
      expect(result.whatsapp_phone).toBeNull();
      expect(result.automation_toggles.campaigns).toBe(false);
      expect(result.approval_modes.campaigns).toBe('approval_required');
      expect(result.discovered_devices).toEqual([]);
    });

    it('should throw NotFoundException when tenant does not exist', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await expect(service.getSettings('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should handle null settings column gracefully', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ settings: null }],
      });

      const result = await service.getSettings('tenant-001');

      expect(result.ai_enabled).toBe(true); // brain on by default (graceful fallback)
      expect(result.automation_toggles.campaigns).toBe(false);
    });
  });

  describe('updateSettings', () => {
    it('should merge patch with existing settings and persist', async () => {
      // First query: getRawSettings
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            settings: {
              ...DEFAULT_AUTOMATION_SETTINGS,
              ai_enabled: false,
            },
          }],
        })
        // Second query: persist
        .mockResolvedValueOnce({
          rows: [{ settings: {} }],
        });

      const result = await service.updateSettings('tenant-001', 'user-001', {
        ai_enabled: true,
        llm_provider: 'openrouter',
      });

      expect(result.ai_enabled).toBe(true);
      expect(result.llm_provider).toBe('openrouter');
      // Toggles should remain unchanged (merged)
      expect(result.automation_toggles.campaigns).toBe(false);
    });

    it('does NOT re-encrypt an already-stored API key on an unrelated save (persistence bug)', async () => {
      // Stored key is already encrypted (mock: "encrypted:<plaintext>").
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            settings: {
              ...DEFAULT_AUTOMATION_SETTINGS,
              ai_enabled: true,
              llm_provider: 'openrouter',
              llm_api_key_encrypted: 'encrypted:sk-or-real-key',
            },
          }],
        })
        .mockResolvedValueOnce({ rows: [{ settings: {} }] }); // persist

      // A save that touches something else and does NOT re-supply the key.
      await service.updateSettings('tenant-001', 'user-001', { schedule_interval: 'hourly' });

      const persistedJson = mockPool.query.mock.calls[1]![1] as unknown as any[];
      const stored = JSON.parse(persistedJson[0] as string);
      // Must stay single-encrypted — NOT "encrypted:encrypted:sk-or-real-key".
      expect(stored.llm_api_key_encrypted).toBe('encrypted:sk-or-real-key');

      // And a subsequent read still decrypts back to the real key.
      mockPool.query.mockResolvedValueOnce({ rows: [{ settings: stored }] });
      const readBack = await service.getSettings('tenant-001');
      expect(readBack.llm_api_key_encrypted).toBe('sk-or-real-key');
    });

    it('should deep merge nested objects like automation_toggles', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            settings: {
              ...DEFAULT_AUTOMATION_SETTINGS,
              ai_enabled: true,
              llm_provider: 'hermes_ai',
              automation_toggles: {
                campaigns: true,
                retention_offers: false,
                pricing_suggestions: false,
                anomaly_alerts: false,
                queue_optimization: false,
                membership_recommendations: false,
              },
            },
          }],
        })
        .mockResolvedValueOnce({ rows: [{ settings: {} }] });

      const result = await service.updateSettings('tenant-001', 'user-001', {
        automation_toggles: { retention_offers: true } as any,
      });

      expect(result.automation_toggles.campaigns).toBe(true); // preserved
      expect(result.automation_toggles.retention_offers).toBe(true); // updated
    });

    it('should throw BadRequestException for invalid settings', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          settings: { ...DEFAULT_AUTOMATION_SETTINGS },
        }],
      });

      await expect(
        service.updateSettings('tenant-001', 'user-001', {
          whatsapp_phone: 'invalid-phone' as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should audit-log the change', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ settings: { ...DEFAULT_AUTOMATION_SETTINGS } }],
        })
        .mockResolvedValueOnce({ rows: [{ settings: {} }] });

      await service.updateSettings('tenant-001', 'user-001', {
        ai_enabled: true,
      });

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-001',
          userId: 'user-001',
          operation: 'config_change',
          entityType: 'tenant_settings',
        }),
      );
    });

    it('should encrypt sensitive fields before storage', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ settings: { ...DEFAULT_AUTOMATION_SETTINGS } }],
        })
        .mockResolvedValueOnce({ rows: [{ settings: {} }] });

      await service.updateSettings('tenant-001', 'user-001', {
        whatsapp_token_encrypted: 'my-secret-token',
      });

      // Check that the persisted value was encrypted
      const persistCall = mockPool.query.mock.calls[1];
      const storedJson = JSON.parse(persistCall![0] as unknown as string === undefined
        ? (persistCall![1] as any[])[0]
        : (persistCall![1] as any[])[0]);
      expect(storedJson.whatsapp_token_encrypted).toBe('encrypted:my-secret-token');
    });

    it('should throw NotFoundException if tenant not found during persist', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ settings: { ...DEFAULT_AUTOMATION_SETTINGS } }],
        })
        .mockResolvedValueOnce({ rows: [] }); // persist returns empty

      await expect(
        service.updateSettings('nonexistent', 'user-001', { ai_enabled: true }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('validateSettings', () => {
    it('should accept valid settings', () => {
      const result = service.validateSettings(DEFAULT_AUTOMATION_SETTINGS);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeNull();
    });

    it('should reject settings with invalid phone number format', () => {
      const invalid = {
        ...DEFAULT_AUTOMATION_SETTINGS,
        whatsapp_phone: 'not-a-phone',
      };

      const result = service.validateSettings(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors).not.toBeNull();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it('should reject settings with invalid approval mode value', () => {
      const invalid = {
        ...DEFAULT_AUTOMATION_SETTINGS,
        approval_modes: {
          ...DEFAULT_AUTOMATION_SETTINGS.approval_modes,
          campaigns: 'invalid_mode',
        },
      };

      const result = service.validateSettings(invalid);
      expect(result.valid).toBe(false);
    });

    it('should reject settings with invalid llm_provider', () => {
      const invalid = {
        ...DEFAULT_AUTOMATION_SETTINGS,
        llm_provider: 'invalid_provider',
      };

      const result = service.validateSettings(invalid);
      expect(result.valid).toBe(false);
    });

    it('should accept settings with null optional fields', () => {
      const valid = {
        ...DEFAULT_AUTOMATION_SETTINGS,
        whatsapp_phone: null,
        schedule_interval: null,
      };

      const result = service.validateSettings(valid);
      expect(result.valid).toBe(true);
    });
  });

  describe('initializeDefaults', () => {
    it('should persist default settings to database', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await service.initializeDefaults('tenant-001');

      expect(result.ai_enabled).toBe(true); // brain on by default; action toggles stay off
      expect(result.automation_toggles.campaigns).toBe(false);
      expect(result.automation_toggles.retention_offers).toBe(false);
      expect(result.automation_toggles.pricing_suggestions).toBe(false);
      expect(result.automation_toggles.anomaly_alerts).toBe(false);
      expect(result.automation_toggles.queue_optimization).toBe(false);
      expect(result.automation_toggles.membership_recommendations).toBe(false);
      expect(result.approval_modes.campaigns).toBe('approval_required');
      expect(result.approval_modes.retention_offers).toBe('approval_required');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE tenants SET settings'),
        expect.arrayContaining(['tenant-001']),
      );
    });
  });

  describe('verifyTenantOwner', () => {
    it('should return true for tenant_owner role', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ role: 'tenant_owner' }],
      });

      const result = await service.verifyTenantOwner('tenant-001', 'user-001');
      expect(result).toBe(true);
    });

    it('should return true for platform_super_admin role', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ role: 'platform_super_admin' }],
      });

      const result = await service.verifyTenantOwner('tenant-001', 'admin-001');
      expect(result).toBe(true);
    });

    it('should return false for other roles', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ role: 'cashier' }],
      });

      const result = await service.verifyTenantOwner('tenant-001', 'cashier-001');
      expect(result).toBe(false);
    });

    it('should return false when user not found', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await service.verifyTenantOwner('tenant-001', 'nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('enforceOwnerRole', () => {
    it('should not throw for tenant_owner', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ role: 'tenant_owner' }],
      });

      await expect(
        service.enforceOwnerRole('tenant-001', 'user-001'),
      ).resolves.toBeUndefined();
    });

    it('should throw ForbiddenException for unauthorized user', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ role: 'cashier' }],
      });

      await expect(
        service.enforceOwnerRole('tenant-001', 'cashier-001'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('checkPrerequisites', () => {
    it('should throw UnprocessableEntityException when ai_enabled is false', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          settings: {
            ...DEFAULT_AUTOMATION_SETTINGS,
            ai_enabled: false,
          },
        }],
      });

      await expect(
        service.checkPrerequisites('tenant-001', 'campaigns'),
      ).rejects.toThrow(UnprocessableEntityException);

      try {
        await service.checkPrerequisites('tenant-001', 'campaigns');
      } catch (error: any) {
        expect(error.getResponse()).toEqual({
          error: 'Prerequisite not met',
          details: { missing: 'ai_enabled', toggle: 'campaigns' },
        });
      }
    });

    it('should throw UnprocessableEntityException when llm_provider is openrouter and no API key', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          settings: {
            ...DEFAULT_AUTOMATION_SETTINGS,
            ai_enabled: true,
            llm_provider: 'openrouter',
            llm_api_key_encrypted: null,
          },
        }],
      });

      await expect(
        service.checkPrerequisites('tenant-001', 'campaigns'),
      ).rejects.toThrow(UnprocessableEntityException);

      try {
        await service.checkPrerequisites('tenant-001', 'campaigns');
      } catch (error: any) {
        expect(error.getResponse()).toEqual({
          error: 'Prerequisite not met',
          details: { missing: 'llm_api_key', toggle: 'campaigns' },
        });
      }
    });

    it('should throw UnprocessableEntityException when llm_provider is openrouter and API key is empty string', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          settings: {
            ...DEFAULT_AUTOMATION_SETTINGS,
            ai_enabled: true,
            llm_provider: 'openrouter',
            llm_api_key_encrypted: '',
          },
        }],
      });

      await expect(
        service.checkPrerequisites('tenant-001', 'retention_offers'),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should pass when ai_enabled is true and llm_provider is hermes_ai', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          settings: {
            ...DEFAULT_AUTOMATION_SETTINGS,
            ai_enabled: true,
            llm_provider: 'hermes_ai',
          },
        }],
      });

      await expect(
        service.checkPrerequisites('tenant-001', 'campaigns'),
      ).resolves.toBeUndefined();
    });

    it('should pass when ai_enabled is true, llm_provider is openrouter, and API key is present', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          settings: {
            ...DEFAULT_AUTOMATION_SETTINGS,
            ai_enabled: true,
            llm_provider: 'openrouter',
            llm_api_key_encrypted: 'encrypted:some-api-key',
          },
        }],
      });

      await expect(
        service.checkPrerequisites('tenant-001', 'anomaly_alerts'),
      ).resolves.toBeUndefined();
    });

    it('should accept settingsOverride instead of reading from database', async () => {
      const overrideSettings = {
        ...DEFAULT_AUTOMATION_SETTINGS,
        ai_enabled: true,
        llm_provider: 'hermes_ai' as const,
      };

      // No DB calls should be made
      await expect(
        service.checkPrerequisites('tenant-001', 'campaigns', overrideSettings),
      ).resolves.toBeUndefined();

      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('cancelPendingProposals', () => {
    it('should expire pending proposals for the given tenant and toggle type', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ id: 'proposal-1' }, { id: 'proposal-2' }],
        rowCount: 2,
      });

      const count = await service.cancelPendingProposals('tenant-001', 'campaigns');

      expect(count).toBe(2);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE action_proposals'),
        ['tenant-001', 'campaigns'],
      );
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'expired'"),
        expect.any(Array),
      );
    });

    it('should return 0 when there are no pending proposals to cancel', async () => {
      mockPool.query.mockResolvedValue({
        rows: [],
        rowCount: 0,
      });

      const count = await service.cancelPendingProposals('tenant-001', 'retention_offers');

      expect(count).toBe(0);
    });
  });

  describe('updateSettings - prerequisite integration', () => {
    it('should reject toggle activation when ai_enabled is false', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          settings: {
            ...DEFAULT_AUTOMATION_SETTINGS,
            ai_enabled: false,
          },
        }],
      });

      await expect(
        service.updateSettings('tenant-001', 'user-001', {
          automation_toggles: { campaigns: true } as any,
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should reject toggle activation when openrouter provider has no API key', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          settings: {
            ...DEFAULT_AUTOMATION_SETTINGS,
            ai_enabled: true,
            llm_provider: 'openrouter',
            llm_api_key_encrypted: null,
          },
        }],
      });

      await expect(
        service.updateSettings('tenant-001', 'user-001', {
          automation_toggles: { campaigns: true } as any,
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should allow toggle activation when prerequisites are met', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            settings: {
              ...DEFAULT_AUTOMATION_SETTINGS,
              ai_enabled: true,
              llm_provider: 'openrouter',
              llm_api_key_encrypted: 'encrypted:valid-key',
            },
          }],
        })
        .mockResolvedValueOnce({ rows: [{ settings: {} }] }) // persist
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // no proposals to cancel (toggle wasn't previously on)

      const result = await service.updateSettings('tenant-001', 'user-001', {
        automation_toggles: { campaigns: true } as any,
      });

      expect(result.automation_toggles.campaigns).toBe(true);
    });

    it('should cancel pending proposals when a toggle is disabled', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            settings: {
              ...DEFAULT_AUTOMATION_SETTINGS,
              ai_enabled: true,
              llm_provider: 'hermes_ai',
              automation_toggles: {
                ...DEFAULT_AUTOMATION_SETTINGS.automation_toggles,
                campaigns: true,
              },
            },
          }],
        })
        .mockResolvedValueOnce({ rows: [{ settings: {} }] }) // persist
        .mockResolvedValueOnce({ rows: [{ id: 'proposal-1' }], rowCount: 1 }); // cancel proposals

      await service.updateSettings('tenant-001', 'user-001', {
        automation_toggles: { campaigns: false } as any,
      });

      // Verify the cancel proposals query was called
      const cancelCall = mockPool.query.mock.calls[2];
      expect(cancelCall![0]).toContain('UPDATE action_proposals');
      expect(cancelCall![1]).toEqual(['tenant-001', 'campaigns']);
    });

    it('should not cancel proposals when toggle was already disabled', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            settings: {
              ...DEFAULT_AUTOMATION_SETTINGS,
              ai_enabled: true,
              llm_provider: 'hermes_ai',
              automation_toggles: {
                ...DEFAULT_AUTOMATION_SETTINGS.automation_toggles,
                campaigns: false, // already disabled
              },
            },
          }],
        })
        .mockResolvedValueOnce({ rows: [{ settings: {} }] }); // persist

      await service.updateSettings('tenant-001', 'user-001', {
        automation_toggles: { campaigns: false } as any,
      });

      // Only 2 queries: getRawSettings + persist (no cancel proposals call)
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it('should not check prerequisites when toggle is not being newly enabled', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            settings: {
              ...DEFAULT_AUTOMATION_SETTINGS,
              ai_enabled: false, // prerequisite not met
              automation_toggles: {
                ...DEFAULT_AUTOMATION_SETTINGS.automation_toggles,
                campaigns: true, // but already enabled
              },
            },
          }],
        })
        .mockResolvedValueOnce({ rows: [{ settings: {} }] }); // persist

      // Setting campaigns: true when it's already true should NOT trigger prerequisite check
      await expect(
        service.updateSettings('tenant-001', 'user-001', {
          automation_toggles: { campaigns: true } as any,
        }),
      ).resolves.toBeDefined();
    });
  });
});
