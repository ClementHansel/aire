import { describe, it, expect, vi } from 'vitest';
import { TopologyService } from './topology.service';
import type { BridgeGateway } from '../bridge/bridge.gateway';

/**
 * Build a TopologyService over a pool whose query() dispatches by table, plus a
 * fake gateway. Each `rows` entry is the raw pg result for that source.
 */
function makeService(data: {
  tenant?: any;
  outlets?: any[];
  bridges?: any[];
  devices?: any[];
  pos?: any[];
  kiosk?: any[];
  online?: string[];
}) {
  const query = vi.fn().mockImplementation((sql: string) => {
    if (sql.includes('FROM tenants')) {
      return Promise.resolve({ rows: [data.tenant ?? { id: 'tenant-1', name: 'Airin Demo' }] });
    }
    if (sql.includes('FROM outlets')) return Promise.resolve({ rows: data.outlets ?? [] });
    if (sql.includes('FROM branch_bridges')) return Promise.resolve({ rows: data.bridges ?? [] });
    if (sql.includes('FROM branch_devices')) return Promise.resolve({ rows: data.devices ?? [] });
    if (sql.includes('FROM pos_devices')) return Promise.resolve({ rows: data.pos ?? [] });
    if (sql.includes('FROM kiosk_devices')) return Promise.resolve({ rows: data.kiosk ?? [] });
    return Promise.resolve({ rows: [] });
  });
  const pool = { query } as never;
  const gateway = {
    isBridgeOnline: (id: string) => (data.online ?? []).includes(id),
  } as unknown as BridgeGateway;
  return { service: new TopologyService(pool, gateway), query };
}

function branchDeviceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dev-1',
    outlet_id: 'outlet-1',
    category: 'camera',
    name: 'Front Camera',
    status: 'online',
    ip_address: '192.168.1.50',
    ref_id: 'cam-1',
    vendor: 'ACME',
    model: 'CAM-1',
    last_seen_at: '2026-07-12T00:00:00.000Z',
    ...overrides,
  };
}

describe('TopologyService.build - tree shape', () => {
  it('produces tenant + generatedAt + a branch per outlet', async () => {
    const { service } = makeService({
      tenant: { id: 'tenant-1', name: 'Airin Demo' },
      outlets: [{ id: 'outlet-1', name: 'AIRE Bintaro', code: 'BTR' }],
      bridges: [
        { id: 'bridge-1', outlet_id: 'outlet-1', status: 'online', last_seen_at: '2026-07-12T00:00:00.000Z' },
      ],
      devices: [branchDeviceRow()],
      online: ['bridge-1'],
    });

    const tree = await service.build('tenant-1');

    expect(tree.tenant).toEqual({ id: 'tenant-1', name: 'Airin Demo' });
    expect(typeof tree.generatedAt).toBe('string');
    expect(tree.branches).toHaveLength(1);

    const branch = tree.branches[0]!;
    expect(branch.outlet).toEqual({ id: 'outlet-1', name: 'AIRE Bintaro', code: 'BTR' });
    expect(branch.bridge).toEqual({
      id: 'bridge-1',
      status: 'online',
      live: true,
      lastSeenAt: '2026-07-12T00:00:00.000Z',
    });
    // Contract device-leaf shape.
    const leaf = branch.categories[0]!.devices[0]!;
    expect(Object.keys(leaf).sort()).toEqual(
      ['category', 'id', 'ipAddress', 'lastSeenAt', 'model', 'name', 'refId', 'status', 'vendor'].sort(),
    );
  });

  it('emits bridge: null when a branch has no bridge, live=false when not connected', async () => {
    const { service } = makeService({
      outlets: [
        { id: 'outlet-1', name: 'A', code: 'A' },
        { id: 'outlet-2', name: 'B', code: 'B' },
      ],
      bridges: [{ id: 'bridge-2', outlet_id: 'outlet-2', status: 'offline', last_seen_at: null }],
      online: [], // bridge-2 not connected
    });
    const tree = await service.build('tenant-1');
    const [a, b] = tree.branches;
    expect(a!.bridge).toBeNull();
    expect(b!.bridge).toEqual({ id: 'bridge-2', status: 'offline', live: false, lastSeenAt: null });
  });

  it('groups devices by category in canonical order, omitting empty groups', async () => {
    const { service } = makeService({
      outlets: [{ id: 'outlet-1', name: 'A', code: 'A' }],
      devices: [
        branchDeviceRow({ id: 'r-1', category: 'router', ip_address: '10.0.0.1' }),
        branchDeviceRow({ id: 'c-1', category: 'camera' }),
      ],
    });
    const tree = await service.build('tenant-1');
    const cats = tree.branches[0]!.categories.map((g) => g.category);
    expect(cats).toEqual(['camera', 'router']); // camera before router, no empties
  });
});

describe('TopologyService.build - counts + unions', () => {
  it('counts online/offline/total across branch_devices + pos + kiosk', async () => {
    const now = new Date().toISOString();
    const { service } = makeService({
      outlets: [{ id: 'outlet-1', name: 'A', code: 'A' }],
      devices: [
        branchDeviceRow({ id: 'd-online', status: 'online' }),
        branchDeviceRow({ id: 'd-offline', status: 'offline', ip_address: '192.168.1.51' }),
        branchDeviceRow({ id: 'd-unconf', status: 'unconfigured', ip_address: '192.168.1.52' }),
      ],
      pos: [{ id: 'pos-1', outlet_id: 'outlet-1', label: 'Till 1', is_active: true, last_seen_at: now }],
      kiosk: [{ id: 'k-1', outlet_id: 'outlet-1', label: 'Kiosk 1', is_active: true, last_seen_at: null }],
    });

    const tree = await service.build('tenant-1');
    const branch = tree.branches[0]!;

    // 5 devices total: 3 branch_devices + 1 pos + 1 kiosk.
    expect(branch.counts.total).toBe(5);
    // online: d-online + fresh pos = 2. offline: d-offline + stale kiosk = 2.
    // (unconfigured is counted in total only.)
    expect(branch.counts.online).toBe(2);
    expect(branch.counts.offline).toBe(2);

    const posGroup = branch.categories.find((g) => g.category === 'pos_terminal');
    const kioskGroup = branch.categories.find((g) => g.category === 'kiosk');
    expect(posGroup!.devices[0]!.status).toBe('online');
    expect(kioskGroup!.devices[0]!.status).toBe('offline'); // never seen
  });
});
