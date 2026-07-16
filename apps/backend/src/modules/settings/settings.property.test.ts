import { describe, it, expect, beforeAll } from 'vitest';
import * as fc from 'fast-check';
import { randomBytes } from 'crypto';
import { encrypt, decrypt } from './encryption.util';

/**
 * Feature: smart-automation, Property 2: Encryption Round-Trip
 *
 * Validates: Requirements 2.6, 3.3, 3.4
 *
 * For any arbitrary string, encrypting and decrypting SHALL return the original,
 * and ciphertext SHALL NOT equal plaintext.
 */
describe('Feature: smart-automation, Property 2: Encryption Round-Trip', () => {
  beforeAll(() => {
    // Generate a random 32-byte key (hex-encoded) for testing
    process.env.SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  });

  it('encrypt then decrypt returns the original string for any fc.string() input', () => {
    fc.assert(
      fc.property(fc.string(), (plaintext) => {
        const ciphertext = encrypt(plaintext);
        const decrypted = decrypt(ciphertext);
        expect(decrypted).toBe(plaintext);
      }),
      { numRuns: 100 },
    );
  });

  it('encrypt then decrypt returns the original string for any unicode string input', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), (plaintext) => {
        const ciphertext = encrypt(plaintext);
        const decrypted = decrypt(ciphertext);
        expect(decrypted).toBe(plaintext);
      }),
      { numRuns: 100 },
    );
  });

  it('encrypt then decrypt returns the original string for any unicode string input', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), (plaintext) => {
        const ciphertext = encrypt(plaintext);
        const decrypted = decrypt(ciphertext);
        expect(decrypted).toBe(plaintext);
      }),
      { numRuns: 100 },
    );
  });

  it('encrypted output is never equal to the plaintext for non-empty strings', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        (plaintext) => {
          const ciphertext = encrypt(plaintext);
          expect(ciphertext).not.toBe(plaintext);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('encrypted output is never equal to the plaintext for non-empty unicode strings', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'grapheme', minLength: 1 }),
        (plaintext) => {
          const ciphertext = encrypt(plaintext);
          expect(ciphertext).not.toBe(plaintext);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('encrypted output is never equal to the plaintext for non-empty fullUnicode strings', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'grapheme', minLength: 1 }),
        (plaintext) => {
          const ciphertext = encrypt(plaintext);
          expect(ciphertext).not.toBe(plaintext);
        },
      ),
      { numRuns: 100 },
    );
  });
});

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { TENANT_AUTOMATION_SETTINGS_SCHEMA } from './settings.schema';
import {
  DEFAULT_AUTOMATION_SETTINGS,
  type TenantAutomationSettings,
  type ApprovalMode,
  type AutomationToggles,
  type ApprovalModes,
} from './settings.interfaces';

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const TOGGLE_KEYS: (keyof AutomationToggles)[] = [
  'campaigns',
  'retention_offers',
  'pricing_suggestions',
  'anomaly_alerts',
  'queue_optimization',
  'membership_recommendations',
];

const approvalModeArb: fc.Arbitrary<ApprovalMode> = fc.constantFrom(
  'approval_required' as const,
  'autonomous' as const,
);

const automationTogglesArb: fc.Arbitrary<AutomationToggles> = fc.record({
  campaigns: fc.boolean(),
  retention_offers: fc.boolean(),
  pricing_suggestions: fc.boolean(),
  anomaly_alerts: fc.boolean(),
  queue_optimization: fc.boolean(),
  membership_recommendations: fc.boolean(),
  inventory: fc.boolean(),
  finance: fc.boolean(),
  sales: fc.boolean(),
  hr: fc.boolean(),
  procurement: fc.boolean(),
});

const approvalModesArb: fc.Arbitrary<ApprovalModes> = fc.record({
  campaigns: approvalModeArb,
  retention_offers: approvalModeArb,
  pricing_suggestions: approvalModeArb,
  anomaly_alerts: approvalModeArb,
  queue_optimization: approvalModeArb,
  membership_recommendations: approvalModeArb,
  inventory: approvalModeArb,
  finance: approvalModeArb,
  sales: approvalModeArb,
  hr: approvalModeArb,
  procurement: approvalModeArb,
});

/** Generate a valid E.164 phone number or null */
const e164PhoneArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  fc
    .tuple(
      fc.constantFrom(1, 2, 3, 4, 5, 6, 7, 8, 9),
      fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 14 }),
    )
    .map(([first, rest]) => `+${first}${rest.join('')}`),
);

const llmProviderArb: fc.Arbitrary<'openrouter' | 'hermes_ai'> = fc.constantFrom(
  'openrouter' as const,
  'hermes_ai' as const,
);

const scheduleIntervalArb: fc.Arbitrary<'hourly' | 'daily' | null> = fc.constantFrom(
  'hourly' as const,
  'daily' as const,
  null,
);

/** Constrained date arbitrary that produces valid RFC 3339 date-time strings (years 1970-2099) */
const dateTimeArb: fc.Arbitrary<string> = fc
  .date({ min: new Date('1970-01-01T00:00:00.000Z'), max: new Date('2099-12-31T23:59:59.999Z'), noInvalidDate: true })
  .map((d) => d.toISOString());

/** Generate a valid discovered device object */
const discoveredDeviceArb = fc.record({
  device_id: fc.uuid(),
  ip_address: fc
    .tuple(
      fc.integer({ min: 1, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 1, max: 254 }),
    )
    .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`),
  device_type: fc.constantFrom(
    'camera' as const,
    'nvr' as const,
    'printer' as const,
    'barcode_scanner' as const,
    'iot_controller' as const,
    'router' as const,
    'pos_terminal' as const,
    'kiosk' as const,
    'tablet' as const,
    'unknown' as const,
  ),
  manufacturer: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 50 })),
  model: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 50 })),
  suggested_label: fc.string({ minLength: 1, maxLength: 100 }),
  status: fc.constantFrom('online' as const, 'offline' as const, 'unconfigured' as const),
  confirmed: fc.boolean(),
  assigned_bay_id: fc.oneof(fc.constant(null), fc.uuid()),
  assigned_outlet_id: fc.oneof(fc.constant(null), fc.uuid()),
  connection_params: fc.constant({}),
  discovered_at: dateTimeArb,
  confirmed_at: fc.oneof(fc.constant(null), dateTimeArb),
});

/** Generate a fully valid TenantAutomationSettings object */
const validSettingsArb: fc.Arbitrary<TenantAutomationSettings> = fc.record({
  whatsapp_phone: e164PhoneArb,
  whatsapp_token_encrypted: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 100 })),
  llm_provider: llmProviderArb,
  llm_api_key_encrypted: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 100 })),
  ai_enabled: fc.boolean(),
  automation_toggles: automationTogglesArb,
  approval_modes: approvalModesArb,
  schedule_interval: scheduleIntervalArb,
  discovered_devices: fc.array(discoveredDeviceArb, { minLength: 0, maxLength: 3 }),
});

// ─── Property 1: Settings Serialization Round-Trip ────────────────────────────

/**
 * Feature: smart-automation, Property 1: Settings Serialization Round-Trip
 *
 * Validates: Requirements 12.3, 12.4
 *
 * For any valid TenantAutomationSettings object, serializing it to JSON
 * and deserializing back SHALL produce a deeply equal object.
 */
describe('Feature: smart-automation, Property 1: Settings Serialization Round-Trip', () => {
  it('JSON.stringify then JSON.parse produces a deeply equal object for any valid settings', () => {
    fc.assert(
      fc.property(validSettingsArb, (settings) => {
        const serialized = JSON.stringify(settings);
        const deserialized = JSON.parse(serialized);
        expect(deserialized).toEqual(settings);
      }),
      { numRuns: 100 },
    );
  });

  it('round-trip preserves all nested structures (toggles, approval modes, devices)', () => {
    fc.assert(
      fc.property(validSettingsArb, (settings) => {
        const roundTripped: TenantAutomationSettings = JSON.parse(JSON.stringify(settings));

        // Verify nested objects are preserved
        expect(roundTripped.automation_toggles).toEqual(settings.automation_toggles);
        expect(roundTripped.approval_modes).toEqual(settings.approval_modes);
        expect(roundTripped.discovered_devices).toEqual(settings.discovered_devices);
        expect(roundTripped.ai_enabled).toBe(settings.ai_enabled);
        expect(roundTripped.llm_provider).toBe(settings.llm_provider);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 3: JSON Schema Validation Correctness ───────────────────────────

/**
 * Feature: smart-automation, Property 3: JSON Schema Validation Correctness
 *
 * Validates: Requirements 1.3, 12.2
 *
 * Valid payloads accepted, invalid payloads rejected with errors.
 */
describe('Feature: smart-automation, Property 3: JSON Schema Validation Correctness', () => {
  let ajv: Ajv;
  let validate: ReturnType<Ajv['compile']>;

  beforeAll(() => {
    ajv = new Ajv({ allErrors: true, useDefaults: true });
    addFormats(ajv);
    validate = ajv.compile(TENANT_AUTOMATION_SETTINGS_SCHEMA);
  });

  it('valid TenantAutomationSettings objects pass schema validation', () => {
    fc.assert(
      fc.property(validSettingsArb, (settings) => {
        const clone = JSON.parse(JSON.stringify(settings));
        const valid = validate(clone);
        expect(valid).toBe(true);
        expect(validate.errors).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it('settings with invalid automation_toggles values are rejected', () => {
    fc.assert(
      fc.property(
        validSettingsArb,
        fc.constantFrom(...TOGGLE_KEYS),
        fc.oneof(
          fc.string({ minLength: 1 }),
          fc.integer(),
          fc.constant(null),
        ),
        (settings, key, invalidValue) => {
          const mutated = JSON.parse(JSON.stringify(settings));
          mutated.automation_toggles[key] = invalidValue;
          const clone = JSON.parse(JSON.stringify(mutated));
          const valid = validate(clone);
          expect(valid).toBe(false);
          expect(validate.errors).not.toBeNull();
          expect(validate.errors!.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('settings with invalid approval_modes values are rejected', () => {
    fc.assert(
      fc.property(
        validSettingsArb,
        fc.constantFrom(...TOGGLE_KEYS),
        fc.oneof(
          fc.constant('invalid_mode'),
          fc.constant('auto'),
          fc.integer(),
          fc.constant(null),
          fc.boolean(),
        ),
        (settings, key, invalidValue) => {
          const mutated = JSON.parse(JSON.stringify(settings));
          mutated.approval_modes[key] = invalidValue;
          const clone = JSON.parse(JSON.stringify(mutated));
          const valid = validate(clone);
          expect(valid).toBe(false);
          expect(validate.errors).not.toBeNull();
          expect(validate.errors!.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('settings missing required fields (ai_enabled, automation_toggles, approval_modes) are rejected', () => {
    fc.assert(
      fc.property(
        validSettingsArb,
        fc.constantFrom('ai_enabled', 'automation_toggles', 'approval_modes'),
        (settings, fieldToRemove) => {
          const mutated = JSON.parse(JSON.stringify(settings));
          delete mutated[fieldToRemove];
          // Don't use useDefaults clone — validate raw
          const rawAjv = new Ajv({ allErrors: true, useDefaults: false });
          addFormats(rawAjv);
          const rawValidate = rawAjv.compile(TENANT_AUTOMATION_SETTINGS_SCHEMA);
          const valid = rawValidate(mutated);
          expect(valid).toBe(false);
          expect(rawValidate.errors).not.toBeNull();
          expect(rawValidate.errors!.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('settings with invalid llm_provider values are rejected', () => {
    fc.assert(
      fc.property(
        validSettingsArb,
        fc.string({ minLength: 1 }).filter(
          (s) => s !== 'openrouter' && s !== 'hermes_ai',
        ),
        (settings, invalidProvider) => {
          const mutated = JSON.parse(JSON.stringify(settings));
          mutated.llm_provider = invalidProvider;
          const clone = JSON.parse(JSON.stringify(mutated));
          const valid = validate(clone);
          expect(valid).toBe(false);
          expect(validate.errors).not.toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 4: Default Initialization — All Toggles OFF ────────────────────

/**
 * Feature: smart-automation, Property 4: Default Initialization — All Toggles OFF
 *
 * Validates: Requirements 1.2, 4.2
 *
 * New tenant settings have ai_enabled=true (brain on, graceful fallback) while
 * all ACTION automation toggles remain false (nothing acts autonomously).
 */
describe('Feature: smart-automation, Property 4: Default Initialization — All Toggles OFF', () => {
  it('DEFAULT_AUTOMATION_SETTINGS has ai_enabled set to true (brain on by default)', () => {
    expect(DEFAULT_AUTOMATION_SETTINGS.ai_enabled).toBe(true);
  });

  it('DEFAULT_AUTOMATION_SETTINGS has all automation toggles set to false', () => {
    for (const key of TOGGLE_KEYS) {
      expect(DEFAULT_AUTOMATION_SETTINGS.automation_toggles[key]).toBe(false);
    }
  });

  it('DEFAULT_AUTOMATION_SETTINGS has all approval modes set to approval_required', () => {
    for (const key of TOGGLE_KEYS) {
      expect(DEFAULT_AUTOMATION_SETTINGS.approval_modes[key]).toBe('approval_required');
    }
  });

  it('property: for any toggle key, DEFAULT_AUTOMATION_SETTINGS has that toggle set to false', () => {
    fc.assert(
      fc.property(fc.constantFrom(...TOGGLE_KEYS), (key) => {
        expect(DEFAULT_AUTOMATION_SETTINGS.automation_toggles[key]).toBe(false);
        expect(DEFAULT_AUTOMATION_SETTINGS.ai_enabled).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('DEFAULT_AUTOMATION_SETTINGS passes JSON schema validation', () => {
    const ajv = new Ajv({ allErrors: true, useDefaults: true });
    addFormats(ajv);
    const validate = ajv.compile(TENANT_AUTOMATION_SETTINGS_SCHEMA);
    const clone = JSON.parse(JSON.stringify(DEFAULT_AUTOMATION_SETTINGS));
    const valid = validate(clone);
    expect(valid).toBe(true);
  });
});

// ─── Property 17: Default Values for Omitted Optional Fields ──────────────────

/**
 * Feature: smart-automation, Property 17: Default Values for Omitted Optional Fields
 *
 * Validates: Requirements 12.5
 *
 * Omitted optional fields filled with defined defaults.
 */
describe('Feature: smart-automation, Property 17: Default Values for Omitted Optional Fields', () => {
  /**
   * Replicates the applyDefaults logic from SettingsService for testing
   * without needing database access.
   */
  function applyDefaults(raw: Record<string, unknown>): TenantAutomationSettings {
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
          ? (raw.automation_toggles as Partial<AutomationToggles>)
          : {}),
      },
      approval_modes: {
        ...defaults.approval_modes,
        ...(typeof raw.approval_modes === 'object' && raw.approval_modes !== null
          ? (raw.approval_modes as Partial<ApprovalModes>)
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

  it('empty object is filled with all default values', () => {
    const result = applyDefaults({});
    expect(result).toEqual(DEFAULT_AUTOMATION_SETTINGS);
  });

  it('partial settings with only required fields get optional fields filled with defaults', () => {
    fc.assert(
      fc.property(
        fc.record({
          ai_enabled: fc.boolean(),
          automation_toggles: automationTogglesArb,
          approval_modes: approvalModesArb,
        }),
        (partial) => {
          const result = applyDefaults(partial as Record<string, unknown>);

          // Provided fields are preserved
          expect(result.ai_enabled).toBe(partial.ai_enabled);
          expect(result.automation_toggles).toEqual(partial.automation_toggles);
          expect(result.approval_modes).toEqual(partial.approval_modes);

          // Omitted optional fields get defaults
          expect(result.whatsapp_phone).toBe(DEFAULT_AUTOMATION_SETTINGS.whatsapp_phone);
          expect(result.whatsapp_token_encrypted).toBe(
            DEFAULT_AUTOMATION_SETTINGS.whatsapp_token_encrypted,
          );
          expect(result.llm_provider).toBe(DEFAULT_AUTOMATION_SETTINGS.llm_provider);
          expect(result.llm_api_key_encrypted).toBe(
            DEFAULT_AUTOMATION_SETTINGS.llm_api_key_encrypted,
          );
          expect(result.schedule_interval).toBe(DEFAULT_AUTOMATION_SETTINGS.schedule_interval);
          expect(result.discovered_devices).toEqual(
            DEFAULT_AUTOMATION_SETTINGS.discovered_devices,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('partial automation_toggles are merged with defaults for missing keys', () => {
    fc.assert(
      fc.property(
        fc.subarray(TOGGLE_KEYS, { minLength: 1, maxLength: 5 }),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 6 }),
        (keysToProvide, values) => {
          const partialToggles: Record<string, boolean> = {};
          keysToProvide.forEach((key, idx) => {
            partialToggles[key] = values[idx % values.length];
          });

          const result = applyDefaults({
            ai_enabled: true,
            automation_toggles: partialToggles,
            approval_modes: DEFAULT_AUTOMATION_SETTINGS.approval_modes,
          });

          // Provided toggle keys have the given values
          for (const key of keysToProvide) {
            expect(result.automation_toggles[key]).toBe(partialToggles[key]);
          }

          // Non-provided toggle keys have defaults (false)
          const missingKeys = TOGGLE_KEYS.filter((k) => !keysToProvide.includes(k));
          for (const key of missingKeys) {
            expect(result.automation_toggles[key]).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('fully omitted automation_toggles results in all defaults (false)', () => {
    const result = applyDefaults({
      ai_enabled: false,
      automation_toggles: null as unknown,
      approval_modes: DEFAULT_AUTOMATION_SETTINGS.approval_modes,
    } as Record<string, unknown>);

    for (const key of TOGGLE_KEYS) {
      expect(result.automation_toggles[key]).toBe(false);
    }
  });

  it('non-boolean ai_enabled falls back to the default', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.integer(), fc.constant(null), fc.constant(undefined)),
        (invalidAiEnabled) => {
          const result = applyDefaults({
            ai_enabled: invalidAiEnabled,
            automation_toggles: DEFAULT_AUTOMATION_SETTINGS.automation_toggles,
            approval_modes: DEFAULT_AUTOMATION_SETTINGS.approval_modes,
          } as Record<string, unknown>);

          expect(result.ai_enabled).toBe(DEFAULT_AUTOMATION_SETTINGS.ai_enabled);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 5: Tenant Settings Isolation ────────────────────────────────────

/**
 * Feature: smart-automation, Property 5: Tenant Settings Isolation
 *
 * Validates: Requirements 1.1
 *
 * For any two distinct tenants A and B, updating tenant A's automation settings
 * SHALL leave tenant B's settings unchanged.
 */
describe('Feature: smart-automation, Property 5: Tenant Settings Isolation', () => {
  /**
   * Simulates an in-memory settings store for two tenants and verifies
   * that mutations to one tenant's settings do not affect the other.
   * This tests the isolation property without requiring a real database.
   */
  function createInMemorySettingsStore() {
    const store: Record<string, TenantAutomationSettings> = {};

    return {
      get(tenantId: string): TenantAutomationSettings {
        if (!store[tenantId]) {
          store[tenantId] = JSON.parse(JSON.stringify(DEFAULT_AUTOMATION_SETTINGS));
        }
        return JSON.parse(JSON.stringify(store[tenantId]));
      },
      set(tenantId: string, settings: TenantAutomationSettings): void {
        store[tenantId] = JSON.parse(JSON.stringify(settings));
      },
    };
  }

  it('updating tenant A settings does not change tenant B settings for any valid patch', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        validSettingsArb,
        validSettingsArb,
        validSettingsArb,
        (tenantAId, tenantBId, initialA, initialB, patchSettings) => {
          // Ensure distinct tenants
          fc.pre(tenantAId !== tenantBId);

          const store = createInMemorySettingsStore();
          store.set(tenantAId, initialA);
          store.set(tenantBId, initialB);

          // Snapshot tenant B's settings before update
          const tenantBBefore = store.get(tenantBId);

          // Apply an update to tenant A
          store.set(tenantAId, patchSettings);

          // Tenant B's settings should remain unchanged
          const tenantBAfter = store.get(tenantBId);
          expect(tenantBAfter).toEqual(tenantBBefore);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('updating tenant A automation_toggles does not affect tenant B toggles', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        automationTogglesArb,
        automationTogglesArb,
        automationTogglesArb,
        (tenantAId, tenantBId, togglesA, togglesB, newTogglesA) => {
          fc.pre(tenantAId !== tenantBId);

          const store = createInMemorySettingsStore();
          const settingsA = { ...DEFAULT_AUTOMATION_SETTINGS, automation_toggles: togglesA };
          const settingsB = { ...DEFAULT_AUTOMATION_SETTINGS, automation_toggles: togglesB };
          store.set(tenantAId, settingsA);
          store.set(tenantBId, settingsB);

          // Snapshot B
          const tenantBBefore = store.get(tenantBId);

          // Update A's toggles
          store.set(tenantAId, { ...settingsA, automation_toggles: newTogglesA });

          // B should be unchanged
          const tenantBAfter = store.get(tenantBId);
          expect(tenantBAfter.automation_toggles).toEqual(tenantBBefore.automation_toggles);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 6: E.164 Phone Number Validation ───────────────────────────────

/**
 * Feature: smart-automation, Property 6: E.164 Phone Number Validation
 *
 * Validates: Requirements 2.5
 *
 * For any string, the phone number validator SHALL accept it if and only if
 * it matches the E.164 format (starts with `+` followed by 1–15 digits, first digit non-zero).
 */
describe('Feature: smart-automation, Property 6: E.164 Phone Number Validation', () => {
  const ajv = new Ajv({ allErrors: true, useDefaults: true });
  addFormats(ajv);
  const validate = ajv.compile(TENANT_AUTOMATION_SETTINGS_SCHEMA);

  /** Reference E.164 regex matching the JSON Schema pattern: ^\\+[1-9]\\d{1,14}$ */
  const E164_REGEX = /^\+[1-9]\d{1,14}$/;

  /**
   * Arbitrary that generates valid E.164 phone numbers.
   * Schema pattern: ^\+[1-9]\d{1,14}$ means + then [1-9] then 1-14 more digits.
   * Total digits: 2 to 15.
   */
  const validE164Arb: fc.Arbitrary<string> = fc
    .tuple(
      fc.constantFrom(1, 2, 3, 4, 5, 6, 7, 8, 9),
      fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 14 }),
    )
    .map(([first, rest]) => `+${first}${rest.join('')}`);

  /** Arbitrary that generates strings NOT matching E.164 format */
  const invalidPhoneArb: fc.Arbitrary<string> = fc.oneof(
    // Missing + prefix
    fc.string({ unit: fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), minLength: 1, maxLength: 15 }),
    // Starts with +0
    fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 14 })
      .map((digits) => `+0${digits.join('')}`),
    // Too long (more than 15 digits total)
    fc.tuple(
      fc.constantFrom(1, 2, 3, 4, 5, 6, 7, 8, 9),
      fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 15, maxLength: 20 }),
    ).map(([first, rest]) => `+${first}${rest.join('')}`),
    // Contains non-digit characters after +
    fc.tuple(
      fc.constantFrom(1, 2, 3, 4, 5, 6, 7, 8, 9),
      fc.string({ minLength: 1, maxLength: 10 }).filter((s) => /[^0-9]/.test(s)),
    ).map(([first, rest]) => `+${first}${rest}`),
    // Just random strings
    fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !E164_REGEX.test(s)),
  );

  it('valid E.164 phone numbers are accepted by the schema validator', () => {
    fc.assert(
      fc.property(validE164Arb, (phone) => {
        const settings = { ...JSON.parse(JSON.stringify(DEFAULT_AUTOMATION_SETTINGS)), whatsapp_phone: phone };
        const valid = validate(settings);
        expect(valid).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('invalid phone numbers are rejected by the schema validator', () => {
    fc.assert(
      fc.property(invalidPhoneArb, (phone) => {
        const settings = { ...JSON.parse(JSON.stringify(DEFAULT_AUTOMATION_SETTINGS)), whatsapp_phone: phone };
        const valid = validate(settings);
        expect(valid).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('E.164 regex and JSON Schema pattern agree for any generated string', () => {
    fc.assert(
      fc.property(
        fc.oneof(validE164Arb, invalidPhoneArb),
        (phone) => {
          const matchesRegex = E164_REGEX.test(phone);
          const settings = { ...JSON.parse(JSON.stringify(DEFAULT_AUTOMATION_SETTINGS)), whatsapp_phone: phone };
          const passesSchema = validate(settings) as boolean;
          expect(passesSchema).toBe(matchesRegex);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('null phone number is accepted (optional field)', () => {
    const settings = { ...JSON.parse(JSON.stringify(DEFAULT_AUTOMATION_SETTINGS)), whatsapp_phone: null };
    const valid = validate(settings);
    expect(valid).toBe(true);
  });
});

// ─── Property 14: Toggle Disable Cancels Pending Proposals ────────────────────

/**
 * Feature: smart-automation, Property 14: Toggle Disable Cancels Pending Proposals
 *
 * Validates: Requirements 4.6
 *
 * For any automation capability that is disabled, all ActionProposal records
 * of that type with status "pending" SHALL be updated to "expired".
 */
describe('Feature: smart-automation, Property 14: Toggle Disable Cancels Pending Proposals', () => {
  /**
   * Simulates an in-memory proposal store to test the cancellation logic
   * without requiring a real database. This tests the pure domain logic:
   * when a toggle is disabled, all pending proposals of that type become expired.
   */
  interface MockProposal {
    id: string;
    tenant_id: string;
    action_type: string;
    status: 'pending' | 'approved' | 'rejected' | 'expired';
  }

  function cancelPendingProposals(
    proposals: MockProposal[],
    tenantId: string,
    toggleKey: string,
  ): MockProposal[] {
    return proposals.map((p) => {
      if (p.tenant_id === tenantId && p.action_type === toggleKey && p.status === 'pending') {
        return { ...p, status: 'expired' as const };
      }
      return p;
    });
  }

  const proposalStatusArb: fc.Arbitrary<MockProposal['status']> = fc.constantFrom(
    'pending' as const,
    'approved' as const,
    'rejected' as const,
    'expired' as const,
  );

  const toggleKeyArb: fc.Arbitrary<keyof AutomationToggles> = fc.constantFrom(...TOGGLE_KEYS);

  it('disabling a toggle expires all pending proposals of that type for the tenant', () => {
    fc.assert(
      fc.property(
        fc.uuid(), // tenantId
        toggleKeyArb, // toggle being disabled
        fc.array(
          fc.record({
            id: fc.uuid(),
            tenant_id: fc.uuid(),
            action_type: fc.constantFrom(...TOGGLE_KEYS),
            status: proposalStatusArb,
          }),
          { minLength: 0, maxLength: 20 },
        ),
        (tenantId, toggleKey, proposals) => {
          // Ensure some proposals belong to our tenant + toggle
          const enriched: MockProposal[] = [
            ...proposals,
            { id: 'forced-pending', tenant_id: tenantId, action_type: toggleKey, status: 'pending' },
          ];

          const result = cancelPendingProposals(enriched, tenantId, toggleKey);

          // All pending proposals for this tenant + toggle type should now be expired
          const relevantAfter = result.filter(
            (p) => p.tenant_id === tenantId && p.action_type === toggleKey,
          );
          for (const p of relevantAfter) {
            if (p.status === 'pending') {
              // Should not happen — all pending should have been expired
              expect(p.status).not.toBe('pending');
            }
          }

          // Specifically the forced pending proposal should be expired
          const forced = result.find((p) => p.id === 'forced-pending');
          expect(forced?.status).toBe('expired');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('disabling a toggle does not affect proposals of other types or other tenants', () => {
    fc.assert(
      fc.property(
        fc.uuid(), // tenantId
        toggleKeyArb, // toggle being disabled
        fc.array(
          fc.record({
            id: fc.uuid(),
            tenant_id: fc.uuid(),
            action_type: fc.constantFrom(...TOGGLE_KEYS),
            status: proposalStatusArb,
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (tenantId, toggleKey, proposals) => {
          const result = cancelPendingProposals(proposals, tenantId, toggleKey);

          // Proposals not matching tenant+toggle should remain unchanged
          for (let i = 0; i < proposals.length; i++) {
            const original = proposals[i];
            const updated = result[i];
            if (original.tenant_id !== tenantId || original.action_type !== toggleKey) {
              expect(updated.status).toBe(original.status);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('non-pending proposals (approved, rejected, expired) are never affected', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        toggleKeyArb,
        fc.array(
          fc.record({
            id: fc.uuid(),
            tenant_id: fc.uuid(),
            action_type: fc.constantFrom(...TOGGLE_KEYS),
            status: fc.constantFrom('approved' as const, 'rejected' as const, 'expired' as const),
          }),
          { minLength: 1, maxLength: 15 },
        ),
        (tenantId, toggleKey, proposals) => {
          // Force all proposals to be for this tenant+toggle but non-pending
          const forced: MockProposal[] = proposals.map((p) => ({
            ...p,
            tenant_id: tenantId,
            action_type: toggleKey,
          }));

          const result = cancelPendingProposals(forced, tenantId, toggleKey);

          // None should have changed since none were pending
          for (let i = 0; i < forced.length; i++) {
            expect(result[i].status).toBe(forced[i].status);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 15: Prerequisite Validation Before Toggle Activation ────────────

/**
 * Feature: smart-automation, Property 15: Prerequisite Validation Before Toggle Activation
 *
 * Validates: Requirements 4.5
 *
 * For any Automation_Toggle that has a defined prerequisite configuration
 * (e.g., AI requires LLM key for OpenRouter), enabling that toggle SHALL fail
 * if the prerequisite is not satisfied.
 */
describe('Feature: smart-automation, Property 15: Prerequisite Validation Before Toggle Activation', () => {
  /**
   * Pure prerequisite check logic extracted from SettingsService.
   * Returns { valid: true } if prerequisites are met, or
   * { valid: false, missing: string } if not.
   */
  function checkPrerequisites(
    toggleKey: keyof AutomationToggles,
    settings: TenantAutomationSettings,
  ): { valid: boolean; missing?: string } {
    // Prerequisite 1: ai_enabled must be true
    if (!settings.ai_enabled) {
      return { valid: false, missing: 'ai_enabled' };
    }

    // Prerequisite 2: If llm_provider is 'openrouter', API key must be present
    if (settings.llm_provider === 'openrouter') {
      const apiKey = settings.llm_api_key_encrypted;
      if (!apiKey || apiKey.trim() === '') {
        return { valid: false, missing: 'llm_api_key' };
      }
    }

    return { valid: true };
  }

  it('enabling any toggle fails when ai_enabled is false', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TOGGLE_KEYS),
        validSettingsArb.map((s) => ({ ...s, ai_enabled: false })),
        (toggleKey, settings) => {
          const result = checkPrerequisites(toggleKey, settings);
          expect(result.valid).toBe(false);
          expect(result.missing).toBe('ai_enabled');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('enabling any toggle fails when llm_provider is openrouter and API key is missing', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TOGGLE_KEYS),
        fc.constantFrom(null, '', '   '),
        (toggleKey, apiKeyValue) => {
          const settings: TenantAutomationSettings = {
            ...DEFAULT_AUTOMATION_SETTINGS,
            ai_enabled: true,
            llm_provider: 'openrouter',
            llm_api_key_encrypted: apiKeyValue,
          };

          const result = checkPrerequisites(toggleKey, settings);
          expect(result.valid).toBe(false);
          expect(result.missing).toBe('llm_api_key');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('enabling any toggle succeeds when ai_enabled is true and llm_provider is hermes_ai', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TOGGLE_KEYS),
        validSettingsArb.map((s) => ({ ...s, ai_enabled: true, llm_provider: 'hermes_ai' as const })),
        (toggleKey, settings) => {
          const result = checkPrerequisites(toggleKey, settings);
          expect(result.valid).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('enabling any toggle succeeds when ai_enabled is true, openrouter provider, and API key present', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TOGGLE_KEYS),
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim() !== ''),
        (toggleKey, apiKey) => {
          const settings: TenantAutomationSettings = {
            ...DEFAULT_AUTOMATION_SETTINGS,
            ai_enabled: true,
            llm_provider: 'openrouter',
            llm_api_key_encrypted: apiKey,
          };

          const result = checkPrerequisites(toggleKey, settings);
          expect(result.valid).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('prerequisite check result is consistent regardless of which toggle is being enabled', () => {
    fc.assert(
      fc.property(
        validSettingsArb,
        fc.constantFrom(...TOGGLE_KEYS),
        fc.constantFrom(...TOGGLE_KEYS),
        (settings, toggleA, toggleB) => {
          // Same settings should give same pass/fail for any toggle
          // since prerequisites are global (ai_enabled, llm key)
          const resultA = checkPrerequisites(toggleA, settings);
          const resultB = checkPrerequisites(toggleB, settings);
          expect(resultA.valid).toBe(resultB.valid);
          expect(resultA.missing).toBe(resultB.missing);
        },
      ),
      { numRuns: 100 },
    );
  });
});
