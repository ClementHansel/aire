import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { BridgeGateway } from '../bridge/bridge.gateway';
import { DeviceCategory, DeviceStatus } from './device-registry.service';

/** A single device leaf in the topology tree (contract 08 §"Topology JSON"). */
export interface TopologyDevice {
  id: string;
  name: string;
  category: DeviceCategory;
  status: DeviceStatus;
  ipAddress: string | null;
  refId: string | null;
  vendor: string | null;
  model: string | null;
  lastSeenAt: string | null;
}

/** Devices for one branch, grouped by category. */
export interface TopologyCategoryGroup {
  category: DeviceCategory;
  devices: TopologyDevice[];
}

/** The bridge node under a branch (null when the branch has no bridge). */
export interface TopologyBridge {
  id: string;
  /** Persisted liveness from `branch_bridges.status`. */
  status: string;
  /** Real-time: whether an agent socket is currently connected. */
  live: boolean;
  lastSeenAt: string | null;
}

/** One branch subtree: outlet → bridge → category groups → device leaves. */
export interface TopologyBranch {
  outlet: { id: string; name: string; code: string | null };
  bridge: TopologyBridge | null;
  counts: { online: number; offline: number; total: number };
  categories: TopologyCategoryGroup[];
}

/** The full topology document the frontend renders. */
export interface TopologyTree {
  tenant: { id: string; name: string };
  generatedAt: string;
  branches: TopologyBranch[];
}

/**
 * Canonical category ordering for the tree. Empty groups are omitted, but the
 * ones present always appear in this order so the UI layout is stable.
 */
const CATEGORY_ORDER: DeviceCategory[] = [
  'camera',
  'controller',
  'printer',
  'kiosk',
  'pos_terminal',
  'router',
  'other',
];

/**
 * How long since a POS terminal / kiosk last checked in before we consider it
 * offline. These tables predate the registry and carry no online/offline flag,
 * so liveness is derived from `last_seen_at` recency.
 */
const POS_KIOSK_ONLINE_WINDOW_MS = 10 * 60 * 1000;

/** Raw `branch_devices` row (subset used by the tree). */
interface BranchDeviceRow {
  id: string;
  outlet_id: string;
  category: DeviceCategory;
  name: string;
  status: DeviceStatus;
  ip_address: string | null;
  ref_id: string | null;
  vendor: string | null;
  model: string | null;
  last_seen_at: string | Date | null;
}

/** Raw `pos_devices` / `kiosk_devices` row (subset used by the UNION). */
interface TokenDeviceRow {
  id: string;
  outlet_id: string;
  label: string | null;
  is_active: boolean;
  last_seen_at: string | Date | null;
}

/**
 * TopologyService — assembles the nested device topology tree consumed by the
 * `/dashboard/topology` page.
 *
 * Reads are set-based (one query per source, grouped in memory) and always
 * tenant-scoped from the caller's JWT. Bridge liveness combines the persisted
 * `status` with the real-time socket presence from {@link BridgeGateway}
 * (`isBridgeOnline`). Existing POS terminals and kiosks are UNIONed in from
 * their own tables so they appear in the tree without a data migration.
 */
@Injectable()
export class TopologyService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly bridgeGateway: BridgeGateway,
  ) {}

  /**
   * Build the topology tree for a tenant. With `outletId` the result is a single
   * branch (still returned as a length-1 `branches` array, per the contract).
   */
  async build(tenantId: string, outletId?: string): Promise<TopologyTree> {
    const [tenant, outlets, bridges, devices, posDevices, kioskDevices] =
      await Promise.all([
        this.fetchTenant(tenantId),
        this.fetchOutlets(tenantId, outletId),
        this.fetchBridges(tenantId, outletId),
        this.fetchBranchDevices(tenantId, outletId),
        this.fetchTokenDevices('pos_devices', tenantId, outletId),
        this.fetchTokenDevices('kiosk_devices', tenantId, outletId),
      ]);

    // Index the per-outlet inputs.
    const bridgeByOutlet = new Map<string, TokenlessBridgeRow>();
    for (const b of bridges) bridgeByOutlet.set(b.outlet_id, b);

    const devicesByOutlet = new Map<string, TopologyDevice[]>();
    const push = (outlet: string, d: TopologyDevice): void => {
      const arr = devicesByOutlet.get(outlet) ?? [];
      arr.push(d);
      devicesByOutlet.set(outlet, arr);
    };
    for (const r of devices) push(r.outlet_id, this.mapBranchDevice(r));
    for (const r of posDevices) push(r.outlet_id, this.mapTokenDevice(r, 'pos_terminal'));
    for (const r of kioskDevices) push(r.outlet_id, this.mapTokenDevice(r, 'kiosk'));

    const branches: TopologyBranch[] = outlets.map((o) => {
      const branchDevices = devicesByOutlet.get(o.id) ?? [];
      const bridgeRow = bridgeByOutlet.get(o.id) ?? null;
      return {
        outlet: { id: o.id, name: o.name, code: o.code ?? null },
        bridge: bridgeRow
          ? {
              id: bridgeRow.id,
              status: bridgeRow.status,
              live: this.bridgeGateway.isBridgeOnline(bridgeRow.id),
              lastSeenAt: this.iso(bridgeRow.last_seen_at),
            }
          : null,
        counts: this.counts(branchDevices),
        categories: this.groupByCategory(branchDevices),
      };
    });

    return {
      tenant,
      generatedAt: new Date().toISOString(),
      branches,
    };
  }

  // ─── Aggregation helpers ──────────────────────────────────────────────────────

  /** {online, offline, total} across every device in a branch. */
  private counts(devices: TopologyDevice[]): {
    online: number;
    offline: number;
    total: number;
  } {
    let online = 0;
    let offline = 0;
    for (const d of devices) {
      if (d.status === 'online') online += 1;
      else if (d.status === 'offline') offline += 1;
    }
    return { online, offline, total: devices.length };
  }

  /** Group a branch's devices by category, in canonical order, omitting empties. */
  private groupByCategory(devices: TopologyDevice[]): TopologyCategoryGroup[] {
    const byCategory = new Map<DeviceCategory, TopologyDevice[]>();
    for (const d of devices) {
      const arr = byCategory.get(d.category) ?? [];
      arr.push(d);
      byCategory.set(d.category, arr);
    }
    const groups: TopologyCategoryGroup[] = [];
    for (const category of CATEGORY_ORDER) {
      const group = byCategory.get(category);
      if (group && group.length > 0) groups.push({ category, devices: group });
    }
    return groups;
  }

  // ─── Queries ─────────────────────────────────────────────────────────────────

  private async fetchTenant(tenantId: string): Promise<{ id: string; name: string }> {
    const res = await this.pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM tenants WHERE id = $1`,
      [tenantId],
    );
    return res.rows[0] ?? { id: tenantId, name: '' };
  }

  private async fetchOutlets(
    tenantId: string,
    outletId?: string,
  ): Promise<{ id: string; name: string; code: string | null }[]> {
    const params: unknown[] = [tenantId];
    let sql = `SELECT id, name, code FROM outlets WHERE tenant_id = $1`;
    if (outletId) {
      params.push(outletId);
      sql += ` AND id = $2`;
    }
    sql += ` ORDER BY name ASC`;
    const res = await this.pool.query(sql, params);
    return res.rows.map((r) => ({ id: r.id, name: r.name, code: r.code ?? null }));
  }

  private async fetchBridges(
    tenantId: string,
    outletId?: string,
  ): Promise<TokenlessBridgeRow[]> {
    const params: unknown[] = [tenantId];
    let sql =
      `SELECT id, outlet_id, status, last_seen_at FROM branch_bridges WHERE tenant_id = $1`;
    if (outletId) {
      params.push(outletId);
      sql += ` AND outlet_id = $2`;
    }
    const res = await this.pool.query<TokenlessBridgeRow>(sql, params);
    return res.rows;
  }

  private async fetchBranchDevices(
    tenantId: string,
    outletId?: string,
  ): Promise<BranchDeviceRow[]> {
    const params: unknown[] = [tenantId];
    let sql =
      `SELECT id, outlet_id, category, name, status, ip_address, ref_id, vendor, model, last_seen_at
       FROM branch_devices WHERE tenant_id = $1`;
    if (outletId) {
      params.push(outletId);
      sql += ` AND outlet_id = $2`;
    }
    sql += ` ORDER BY created_at DESC`;
    const res = await this.pool.query<BranchDeviceRow>(sql, params);
    return res.rows;
  }

  private async fetchTokenDevices(
    table: 'pos_devices' | 'kiosk_devices',
    tenantId: string,
    outletId?: string,
  ): Promise<TokenDeviceRow[]> {
    const params: unknown[] = [tenantId];
    let sql =
      `SELECT id, outlet_id, label, is_active, last_seen_at FROM ${table} WHERE tenant_id = $1`;
    if (outletId) {
      params.push(outletId);
      sql += ` AND outlet_id = $2`;
    }
    sql += ` ORDER BY created_at DESC`;
    const res = await this.pool.query<TokenDeviceRow>(sql, params);
    return res.rows;
  }

  // ─── Row → leaf mappers ───────────────────────────────────────────────────────

  private mapBranchDevice(r: BranchDeviceRow): TopologyDevice {
    return {
      id: r.id,
      name: r.name,
      category: r.category,
      status: r.status,
      ipAddress: r.ip_address ?? null,
      refId: r.ref_id ?? null,
      vendor: r.vendor ?? null,
      model: r.model ?? null,
      lastSeenAt: this.iso(r.last_seen_at),
    };
  }

  /**
   * Map a pos/kiosk token-device row into a device leaf. These tables have no
   * online/offline column, so status is derived from `last_seen_at` recency
   * (inactive or never-seen → offline).
   */
  private mapTokenDevice(r: TokenDeviceRow, category: DeviceCategory): TopologyDevice {
    const seenMs = r.last_seen_at ? new Date(r.last_seen_at).getTime() : 0;
    const fresh = seenMs > 0 && Date.now() - seenMs < POS_KIOSK_ONLINE_WINDOW_MS;
    const status: DeviceStatus = r.is_active && fresh ? 'online' : 'offline';
    return {
      id: r.id,
      name: r.label ?? (category === 'kiosk' ? 'Kiosk' : 'POS Terminal'),
      category,
      status,
      ipAddress: null,
      refId: r.id,
      vendor: null,
      model: null,
      lastSeenAt: this.iso(r.last_seen_at),
    };
  }

  private iso(v: string | Date | null): string | null {
    if (!v) return null;
    return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
  }
}

/** Raw `branch_bridges` row (subset used by the tree — no pairing token). */
interface TokenlessBridgeRow {
  id: string;
  outlet_id: string;
  status: string;
  last_seen_at: string | Date | null;
}
