import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Pool } from 'pg';
import Ajv, { ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import { DATABASE_POOL } from '../auth/database.provider';
import type { TenantAutomationSettings, AutomationToggles } from './settings.interfaces';
import { DEFAULT_AUTOMATION_SETTINGS } from './settings.interfaces';
import { TENANT_AUTOMATION_SETTINGS_SCHEMA } from './settings.schema';
import { encrypt, decrypt } from './encryption.util';
import { AuditService } from '../audit/audit.service';

/** Fields that must be encrypted before storage and decrypted on read. */
const SENSITIVE_FIELDS: (keyof TenantAutomationSettings)[] = [
  'whatsapp_token_encrypted',
  'llm_api_key_encrypted',
];

/**
 * Result of a settings validation attempt.
 */
export interface ValidationResult {
  valid: boolean;
  errors: ErrorObject[] | null;
}

/**
 * Settings Service.
 *
 * Manages per-tenant automation settings with JSON Schema validation,
 * encryption of sensitive fields, and audit logging.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 4.2, 12.1, 12.2, 12.3, 12.5
 */
@Injectable()
export class SettingsService {
  private readonly ajv: Ajv;
  private readonly validate: ReturnType<Ajv['compile']>;

  constructor(
    @Inject(DATABASE_POOL) readonly pool: Pool,
    private readonly auditService: AuditService,
  ) {
    this.ajv = new Ajv({ allErrors: true, useDefaults: true });
    addFormats(this.ajv);
    this.validate = this.ajv.compile(TENANT_AUTOMATION_SETTINGS_SCHEMA);
  }

  /**
   * Retrieve automation settings for a tenant, decrypting sensitive fields.
   *
   * Requirements: 1.1, 12.3
   */
  async getSettings(tenantId: string): Promise<TenantAutomationSettings> {
    const result = await this.pool.query<{ settings: Record<string, unknown> }>(
      `SELECT settings FROM tenants WHERE id = $1`,
      [tenantId],
    );

    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException(`Tenant ${tenantId} not found`);
    }

    const raw = (row.settings ?? {}) as Record<string, unknown>;
    // Merge with defaults to fill missing optional fields (Req 12.5)
    const settings = this.applyDefaults(raw);

    // Decrypt sensitive fields
    return this.decryptSensitiveFields(settings);
  }

  /**
   * Update automation settings for a tenant. Merges the patch with existing
   * settings (partial update), validates against JSON Schema, encrypts
   * sensitive fields, persists, and audit-logs the change.
   *
   * Requirements: 1.3, 1.4, 1.5, 12.2, 12.5
   */
  async updateSettings(
    tenantId: string,
    userId: string,
    patch: Partial<TenantAutomationSettings>,
  ): Promise<TenantAutomationSettings> {
    // 1. Verify tenant exists and get current settings
    const current = await this.getRawSettings(tenantId);

    // 2. Merge patch with current settings (deep merge for nested objects)
    const merged = this.mergeSettings(current, patch);

    // 3. Prerequisite validation for automation toggles being enabled (Req 3.5, 4.4, 4.5)
    if (patch.automation_toggles) {
      for (const key of Object.keys(patch.automation_toggles) as (keyof AutomationToggles)[]) {
        const isBeingEnabled = patch.automation_toggles[key] === true && !current.automation_toggles[key];
        if (isBeingEnabled) {
          await this.checkPrerequisites(tenantId, key, merged);
        }
      }
    }

    // 4. Validate merged settings against JSON Schema
    const validation = this.validateSettings(merged);
    if (!validation.valid) {
      throw new BadRequestException({
        error: 'Validation failed',
        details: validation.errors,
      });
    }

    // 5. Encrypt sensitive fields before storage
    const toStore = this.encryptSensitiveFields(merged);

    // 6. Persist to database
    const updateResult = await this.pool.query<{ settings: Record<string, unknown> }>(
      `UPDATE tenants SET settings = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING settings`,
      [JSON.stringify(toStore), tenantId],
    );

    if (!updateResult.rows[0]) {
      throw new NotFoundException(`Tenant ${tenantId} not found`);
    }

    // 7. Cancel pending proposals for any toggles being disabled (Req 4.6)
    if (patch.automation_toggles) {
      for (const key of Object.keys(patch.automation_toggles) as (keyof AutomationToggles)[]) {
        const isBeingDisabled = patch.automation_toggles[key] === false && current.automation_toggles[key];
        if (isBeingDisabled) {
          await this.cancelPendingProposals(tenantId, key);
        }
      }
    }

    // 8. Audit-log the change with before/after values
    await this.auditService.log({
      tenantId,
      userId,
      operation: 'config_change',
      entityType: 'tenant_settings',
      entityId: tenantId,
      beforeValue: this.sanitizeForAudit(current),
      afterValue: this.sanitizeForAudit(merged),
    });

    // 9. Return the decrypted merged settings
    return this.decryptSensitiveFields(merged);
  }

  /**
   * Validate a settings payload against the JSON Schema.
   * Returns errors or success.
   *
   * Requirements: 1.3, 12.2
   */
  validateSettings(settings: unknown): ValidationResult {
    // Clone to avoid mutating input (ajv useDefaults modifies in-place)
    const clone = JSON.parse(JSON.stringify(settings));
    const valid = this.validate(clone);
    return {
      valid: !!valid,
      errors: valid ? null : (this.validate.errors ?? null),
    };
  }

  /**
   * Initialize default automation settings for a newly created tenant.
   * Sets all toggles OFF, approval modes to "approval_required",
   * ai_enabled to false.
   *
   * Requirements: 1.2, 4.2
   */
  async initializeDefaults(tenantId: string): Promise<TenantAutomationSettings> {
    const defaults = { ...DEFAULT_AUTOMATION_SETTINGS };

    // Encrypt sensitive fields (both are null for defaults, but keep pattern consistent)
    const toStore = this.encryptSensitiveFields(defaults);

    await this.pool.query(
      `UPDATE tenants SET settings = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(toStore), tenantId],
    );

    return defaults;
  }

  /**
   * Check if a user has the Tenant_Owner role for a given tenant.
   * Used by the controller layer to enforce role-based access before mutations.
   *
   * Requirement: 1.5
   */
  async verifyTenantOwner(tenantId: string, userId: string): Promise<boolean> {
    const result = await this.pool.query<{ role: string }>(
      `SELECT role FROM users WHERE id = $1 AND tenant_id = $2`,
      [userId, tenantId],
    );

    const row = result.rows[0];
    if (!row) {
      return false;
    }

    return row.role === 'tenant_owner' || row.role === 'platform_super_admin';
  }

  /**
   * Enforce Tenant_Owner role check. Throws ForbiddenException if not authorized.
   *
   * Requirement: 1.5
   */
  async enforceOwnerRole(tenantId: string, userId: string): Promise<void> {
    const isOwner = await this.verifyTenantOwner(tenantId, userId);
    if (!isOwner) {
      throw new ForbiddenException('Only Tenant_Owner can modify settings');
    }
  }

  /**
   * Check whether prerequisites are met to enable a specific automation toggle.
   *
   * Rules:
   * - Any automation toggle activation requires `ai_enabled` to be true
   * - If `llm_provider` is 'openrouter', enabling any automation toggle requires
   *   `llm_api_key_encrypted` to be set (non-null, non-empty)
   *
   * Throws UnprocessableEntityException (422) if prerequisites are unmet.
   *
   * Requirements: 3.5, 4.4, 4.5
   */
  async checkPrerequisites(
    tenantId: string,
    toggleKey: keyof AutomationToggles,
    settingsOverride?: TenantAutomationSettings,
  ): Promise<void> {
    const settings = settingsOverride ?? (await this.getRawSettings(tenantId));

    // Prerequisite: ai_enabled must be true
    if (!settings.ai_enabled) {
      throw new UnprocessableEntityException({
        error: 'Prerequisite not met',
        details: { missing: 'ai_enabled', toggle: toggleKey },
      });
    }

    // Prerequisite: If llm_provider is 'openrouter', API key must be present
    if (settings.llm_provider === 'openrouter') {
      const apiKey = settings.llm_api_key_encrypted;
      if (!apiKey || apiKey.trim() === '') {
        throw new UnprocessableEntityException({
          error: 'Prerequisite not met',
          details: { missing: 'llm_api_key', toggle: toggleKey },
        });
      }
    }
  }

  /**
   * Cancel (expire) all pending ActionProposals for a given tenant and toggle type.
   *
   * When an automation toggle is disabled, any pending proposals of that capability
   * type should be marked as 'expired' so they can no longer be approved.
   *
   * Requirements: 4.6
   */
  async cancelPendingProposals(
    tenantId: string,
    toggleKey: keyof AutomationToggles,
  ): Promise<number> {
    const result = await this.pool.query<{ id: string }>(
      `UPDATE action_proposals
       SET status = 'expired', resolved_at = NOW()
       WHERE tenant_id = $1
         AND action_type = $2
         AND status = 'pending'
       RETURNING id`,
      [tenantId, toggleKey],
    );

    return result.rowCount ?? 0;
  }

  // ─── Private Helpers ────────────────────────────────────────────────

  /**
   * Get raw settings from database without decryption or defaults.
   */
  private async getRawSettings(tenantId: string): Promise<TenantAutomationSettings> {
    const result = await this.pool.query<{ settings: Record<string, unknown> }>(
      `SELECT settings FROM tenants WHERE id = $1`,
      [tenantId],
    );

    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException(`Tenant ${tenantId} not found`);
    }

    const raw = (row.settings ?? {}) as Record<string, unknown>;
    return this.applyDefaults(raw);
  }

  /**
   * Merge a partial patch into existing settings with deep merge for nested objects.
   */
  private mergeSettings(
    current: TenantAutomationSettings,
    patch: Partial<TenantAutomationSettings>,
  ): TenantAutomationSettings {
    const merged: TenantAutomationSettings = { ...current };

    for (const key of Object.keys(patch) as (keyof TenantAutomationSettings)[]) {
      const value = patch[key];
      if (value !== undefined) {
        if (
          key === 'automation_toggles' &&
          typeof value === 'object' &&
          value !== null
        ) {
          merged.automation_toggles = {
            ...current.automation_toggles,
            ...(value as Partial<TenantAutomationSettings['automation_toggles']>),
          };
        } else if (
          key === 'approval_modes' &&
          typeof value === 'object' &&
          value !== null
        ) {
          merged.approval_modes = {
            ...current.approval_modes,
            ...(value as Partial<TenantAutomationSettings['approval_modes']>),
          };
        } else {
          (merged as any)[key] = value;
        }
      }
    }

    return merged;
  }

  /**
   * Apply default values for optional fields that are omitted (Requirement 12.5).
   */
  private applyDefaults(raw: Record<string, unknown>): TenantAutomationSettings {
    const defaults = DEFAULT_AUTOMATION_SETTINGS;

    return {
      whatsapp_phone: (raw.whatsapp_phone as string | null) ?? defaults.whatsapp_phone,
      whatsapp_token_encrypted:
        (raw.whatsapp_token_encrypted as string | null) ?? defaults.whatsapp_token_encrypted,
      llm_provider:
        (raw.llm_provider as TenantAutomationSettings['llm_provider']) ?? defaults.llm_provider,
      llm_api_key_encrypted:
        (raw.llm_api_key_encrypted as string | null) ?? defaults.llm_api_key_encrypted,
      ai_enabled: typeof raw.ai_enabled === 'boolean' ? raw.ai_enabled : defaults.ai_enabled,
      automation_toggles: {
        ...defaults.automation_toggles,
        ...(typeof raw.automation_toggles === 'object' && raw.automation_toggles !== null
          ? (raw.automation_toggles as Partial<TenantAutomationSettings['automation_toggles']>)
          : {}),
      },
      approval_modes: {
        ...defaults.approval_modes,
        ...(typeof raw.approval_modes === 'object' && raw.approval_modes !== null
          ? (raw.approval_modes as Partial<TenantAutomationSettings['approval_modes']>)
          : {}),
      },
      schedule_interval:
        (raw.schedule_interval as TenantAutomationSettings['schedule_interval']) ??
        defaults.schedule_interval,
      discovered_devices: Array.isArray(raw.discovered_devices)
        ? (raw.discovered_devices as TenantAutomationSettings['discovered_devices'])
        : defaults.discovered_devices,
    };
  }

  /**
   * Encrypt sensitive fields before storage.
   */
  private encryptSensitiveFields(
    settings: TenantAutomationSettings,
  ): TenantAutomationSettings {
    const result = { ...settings };

    for (const field of SENSITIVE_FIELDS) {
      const value = result[field] as string | null;
      if (value !== null && value !== undefined && value !== '') {
        (result as any)[field] = encrypt(value);
      }
    }

    return result;
  }

  /**
   * Decrypt sensitive fields after reading from database.
   */
  private decryptSensitiveFields(
    settings: TenantAutomationSettings,
  ): TenantAutomationSettings {
    const result = { ...settings };

    for (const field of SENSITIVE_FIELDS) {
      const value = result[field] as string | null;
      if (value !== null && value !== undefined && value !== '') {
        try {
          (result as any)[field] = decrypt(value);
        } catch {
          // If decryption fails (e.g., already plaintext or corrupted),
          // leave as-is — the value may not have been encrypted yet
          (result as any)[field] = value;
        }
      }
    }

    return result;
  }

  /**
   * Remove sensitive field values for audit logging (don't log plaintext secrets).
   */
  private sanitizeForAudit(settings: TenantAutomationSettings): Record<string, unknown> {
    const sanitized: Record<string, unknown> = { ...settings };
    for (const field of SENSITIVE_FIELDS) {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    }
    return sanitized;
  }
}
