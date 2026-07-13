import { describe, it, expect, vi } from 'vitest';
import {
  DeviceRegistryService,
  DiscoveredDeviceForRegistry,
} from './device-registry.service';

/** A raw `branch_devices` row as pg would return it. */
function deviceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dev-1',
    tenant_id: 'tenant-1',
    outlet_id: 'outlet-1',
    bridge_id: 'bridge-1',
    category: 'camera',
    name: 'Camera - ACME',
    vendor: 'ACME',
    model: 'CAM-1',
    ip_address: '192.168.1.50',
    mac_address: null,
    ref_id: 'cam-1',
    connection_params: {},
    status: 'online',
    metadata: {},
    last_seen_at: '2026-07-12T00:00:00.000Z',
    created_at: '2026-07-12T00:00:00.000Z',
    updated_at: '2026-07-12T00:00:00.000Z',
    ...overrides,
  };
}

function makeService(query = vi.fn()) {
  const pool = { query } as never;
  return { service: new DeviceRegistryService(pool), query };
}

const discovered = (
  overrides: Partial<DiscoveredDeviceForRegistry> = {},
): DiscoveredDeviceForRegistry => ({
  device_type: 'camera',
  ip_address: '192.168.1.50',
  manufacturer: 'ACME',
  model: 'CAM-1',
  suggested_label: 'Front Camera',
  assigned_outlet_id: 'outlet-1',
  connection_params: { rtsp_url: 'rtsp://x' },
  ...overrides,
});

describe('DeviceRegistryService - category mapping', () => {
  it.each([
    ['camera', 'camera'],
    ['iot_controller', 'controller'],
    ['router', 'router'],
  ] as const)('maps device_type %s → category %s', async (deviceType, category) => {
    // findExisting → empty; INSERT → returns row echoing the category.
    const query = vi.fn().mockImplementation((sql: string, params: unknown[]) => {
      if (sql.includes('INSERT INTO branch_devices')) {
        return Promise.resolve({ rows: [deviceRow({ category: params[3] })] });
      }
      return Promise.resolve({ rows: [] }); // findExisting misses
    });
    const { service } = makeService(query);

    const dto = await service.upsertFromDiscovery('tenant-1', discovered({ device_type: deviceType }));
    expect(dto.category).toBe(category);

    const insert = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO branch_devices'));
    expect(insert![1][3]).toBe(category); // 4th INSERT param is `category`
  });

  it('confirms an online status + last_seen on the inserted row', async () => {
    const query = vi.fn().mockImplementation((sql: string, params: unknown[]) => {
      if (sql.includes('INSERT INTO branch_devices')) {
        return Promise.resolve({ rows: [deviceRow({ status: params[11] })] });
      }
      return Promise.resolve({ rows: [] });
    });
    const { service } = makeService(query);
    const dto = await service.upsertFromDiscovery('tenant-1', discovered());
    expect(dto.status).toBe('online');
    const insert = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO branch_devices'));
    expect(insert![1][11]).toBe('online'); // status param
    expect(insert![1][13]).not.toBeNull(); // last_seen_at param set
  });
});

describe('DeviceRegistryService - upsert idempotency', () => {
  it('UPDATEs (not INSERTs) when an existing row is found by (bridge_id, ip)', async () => {
    const query = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('AND bridge_id =')) {
        // findExisting hits on the (bridge_id, ip) key.
        return Promise.resolve({ rows: [deviceRow()] });
      }
      if (sql.includes('UPDATE branch_devices')) {
        return Promise.resolve({ rows: [deviceRow({ name: 'Renamed' })] });
      }
      return Promise.resolve({ rows: [] });
    });
    const { service } = makeService(query);

    const dto = await service.upsertFromDiscovery('tenant-1', discovered(), {
      bridgeId: 'bridge-1',
      refId: 'cam-1',
    });

    expect(dto.id).toBe('dev-1');
    const didUpdate = query.mock.calls.some((c) => String(c[0]).includes('UPDATE branch_devices'));
    const didInsert = query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO branch_devices'));
    expect(didUpdate).toBe(true);
    expect(didInsert).toBe(false);
  });

  it('re-confirming the same device targets the same row id twice', async () => {
    const query = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('AND bridge_id =')) return Promise.resolve({ rows: [deviceRow()] });
      if (sql.includes('UPDATE branch_devices')) return Promise.resolve({ rows: [deviceRow()] });
      return Promise.resolve({ rows: [] });
    });
    const { service } = makeService(query);
    const a = await service.upsertFromDiscovery('tenant-1', discovered(), { bridgeId: 'bridge-1' });
    const b = await service.upsertFromDiscovery('tenant-1', discovered(), { bridgeId: 'bridge-1' });
    expect(a.id).toBe(b.id);
  });

  it('INSERTs a fresh row when no IP is present (cannot be keyed)', async () => {
    const query = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO branch_devices')) {
        return Promise.resolve({ rows: [deviceRow({ ip_address: null })] });
      }
      return Promise.resolve({ rows: [] });
    });
    const { service } = makeService(query);
    await service.upsertFromDiscovery('tenant-1', discovered({ ip_address: null }), {
      bridgeId: 'bridge-1',
    });
    // No findExisting SELECT should have run (no IP to key on) → straight INSERT.
    const selects = query.mock.calls.filter((c) => String(c[0]).includes('SELECT'));
    expect(selects.length).toBe(0);
    const didInsert = query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO branch_devices'));
    expect(didInsert).toBe(true);
  });
});

describe('DeviceRegistryService - setStatusForBridge', () => {
  it('bulk-updates a bridge devices and never throws on a missing bridge', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0 });
    const { service } = makeService(query);
    await expect(service.setStatusForBridge('bridge-1', 'offline')).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE branch_devices'), [
      'bridge-1',
      'offline',
    ]);
  });

  it('is a no-op for an empty bridge id', async () => {
    const query = vi.fn();
    const { service } = makeService(query);
    await service.setStatusForBridge('', 'online');
    expect(query).not.toHaveBeenCalled();
  });
});
