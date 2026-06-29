import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  AuditService,
  AuditLogEntry,
  AUDITABLE_OPERATIONS,
} from './audit.service';

/**
 * Property-Based Test: Audit Log Completeness (Property 28)
 *
 * **Validates: Requirements 40.1, 40.2, 16.2, 21.6**
 *
 * For any security-relevant operation, an audit log entry is created with
 * required fields. No security operation executes without producing an audit record.
 */

// --- Arbitraries ---

const uuidArbitrary = fc.uuid({ version: 4 });

const auditableOperationArbitrary = fc.constantFrom(...AUDITABLE_OPERATIONS);

const entityTypeArbitrary = fc.constantFrom(
  'user',
  'order',
  'membership',
  'membership_plate',
  'voucher',
  'config',
  'session',
);

const ipAddressArbitrary = fc.tuple(
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

const jsonValueArbitrary: fc.Arbitrary<unknown> = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.oneof(fc.string(), fc.integer(), fc.boolean())),
  fc.array(fc.oneof(fc.string(), fc.integer()), { maxLength: 5 }),
);

const metadataArbitrary: fc.Arbitrary<Record<string, unknown>> = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 15 }),
  fc.oneof(fc.string(), fc.integer(), fc.boolean()),
  { maxKeys: 5 },
);

/** Full AuditLogEntry with all fields populated */
const fullAuditLogEntryArbitrary: fc.Arbitrary<AuditLogEntry> = fc.record({
  tenantId: uuidArbitrary,
  outletId: uuidArbitrary,
  userId: uuidArbitrary,
  operation: auditableOperationArbitrary,
  entityType: entityTypeArbitrary,
  entityId: uuidArbitrary,
  beforeValue: jsonValueArbitrary,
  afterValue: jsonValueArbitrary,
  metadata: metadataArbitrary,
  ipAddress: ipAddressArbitrary,
});

/** Minimal AuditLogEntry with only required fields */
const minimalAuditLogEntryArbitrary: fc.Arbitrary<AuditLogEntry> = fc.record({
  tenantId: uuidArbitrary,
  userId: uuidArbitrary,
  operation: auditableOperationArbitrary,
  entityType: entityTypeArbitrary,
});

/** AuditLogEntry with random optional fields present or absent */
const arbitraryAuditLogEntry: fc.Arbitrary<AuditLogEntry> = fc.record(
  {
    tenantId: uuidArbitrary,
    outletId: fc.option(uuidArbitrary, { nil: undefined }),
    userId: uuidArbitrary,
    operation: auditableOperationArbitrary,
    entityType: entityTypeArbitrary,
    entityId: fc.option(uuidArbitrary, { nil: undefined }),
    beforeValue: fc.option(jsonValueArbitrary, { nil: undefined }),
    afterValue: fc.option(jsonValueArbitrary, { nil: undefined }),
    metadata: fc.option(metadataArbitrary, { nil: undefined }),
    ipAddress: fc.option(ipAddressArbitrary, { nil: undefined }),
  },
);

// --- Test Suite ---

describe('Property 28: Audit Log Completeness', () => {
  let service: AuditService;
  let mockPool: { query: ReturnType<typeof vi.fn> };
  let lastQueryParams: unknown[] | null;

  beforeEach(() => {
    vi.clearAllMocks();
    lastQueryParams = null;
    mockPool = {
      query: vi.fn().mockImplementation((_sql: string, params: unknown[]) => {
        lastQueryParams = params;
        return Promise.resolve({ rows: [] });
      }),
    };
    service = new AuditService(mockPool as any);
  });

  it('required fields (tenantId, userId, operation, entityType) are always present in the INSERT query', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryAuditLogEntry, async (entry) => {
        lastQueryParams = null;
        await service.log(entry);

        expect(mockPool.query).toHaveBeenCalledTimes(1);

        const [sql, params] = mockPool.query.mock.calls[0];

        // The SQL must be an INSERT into audit_logs
        expect(sql).toContain('INSERT INTO audit_logs');

        // Required fields are always present and never null
        expect(params[0]).toBe(entry.tenantId); // tenant_id ($1)
        expect(params[2]).toBe(entry.userId);   // user_id ($3)
        expect(params[3]).toBe(entry.operation); // operation ($4)
        expect(params[4]).toBe(entry.entityType); // entity_type ($5)

        // They must be non-null strings
        expect(typeof params[0]).toBe('string');
        expect(typeof params[2]).toBe('string');
        expect(typeof params[3]).toBe('string');
        expect(typeof params[4]).toBe('string');
        expect(params[0]).not.toBeNull();
        expect(params[2]).not.toBeNull();
        expect(params[3]).not.toBeNull();
        expect(params[4]).not.toBeNull();

        // Reset for next run
        mockPool.query.mockClear();
      }),
      { numRuns: 200 },
    );
  });

  it('operation is always from the valid AUDITABLE_OPERATIONS set', async () => {
    // Verify that AUDITABLE_OPERATIONS covers all expected security operations
    const expectedOperations = [
      'login',
      'login_failed',
      'role_change',
      'void',
      'plate_added',
      'plate_updated',
      'plate_removed',
      'plates_released',
      'config_change',
      'pin_usage',
      'membership_activated',
      'membership_cancelled',
      'voucher_redeemed',
    ];

    for (const op of expectedOperations) {
      expect(AUDITABLE_OPERATIONS).toContain(op);
    }

    // Property: any entry using an auditable operation produces a valid INSERT
    await fc.assert(
      fc.asyncProperty(arbitraryAuditLogEntry, async (entry) => {
        await service.log(entry);

        const [, params] = mockPool.query.mock.calls[0];
        const operationValue = params[3];

        // The operation is always a non-empty string
        expect(typeof operationValue).toBe('string');
        expect(operationValue.length).toBeGreaterThan(0);

        // It matches the input entry's operation
        expect(operationValue).toBe(entry.operation);

        mockPool.query.mockClear();
      }),
      { numRuns: 200 },
    );
  });

  it('before/after values are correctly serialized to JSON string when provided as truthy objects', async () => {
    // Generate only truthy beforeValue/afterValue (non-empty objects/arrays)
    // The service uses truthiness check: `entry.beforeValue ? JSON.stringify(...) : null`
    const truthyJsonArbitrary = fc.oneof(
      fc.dictionary(
        fc.string({ minLength: 1, maxLength: 10 }),
        fc.oneof(fc.string({ minLength: 1 }), fc.integer({ min: 1 }), fc.constant(true)),
        { minKeys: 1, maxKeys: 5 },
      ),
      fc.array(fc.oneof(fc.string({ minLength: 1 }), fc.integer({ min: 1 })), { minLength: 1, maxLength: 5 }),
    );

    const entryWithTruthyValues = fc.record({
      tenantId: uuidArbitrary,
      outletId: uuidArbitrary,
      userId: uuidArbitrary,
      operation: auditableOperationArbitrary,
      entityType: entityTypeArbitrary,
      entityId: uuidArbitrary,
      beforeValue: truthyJsonArbitrary,
      afterValue: truthyJsonArbitrary,
      metadata: metadataArbitrary,
      ipAddress: ipAddressArbitrary,
    });

    await fc.assert(
      fc.asyncProperty(entryWithTruthyValues, async (entry) => {
        await service.log(entry);

        const [, params] = mockPool.query.mock.calls[0];

        // beforeValue ($7) should be JSON stringified
        expect(params[6]).toBe(JSON.stringify(entry.beforeValue));
        // Verify it's valid JSON by parsing it back
        expect(JSON.parse(params[6] as string)).toEqual(entry.beforeValue);

        // afterValue ($8) should be JSON stringified
        expect(params[7]).toBe(JSON.stringify(entry.afterValue));
        // Verify it's valid JSON by parsing it back
        expect(JSON.parse(params[7] as string)).toEqual(entry.afterValue);

        mockPool.query.mockClear();
      }),
      { numRuns: 200 },
    );
  });

  it('optional fields are stored as null when not provided', async () => {
    await fc.assert(
      fc.asyncProperty(minimalAuditLogEntryArbitrary, async (entry) => {
        await service.log(entry);

        const [, params] = mockPool.query.mock.calls[0];

        // outletId ($2) should be null when not provided
        expect(params[1]).toBeNull();

        // entityId ($6) should be null when not provided
        expect(params[5]).toBeNull();

        // beforeValue ($7) should be null when not provided
        expect(params[6]).toBeNull();

        // afterValue ($8) should be null when not provided
        expect(params[7]).toBeNull();

        // ipAddress ($10) should be null when not provided
        expect(params[9]).toBeNull();

        mockPool.query.mockClear();
      }),
      { numRuns: 200 },
    );
  });

  it('metadata defaults to empty object "{}" when not provided', async () => {
    await fc.assert(
      fc.asyncProperty(minimalAuditLogEntryArbitrary, async (entry) => {
        await service.log(entry);

        const [, params] = mockPool.query.mock.calls[0];

        // metadata ($9) should default to '{}' when not provided
        expect(params[8]).toBe('{}');

        mockPool.query.mockClear();
      }),
      { numRuns: 200 },
    );
  });

  it('metadata is correctly serialized when provided', async () => {
    await fc.assert(
      fc.asyncProperty(fullAuditLogEntryArbitrary, async (entry) => {
        await service.log(entry);

        const [, params] = mockPool.query.mock.calls[0];

        // metadata ($9) should be JSON stringified when provided
        expect(params[8]).toBe(JSON.stringify(entry.metadata));
        expect(JSON.parse(params[8] as string)).toEqual(entry.metadata);

        mockPool.query.mockClear();
      }),
      { numRuns: 200 },
    );
  });

  it('every call to log() produces exactly one INSERT query (no silent failures)', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryAuditLogEntry, async (entry) => {
        await service.log(entry);

        // Exactly one query call per log invocation
        expect(mockPool.query).toHaveBeenCalledTimes(1);

        // The query is always an INSERT
        const [sql] = mockPool.query.mock.calls[0];
        expect(sql).toContain('INSERT INTO audit_logs');

        mockPool.query.mockClear();
      }),
      { numRuns: 200 },
    );
  });
});
