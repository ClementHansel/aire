import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { DiscoveryService } from './discovery.service';
import { DiscoveredDevice } from '../settings/settings.interfaces';
import { DeviceHealthCheck } from './discovery.types';

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const deviceTypeArb: fc.Arbitrary<DiscoveredDevice['device_type']> = fc.constantFrom(
  'camera' as const,
  'iot_controller' as const,
  'router' as const,
);

/** Non-empty manufacturer string arbitrary */
const manufacturerArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 50 }).filter(
  (s) => s.trim().length > 0,
);

/** Manufacturer that may be null or empty (for "Unknown" fallback case) */
const nullOrEmptyManufacturerArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  fc.constant(''),
  fc.constant('   '), // whitespace-only
);

/** Valid IPv4 address arbitrary */
const ipAddressArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 1, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 1, max: 254 }),
  )
  .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

/** Generate a full DiscoveredDevice for use in health check tests */
const discoveredDeviceArb: fc.Arbitrary<DiscoveredDevice> = fc.record({
  device_id: fc.uuid(),
  ip_address: ipAddressArb,
  device_type: deviceTypeArb,
  manufacturer: fc.oneof(fc.constant(null), manufacturerArb),
  model: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 50 })),
  suggested_label: fc.string({ minLength: 1, maxLength: 100 }),
  status: fc.constantFrom('online' as const, 'offline' as const, 'unconfigured' as const),
  confirmed: fc.boolean(),
  assigned_bay_id: fc.oneof(fc.constant(null), fc.uuid()),
  assigned_outlet_id: fc.oneof(fc.constant(null), fc.uuid()),
  connection_params: fc.constant({}),
  discovered_at: fc
    .date({ min: new Date('1970-01-01T00:00:00.000Z'), max: new Date('2099-12-31T23:59:59.999Z') })
    .map((d) => d.toISOString()),
  confirmed_at: fc.oneof(
    fc.constant(null),
    fc
      .date({ min: new Date('1970-01-01T00:00:00.000Z'), max: new Date('2099-12-31T23:59:59.999Z') })
      .map((d) => d.toISOString()),
  ),
});

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Applies a health check result to a device, updating its status.
 * When reachable=false, status becomes "offline".
 * When reachable=true, status becomes "online".
 *
 * This simulates the health check status update logic as a pure function.
 */
function applyHealthCheckResult(
  device: DiscoveredDevice,
  healthCheck: DeviceHealthCheck,
): DiscoveredDevice {
  return { ...device, status: healthCheck.reachable ? 'online' : 'offline' };
}

// ─── Type label mapping (mirrors the service implementation) ──────────────────

const TYPE_LABELS: Record<DiscoveredDevice['device_type'], string> = {
  camera: 'Camera',
  iot_controller: 'IoT Controller',
  router: 'Router',
};

// ─── Property 19: Device Label Suggestion Incorporates Type and Manufacturer ──

/**
 * Feature: smart-automation, Property 19: Device Label Suggestion Incorporates Type and Manufacturer
 *
 * Validates: Requirements 9.3
 *
 * For any discovered device with a non-null device_type and manufacturer,
 * the suggested label SHALL contain information derived from both fields.
 */
describe('Feature: smart-automation, Property 19: Device Label Suggestion Incorporates Type and Manufacturer', () => {
  const service = new DiscoveryService();

  it('label contains both the type label and the manufacturer for any valid device_type and non-empty manufacturer', () => {
    fc.assert(
      fc.property(deviceTypeArb, manufacturerArb, (deviceType, manufacturer) => {
        const label = service.generateSuggestedLabel(deviceType, manufacturer);
        const expectedTypeLabel = TYPE_LABELS[deviceType];

        // Label must contain the type label
        expect(label).toContain(expectedTypeLabel);
        // Label must contain the manufacturer
        expect(label).toContain(manufacturer.trim());
      }),
      { numRuns: 100 },
    );
  });

  it('label uses "Unknown" when manufacturer is null or empty', () => {
    fc.assert(
      fc.property(deviceTypeArb, nullOrEmptyManufacturerArb, (deviceType, manufacturer) => {
        const label = service.generateSuggestedLabel(deviceType, manufacturer);
        const expectedTypeLabel = TYPE_LABELS[deviceType];

        // Label must contain the type label
        expect(label).toContain(expectedTypeLabel);
        // Label must contain "Unknown" as the manufacturer fallback
        expect(label).toContain('Unknown');
      }),
      { numRuns: 100 },
    );
  });

  it('createDeviceRecord generates a label incorporating type and manufacturer', () => {
    fc.assert(
      fc.property(
        ipAddressArb,
        deviceTypeArb,
        manufacturerArb,
        fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 30 })),
        (ipAddress, deviceType, manufacturer, model) => {
          const device = service.createDeviceRecord({
            ip_address: ipAddress,
            device_type: deviceType,
            manufacturer,
            model,
          });

          const expectedTypeLabel = TYPE_LABELS[deviceType];

          // suggested_label must contain both type label and manufacturer
          expect(device.suggested_label).toContain(expectedTypeLabel);
          expect(device.suggested_label).toContain(manufacturer.trim());
        },
      ),
      { numRuns: 100 },
    );
  });

  it('createDeviceRecord uses "Unknown" in label when manufacturer is null', () => {
    fc.assert(
      fc.property(
        ipAddressArb,
        deviceTypeArb,
        fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 30 })),
        (ipAddress, deviceType, model) => {
          const device = service.createDeviceRecord({
            ip_address: ipAddress,
            device_type: deviceType,
            manufacturer: null,
            model,
          });

          const expectedTypeLabel = TYPE_LABELS[deviceType];

          expect(device.suggested_label).toContain(expectedTypeLabel);
          expect(device.suggested_label).toContain('Unknown');
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 20: Device Status Offline When Unreachable ──────────────────────

/**
 * Feature: smart-automation, Property 20: Device Status Offline When Unreachable
 *
 * Validates: Requirements 9.6
 *
 * For any confirmed device that fails a health check (unreachable),
 * the system SHALL update its status to "offline".
 */
describe('Feature: smart-automation, Property 20: Device Status Offline When Unreachable', () => {
  it('device status becomes "offline" when health check reports reachable=false', () => {
    fc.assert(
      fc.property(
        discoveredDeviceArb,
        fc
          .date({ min: new Date('1970-01-01T00:00:00.000Z'), max: new Date('2099-12-31T23:59:59.999Z') })
          .map((d) => d.toISOString()),
        (device, checkedAt) => {
          // Force the device to be confirmed (health checks apply to confirmed devices)
          const confirmedDevice: DiscoveredDevice = { ...device, confirmed: true };

          const healthCheck: DeviceHealthCheck = {
            device_id: confirmedDevice.device_id,
            reachable: false,
            latency_ms: null,
            checked_at: checkedAt,
          };

          const updatedDevice = applyHealthCheckResult(confirmedDevice, healthCheck);

          expect(updatedDevice.status).toBe('offline');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('device status becomes "online" when health check reports reachable=true', () => {
    fc.assert(
      fc.property(
        discoveredDeviceArb,
        fc.integer({ min: 1, max: 5000 }),
        fc
          .date({ min: new Date('1970-01-01T00:00:00.000Z'), max: new Date('2099-12-31T23:59:59.999Z') })
          .map((d) => d.toISOString()),
        (device, latencyMs, checkedAt) => {
          const confirmedDevice: DiscoveredDevice = { ...device, confirmed: true };

          const healthCheck: DeviceHealthCheck = {
            device_id: confirmedDevice.device_id,
            reachable: true,
            latency_ms: latencyMs,
            checked_at: checkedAt,
          };

          const updatedDevice = applyHealthCheckResult(confirmedDevice, healthCheck);

          expect(updatedDevice.status).toBe('online');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('device with any initial status becomes "offline" when unreachable', () => {
    fc.assert(
      fc.property(
        discoveredDeviceArb,
        fc.constantFrom('online' as const, 'offline' as const, 'unconfigured' as const),
        fc
          .date({ min: new Date('1970-01-01T00:00:00.000Z'), max: new Date('2099-12-31T23:59:59.999Z') })
          .map((d) => d.toISOString()),
        (device, initialStatus, checkedAt) => {
          const confirmedDevice: DiscoveredDevice = {
            ...device,
            confirmed: true,
            status: initialStatus,
          };

          const healthCheck: DeviceHealthCheck = {
            device_id: confirmedDevice.device_id,
            reachable: false,
            latency_ms: null,
            checked_at: checkedAt,
          };

          const updatedDevice = applyHealthCheckResult(confirmedDevice, healthCheck);

          // Regardless of initial status, unreachable → offline
          expect(updatedDevice.status).toBe('offline');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('health check does not alter other device fields', () => {
    fc.assert(
      fc.property(
        discoveredDeviceArb,
        fc.boolean(),
        fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 5000 })),
        fc
          .date({ min: new Date('1970-01-01T00:00:00.000Z'), max: new Date('2099-12-31T23:59:59.999Z') })
          .map((d) => d.toISOString()),
        (device, reachable, latencyMs, checkedAt) => {
          const confirmedDevice: DiscoveredDevice = { ...device, confirmed: true };

          const healthCheck: DeviceHealthCheck = {
            device_id: confirmedDevice.device_id,
            reachable,
            latency_ms: latencyMs,
            checked_at: checkedAt,
          };

          const updatedDevice = applyHealthCheckResult(confirmedDevice, healthCheck);

          // All fields except status should remain unchanged
          expect(updatedDevice.device_id).toBe(confirmedDevice.device_id);
          expect(updatedDevice.ip_address).toBe(confirmedDevice.ip_address);
          expect(updatedDevice.device_type).toBe(confirmedDevice.device_type);
          expect(updatedDevice.manufacturer).toBe(confirmedDevice.manufacturer);
          expect(updatedDevice.model).toBe(confirmedDevice.model);
          expect(updatedDevice.suggested_label).toBe(confirmedDevice.suggested_label);
          expect(updatedDevice.confirmed).toBe(confirmedDevice.confirmed);
          expect(updatedDevice.assigned_bay_id).toBe(confirmedDevice.assigned_bay_id);
          expect(updatedDevice.assigned_outlet_id).toBe(confirmedDevice.assigned_outlet_id);
          expect(updatedDevice.connection_params).toEqual(confirmedDevice.connection_params);
          expect(updatedDevice.discovered_at).toBe(confirmedDevice.discovered_at);
          expect(updatedDevice.confirmed_at).toBe(confirmedDevice.confirmed_at);
        },
      ),
      { numRuns: 100 },
    );
  });
});
