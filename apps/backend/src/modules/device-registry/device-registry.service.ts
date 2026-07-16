import {
  Injectable,
  Inject,
  Optional,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import {
  BridgeEvents,
  HeartbeatEvent,
  BridgeOfflineEvent,
} from '../bridge/bridge.events';
import type { DiscoveredDeviceType } from '../settings/settings.interfaces';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';

/**
 * The categories a `branch_devices` row can take. `camera | controller |
 * printer | router | other` are written by discovery/registration into
 * `branch_devices`; `pos_terminal | kiosk` are surfaced by the topology/registry
 * read layer via a UNION over the existing `pos_devices` / `kiosk_devices`
 * tables (a later pass may mirror those into `branch_devices` for uniform status).
 */
export type DeviceCategory =
  | 'camera'
  | 'nvr'
  | 'controller'
  | 'printer'
  | 'scanner'
  | 'kiosk'
  | 'pos_terminal'
  | 'tablet'
  | 'router'
  | 'other';

/** Liveness of a registered device. */
export type DeviceStatus = 'online' | 'offline' | 'unconfigured';

/** A registered device as returned to the registry UI (camelCase). */
export interface DeviceDTO {
  id: string;
  tenantId: string;
  outletId: string;
  bridgeId: string | null;
  category: DeviceCategory;
  name: string;
  vendor: string | null;
  model: string | null;
  ipAddress: string | null;
  macAddress: string | null;
  refId: string | null;
  connectionParams: Record<string, unknown>;
  status: DeviceStatus;
  metadata: Record<string, unknown>;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Shape accepted by {@link DeviceRegistryService.upsert}. Everything except the
 * three identity fields (tenantId / outletId / category) is optional; unset
 * columns fall back to their defaults on insert and are preserved on update.
 */
export interface UpsertDeviceInput {
  id?: string;
  tenantId: string;
  outletId: string;
  bridgeId?: string | null;
  category: DeviceCategory;
  name?: string;
  vendor?: string | null;
  model?: string | null;
  ipAddress?: string | null;
  macAddress?: string | null;
  refId?: string | null;
  connectionParams?: Record<string, unknown>;
  status?: DeviceStatus;
  metadata?: Record<string, unknown>;
  lastSeenAt?: string | null;
}

/**
 * The minimal device shape discovery hands us. Matches
 * `DiscoveredDeviceInput` from the bridge protocol (07) — `device_type` is the
 * on-the-wire type we map onto a registry {@link DeviceCategory}.
 */
export interface DiscoveredDeviceForRegistry {
  device_id?: string;
  device_type: DiscoveredDeviceType;
  ip_address?: string | null;
  mac_address?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  suggested_label?: string | null;
  connection_params?: Record<string, unknown>;
  assigned_outlet_id?: string | null;
}

/** Options for {@link DeviceRegistryService.upsertFromDiscovery}. */
export interface UpsertFromDiscoveryOptions {
  /** The bridge that discovered the device (null for cloud-direct). */
  bridgeId?: string | null;
  /** Link to the specialized row (cameras.id) created for this device. */
  refId?: string | null;
  /**
   * Override the outlet. Defaults to `discoveredDevice.assigned_outlet_id`.
   * Tenant scope is always the caller-supplied `tenantId`, never device input.
   */
  outletId?: string | null;
}

/**
 * How the on-the-wire discovery `device_type` maps onto a registry category.
 * `iot_controller` becomes `controller`; camera/router pass straight through.
 */
const DEVICE_TYPE_TO_CATEGORY: Record<
  DiscoveredDeviceForRegistry['device_type'],
  DeviceCategory
> = {
  camera: 'camera',
  nvr: 'nvr',
  printer: 'printer',
  barcode_scanner: 'scanner',
  iot_controller: 'controller',
  router: 'router',
  pos_terminal: 'pos_terminal',
  kiosk: 'kiosk',
  tablet: 'tablet',
  unknown: 'other',
};

/**
 * DeviceRegistryService — CRUD + status maintenance over `branch_devices`, the
 * unified device registry that backs the registry UI and the topology tree.
 *
 * Registration flows in from discovery confirmation
 * ({@link upsertFromDiscovery}); liveness flows in from the bridge socket via
 * the in-process {@link BridgeEvents} bus — a `heartbeat` marks a bridge's
 * devices `online`, `bridge:offline` marks them `offline`. Subscribing to the
 * bus (rather than being called by the gateway) keeps the module graph acyclic:
 * DeviceRegistry imports Bridge, never the reverse — exactly the pattern
 * {@link CctvService} uses for relayed HLS events.
 *
 * All reads/writes are tenant-scoped from the caller's JWT, never from device or
 * request input, so a compromised agent can never widen its scope.
 */
@Injectable()
export class DeviceRegistryService implements OnModuleInit {
  private readonly logger = new Logger(DeviceRegistryService.name);

  /** Last-known online state per bridge, for offline/online transition alerts. */
  private readonly bridgeOnline = new Map<string, boolean>();

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() @Inject(BridgeEvents) private readonly bridgeEvents?: BridgeEvents,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  /**
   * Wire the bridge event bus once. Done in onModuleInit (not the constructor)
   * so unit tests that construct the service with just a pool are not forced to
   * provide an event bus.
   */
  onModuleInit(): void {
    this.subscribeToBridge();
  }

  /** Subscribe to liveness events. Safe to call when no bus is wired (tests). */
  subscribeToBridge(): void {
    if (!this.bridgeEvents) return;
    // Heartbeat = the branch's agent is up → its devices are reachable.
    this.bridgeEvents.on('heartbeat', (e: HeartbeatEvent) =>
      void this.handleBridgeLiveness(e.bridgeId, e.tenantId, e.outletId, true),
    );
    // The gateway emits this locally when an agent disconnects.
    this.bridgeEvents.on('bridge:offline', (e: BridgeOfflineEvent) =>
      void this.handleBridgeLiveness(e.bridgeId, e.tenantId, e.outletId, false),
    );
  }

  /**
   * Update every device on a bridge and, on a state TRANSITION, emit a
   * device.offline / device.online domain event so the AI monitoring feed +
   * realtime dashboard can alert that a branch's edge went down / recovered.
   * The initial heartbeat (undefined → online) is silent (not an incident).
   */
  private async handleBridgeLiveness(
    bridgeId: string,
    tenantId: string,
    outletId: string,
    online: boolean,
  ): Promise<void> {
    await this.setStatusForBridge(bridgeId, online ? 'online' : 'offline');
    const prev = this.bridgeOnline.get(bridgeId);
    if (prev === online) return; // no change
    this.bridgeOnline.set(bridgeId, online);
    if (prev === undefined && online) return; // first sighting, not an incident
    if (!this.eventBus) return;
    let devices: string[] = [];
    try {
      const r = await this.pool.query<{ name: string }>(
        `SELECT name FROM branch_devices WHERE bridge_id = $1 ORDER BY name`,
        [bridgeId],
      );
      devices = r.rows.map((row) => row.name);
    } catch {
      /* best-effort enrichment */
    }
    void this.eventBus.emit({
      type: online ? DomainEventType.DeviceOnline : DomainEventType.DeviceOffline,
      tenantId,
      outletId,
      payload: { bridgeId, deviceCount: devices.length, devices },
    });
  }

  // ─── Registration ────────────────────────────────────────────────────────────

  /**
   * Register (or refresh) a device from a confirmed discovery result. Maps the
   * discovery `device_type` onto a registry category, then upserts keyed by
   * `(bridge_id, ip_address)` when both are known (matching the DB's partial
   * unique index), otherwise by `(outlet_id, category, ip_address)`. Idempotent:
   * re-confirming the same device updates the existing row rather than
   * duplicating it.
   */
  async upsertFromDiscovery(
    tenantId: string,
    discoveredDevice: DiscoveredDeviceForRegistry,
    options: UpsertFromDiscoveryOptions = {},
  ): Promise<DeviceDTO> {
    const category = DEVICE_TYPE_TO_CATEGORY[discoveredDevice.device_type] ?? 'other';
    const outletId =
      options.outletId ?? discoveredDevice.assigned_outlet_id ?? null;
    if (!outletId) {
      throw new Error('upsertFromDiscovery requires an outletId (assigned or explicit)');
    }

    const ipAddress = discoveredDevice.ip_address ?? null;
    const bridgeId = options.bridgeId ?? null;

    const existing = await this.findExisting({
      tenantId,
      outletId,
      category,
      bridgeId,
      ipAddress,
    });

    const name =
      discoveredDevice.suggested_label?.trim() ||
      existing?.name ||
      this.fallbackName(category, discoveredDevice.manufacturer ?? null);

    return this.upsert({
      id: existing?.id,
      tenantId,
      outletId,
      bridgeId,
      category,
      name,
      vendor: discoveredDevice.manufacturer ?? null,
      model: discoveredDevice.model ?? null,
      ipAddress,
      macAddress: discoveredDevice.mac_address ?? null,
      refId: options.refId ?? existing?.refId ?? null,
      connectionParams: discoveredDevice.connection_params ?? {},
      // A confirmed device is considered online until a heartbeat says otherwise.
      status: 'online',
      lastSeenAt: new Date().toISOString(),
    });
  }

  /**
   * Generic upsert. If `input.id` is set (or an existing row is found by
   * identity) the row is updated in place; otherwise a new row is inserted.
   * COALESCE keeps unset optional fields at their current value on update.
   */
  async upsert(input: UpsertDeviceInput): Promise<DeviceDTO> {
    const existingId =
      input.id ??
      (
        await this.findExisting({
          tenantId: input.tenantId,
          outletId: input.outletId,
          category: input.category,
          bridgeId: input.bridgeId ?? null,
          ipAddress: input.ipAddress ?? null,
        })
      )?.id;

    if (existingId) {
      const res = await this.pool.query(
        `UPDATE branch_devices SET
           bridge_id = COALESCE($3, bridge_id),
           name = COALESCE($4, name),
           vendor = COALESCE($5, vendor),
           model = COALESCE($6, model),
           ip_address = COALESCE($7, ip_address),
           mac_address = COALESCE($8, mac_address),
           ref_id = COALESCE($9, ref_id),
           connection_params = COALESCE($10::jsonb, connection_params),
           status = COALESCE($11, status),
           metadata = COALESCE($12::jsonb, metadata),
           last_seen_at = COALESCE($13, last_seen_at),
           updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2
         RETURNING ${DeviceRegistryService.COLUMNS}`,
        [
          existingId,
          input.tenantId,
          input.bridgeId ?? null,
          input.name ?? null,
          input.vendor ?? null,
          input.model ?? null,
          input.ipAddress ?? null,
          input.macAddress ?? null,
          input.refId ?? null,
          input.connectionParams ? JSON.stringify(input.connectionParams) : null,
          input.status ?? null,
          input.metadata ? JSON.stringify(input.metadata) : null,
          input.lastSeenAt ?? null,
        ],
      );
      if (res.rows.length === 0) throw new NotFoundException('Device not found');
      return this.map(res.rows[0]);
    }

    const res = await this.pool.query(
      `INSERT INTO branch_devices
         (tenant_id, outlet_id, bridge_id, category, name, vendor, model,
          ip_address, mac_address, ref_id, connection_params, status, metadata, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13::jsonb, $14)
       RETURNING ${DeviceRegistryService.COLUMNS}`,
      [
        input.tenantId,
        input.outletId,
        input.bridgeId ?? null,
        input.category,
        input.name ?? this.fallbackName(input.category, input.vendor ?? null),
        input.vendor ?? null,
        input.model ?? null,
        input.ipAddress ?? null,
        input.macAddress ?? null,
        input.refId ?? null,
        JSON.stringify(input.connectionParams ?? {}),
        input.status ?? 'unconfigured',
        JSON.stringify(input.metadata ?? {}),
        input.lastSeenAt ?? null,
      ],
    );
    return this.map(res.rows[0]);
  }

  // ─── Reads ─────────────────────────────────────────────────────────────────

  /** List a tenant's registered devices, optionally filtered by outlet/category. */
  async listByOutlet(
    tenantId: string,
    filters: { outletId?: string; category?: DeviceCategory } = {},
  ): Promise<DeviceDTO[]> {
    const clauses = ['tenant_id = $1'];
    const params: unknown[] = [tenantId];
    if (filters.outletId) {
      params.push(filters.outletId);
      clauses.push(`outlet_id = $${params.length}`);
    }
    if (filters.category) {
      params.push(filters.category);
      clauses.push(`category = $${params.length}`);
    }
    const res = await this.pool.query(
      `SELECT ${DeviceRegistryService.COLUMNS} FROM branch_devices
       WHERE ${clauses.join(' AND ')}
       ORDER BY category, created_at DESC`,
      params,
    );
    return res.rows.map((r) => this.map(r));
  }

  /** Fetch a single device scoped to the tenant, throwing if absent. */
  async get(tenantId: string, id: string): Promise<DeviceDTO> {
    const res = await this.pool.query(
      `SELECT ${DeviceRegistryService.COLUMNS} FROM branch_devices
       WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    if (res.rows.length === 0) throw new NotFoundException(`Device ${id} not found`);
    return this.map(res.rows[0]);
  }

  // ─── Status maintenance ──────────────────────────────────────────────────────

  /**
   * Bulk-flip every device belonging to a bridge online/offline. Called off the
   * bridge event bus (heartbeat → online, bridge:offline → offline). Best-effort:
   * never throws (the bridge may have out-raced a delete). Cameras additionally
   * flip via their own stream state in {@link CctvService}.
   */
  async setStatusForBridge(bridgeId: string, status: DeviceStatus): Promise<void> {
    if (!bridgeId) return;
    try {
      await this.pool.query(
        `UPDATE branch_devices
         SET status = $2,
             last_seen_at = CASE WHEN $2 = 'online' THEN NOW() ELSE last_seen_at END,
             updated_at = NOW()
         WHERE bridge_id = $1`,
        [bridgeId, status],
      );
    } catch (err) {
      this.logger.error(
        `Failed setting devices ${status} for bridge ${bridgeId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Delete a device (tenant-scoped). Throws if the row does not exist. */
  async remove(tenantId: string, id: string): Promise<void> {
    const res = await this.pool.query(
      `DELETE FROM branch_devices WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    if (res.rowCount === 0) throw new NotFoundException(`Device ${id} not found`);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Find the existing row a device would upsert into. Prefers the DB's unique
   * key `(bridge_id, ip_address)` when both are known; otherwise falls back to
   * `(outlet_id, category, ip_address)`. Returns null when there is no IP to key
   * on (every IP-less device is treated as a fresh insert).
   */
  private async findExisting(key: {
    tenantId: string;
    outletId: string;
    category: DeviceCategory;
    bridgeId: string | null;
    ipAddress: string | null;
  }): Promise<DeviceDTO | null> {
    if (!key.ipAddress) return null;

    if (key.bridgeId) {
      const res = await this.pool.query(
        `SELECT ${DeviceRegistryService.COLUMNS} FROM branch_devices
         WHERE tenant_id = $1 AND bridge_id = $2 AND ip_address = $3
         LIMIT 1`,
        [key.tenantId, key.bridgeId, key.ipAddress],
      );
      if (res.rows[0]) return this.map(res.rows[0]);
    }

    const res = await this.pool.query(
      `SELECT ${DeviceRegistryService.COLUMNS} FROM branch_devices
       WHERE tenant_id = $1 AND outlet_id = $2 AND category = $3 AND ip_address = $4
       LIMIT 1`,
      [key.tenantId, key.outletId, key.category, key.ipAddress],
    );
    return res.rows[0] ? this.map(res.rows[0]) : null;
  }

  /** Human-readable fallback name when discovery gives us no label. */
  private fallbackName(category: DeviceCategory, vendor: string | null): string {
    const label = category.charAt(0).toUpperCase() + category.slice(1).replace('_', ' ');
    return vendor && vendor.trim() ? `${label} - ${vendor.trim()}` : label;
  }

  // Column list shared across queries.
  private static readonly COLUMNS =
    'id, tenant_id, outlet_id, bridge_id, category, name, vendor, model, ip_address, ' +
    'mac_address, ref_id, connection_params, status, metadata, last_seen_at, created_at, updated_at';

  private map = (r: any): DeviceDTO => ({
    id: r.id,
    tenantId: r.tenant_id,
    outletId: r.outlet_id,
    bridgeId: r.bridge_id ?? null,
    category: r.category,
    name: r.name,
    vendor: r.vendor ?? null,
    model: r.model ?? null,
    ipAddress: r.ip_address ?? null,
    macAddress: r.mac_address ?? null,
    refId: r.ref_id ?? null,
    connectionParams: r.connection_params ?? {},
    status: r.status,
    metadata: r.metadata ?? {},
    lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : r.created_at,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : r.updated_at,
  });
}
