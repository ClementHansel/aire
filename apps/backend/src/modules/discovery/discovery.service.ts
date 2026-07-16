import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  Inject,
  OnModuleInit,
} from '@nestjs/common';
import { Pool } from 'pg';
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import { DiscoveredDevice } from '../settings/settings.interfaces';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { DATABASE_POOL } from '../auth/database.provider';
import { BridgeDispatchService } from '../bridge/bridge-dispatch.service';
import { BridgeEvents, DeviceEvent, ScanDoneEvent } from '../bridge/bridge.events';
import { DeviceRegistryService } from '../device-registry/device-registry.service';
import { encrypt } from '../settings/encryption.util';
import {
  DeviceConfirmation,
  DeviceHealthCheck,
  DiscoveryProtocol,
  ScanSession,
} from './discovery.types';

/** After this long with no `scan:done`, a scan is force-completed + persisted. */
const SCAN_TIMEOUT_MS = 30_000;

/** Fixed namespace for deriving stable, deterministic device ids (uuidv5). */
const DEVICE_ID_NAMESPACE = '6f3d2c1a-9b8e-4d7c-a1f2-0e5b4c3d2a19';

/**
 * Device Discovery Service (bridge model).
 *
 * The cloud no longer scans networks directly — a branch cannot be reached from
 * the VPS. Instead {@link scanNetwork} DISPATCHES a scan to the outlet's bridge
 * agent (via {@link BridgeDispatchService}) and buffers the `device` /
 * `scan:done` events the agent streams back on the {@link BridgeEvents} bus. The
 * wizard polls {@link getScan} for progress; on completion the found devices are
 * merged into the tenant's `settings.discovered_devices` (confirmed devices are
 * preserved).
 *
 * Health-check + label helpers are retained from the pre-bridge implementation.
 *
 * Requirements: 9.1, 9.2, 9.3, 10.1, 10.2, 10.3, 10.5
 */
@Injectable()
export class DiscoveryService implements OnModuleInit {
  private readonly logger = new Logger(DiscoveryService.name);

  /** scanId → live scan buffer. Kept in memory for the life of the scan. */
  private readonly scans = new Map<string, ScanSession>();

  constructor(
    @Optional() @Inject(SettingsService) private readonly settingsService?: SettingsService,
    @Optional() @Inject(AuditService) private readonly auditService?: AuditService,
    @Optional()
    @Inject(BridgeDispatchService)
    private readonly bridgeDispatch?: BridgeDispatchService,
    @Optional() @Inject(BridgeEvents) private readonly bridgeEvents?: BridgeEvents,
    @Optional() @Inject(DATABASE_POOL) private readonly pool?: Pool,
    @Optional()
    @Inject(DeviceRegistryService)
    private readonly deviceRegistry?: DeviceRegistryService,
  ) {}

  /**
   * Wire the bridge event bus once. Done in onModuleInit (not the constructor)
   * so unit tests that construct the service with a subset of deps are not
   * forced to provide an event bus.
   */
  onModuleInit(): void {
    this.subscribeToBridge();
  }

  /** Subscribe to the streamed scan events. Safe to call when no bus exists. */
  subscribeToBridge(): void {
    if (!this.bridgeEvents) return;
    this.bridgeEvents.on('device', (e: DeviceEvent) => this.onDeviceEvent(e));
    this.bridgeEvents.on('scan:done', (e: ScanDoneEvent) => this.onScanDone(e));
  }

  // ─── Scan dispatch + buffering ───────────────────────────────────────────────

  /**
   * Start a LAN scan on the outlet's bridge agent. Returns immediately with a
   * scanId; results arrive asynchronously via the bridge event bus and can be
   * polled through {@link getScan}. Throws (via the dispatch service) when the
   * bridge is offline.
   *
   * Requirements: 9.1
   */
  async scanNetwork(
    tenantId: string,
    outletId: string,
  ): Promise<{ scanId: string }> {
    if (!this.bridgeDispatch) {
      throw new Error('BridgeDispatchService is required to start a scan');
    }

    const scanId = this.bridgeDispatch.dispatchScan(outletId);
    this.scans.set(scanId, {
      scanId,
      tenantId,
      outletId,
      status: 'scanning',
      devices: [],
      errors: [],
    });

    // Force-complete the scan if the agent never sends scan:done.
    setTimeout(() => {
      const session = this.scans.get(scanId);
      if (session && session.status === 'scanning') {
        this.logger.warn(`Scan ${scanId} timed out after ${SCAN_TIMEOUT_MS}ms; finalising`);
        void this.finaliseScan(session);
      }
    }, SCAN_TIMEOUT_MS).unref?.();

    if (this.auditService) {
      await this.auditService.log({
        tenantId,
        userId: null,
        operation: 'device_scan_started',
        entityType: 'network_scan',
        entityId: scanId,
        afterValue: { outlet_id: outletId },
      });
    }

    return { scanId };
  }

  /** Poll a scan's current buffer (devices found so far + status). */
  getScan(scanId: string): ScanSession | null {
    return this.scans.get(scanId) ?? null;
  }

  /** Append a streamed device to its scan buffer. */
  private onDeviceEvent(e: DeviceEvent): void {
    const session = this.scans.get(e.scanId);
    if (!session) return;
    const mac = (e.device.connection_params?.mac as string | undefined) || null;
    const stableKey = `${session.tenantId}:${mac ?? e.device.ip_address}`;
    const record = this.createDeviceRecord({
      ip_address: e.device.ip_address,
      device_type: e.device.device_type,
      manufacturer: e.device.manufacturer,
      model: e.device.model,
      connection_params: e.device.connection_params,
      stableKey,
    });
    session.devices.push(record);
  }

  /** Mark a scan done + persist found devices into tenant settings. */
  private async onScanDone(e: ScanDoneEvent): Promise<void> {
    const session = this.scans.get(e.scanId);
    if (!session) return;
    session.errors = e.errors.map((err) => ({
      protocol: (err.protocol as DiscoveryProtocol) || 'onvif',
      message: err.message,
    }));
    await this.finaliseScan(session);
  }

  /**
   * Flip a scan to 'done' and merge its devices into tenant settings, keeping
   * any already-confirmed devices intact. Idempotent — safe to call from both
   * `scan:done` and the timeout path.
   */
  private async finaliseScan(session: ScanSession): Promise<void> {
    if (session.status === 'done') return;
    session.status = 'done';

    if (!this.settingsService) return;

    try {
      const settings = await this.settingsService.getSettings(session.tenantId);
      // UNION merge keyed by device id — never lose a previously-found device
      // just because a flaky/partial scan didn't re-see it. Confirmed devices are
      // always kept as-is; unconfirmed prior devices are retained and a fresh
      // sighting refreshes their fields (status/model/params) in place.
      const byId = new Map<string, DiscoveredDevice>();
      for (const prior of settings.discovered_devices) {
        byId.set(prior.device_id, prior);
      }
      for (const fresh of session.devices) {
        const prior = byId.get(fresh.device_id);
        if (prior?.confirmed) continue; // keep the confirmed record untouched
        byId.set(fresh.device_id, prior ? { ...prior, ...fresh } : fresh);
      }
      const merged = [...byId.values()];
      await this.settingsService.updateSettings(session.tenantId, null, {
        discovered_devices: merged,
      });
    } catch (err) {
      this.logger.error(
        `Failed persisting scan ${session.scanId} devices: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (this.auditService) {
      await this.auditService.log({
        tenantId: session.tenantId,
        userId: null,
        operation: 'device_scan_completed',
        entityType: 'network_scan',
        entityId: session.scanId,
        afterValue: {
          devices_found: session.devices.length,
          errors: session.errors.length > 0 ? session.errors : undefined,
        },
      });
    }
  }

  // ─── Label helpers ───────────────────────────────────────────────────────────

  /**
   * Generate a suggested human-readable label from device type and manufacturer.
   * Format: "{DeviceTypeLabel} - {Manufacturer}" or "… - Unknown".
   *
   * Requirement: 9.3
   */
  generateSuggestedLabel(
    deviceType: DiscoveredDevice['device_type'],
    manufacturer: string | null,
  ): string {
    const typeLabels: Record<DiscoveredDevice['device_type'], string> = {
      camera: 'Camera',
      nvr: 'NVR',
      printer: 'Printer',
      barcode_scanner: 'Barcode Scanner',
      iot_controller: 'IoT Controller',
      router: 'Router',
      pos_terminal: 'POS Terminal',
      kiosk: 'Kiosk',
      tablet: 'Tablet',
      unknown: 'Device',
    };
    const typeLabel = typeLabels[deviceType] ?? 'Device';
    const mfgLabel = manufacturer && manufacturer.trim() ? manufacturer.trim() : 'Unknown';
    return `${typeLabel} - ${mfgLabel}`;
  }

  /**
   * Build a full DiscoveredDevice record (cloud-assigned id/label/status) from
   * the minimal fields the agent reports for a scanned device.
   */
  createDeviceRecord(params: {
    ip_address: string;
    device_type: DiscoveredDevice['device_type'];
    manufacturer: string | null;
    model: string | null;
    connection_params?: Record<string, unknown>;
    /** Stable per-device key (tenant + MAC/IP) so re-scans keep the same id. */
    stableKey?: string;
  }): DiscoveredDevice {
    return {
      // Deterministic id from a stable key (MAC preferred, else IP) so a device
      // keeps the SAME id across re-scans — the confirm flow can then reference a
      // device by id even after a later scan refreshes the discovered list.
      device_id: params.stableKey
        ? uuidv5(params.stableKey, DEVICE_ID_NAMESPACE)
        : uuidv4(),
      ip_address: params.ip_address,
      device_type: params.device_type,
      manufacturer: params.manufacturer,
      model: params.model,
      suggested_label: this.generateSuggestedLabel(params.device_type, params.manufacturer),
      status: 'unconfigured',
      confirmed: false,
      assigned_bay_id: null,
      assigned_outlet_id: null,
      connection_params: params.connection_params ?? {},
      discovered_at: new Date().toISOString(),
      confirmed_at: null,
    };
  }

  // ─── Confirmation + auto-configuration ───────────────────────────────────────

  /**
   * Confirm a discovered device, assign it to a bay/outlet, and auto-configure
   * it through the bridge agent. Cameras additionally get a `cameras` row and a
   * `stream:start` dispatch so they appear on the live CCTV page.
   *
   * If auto-configuration fails the device is still confirmed but the error is
   * stored in `connection_params.auto_config_error` for manual fallback.
   *
   * Requirements: 10.1, 10.2, 10.3, 10.5
   */
  async confirmDevice(
    tenantId: string,
    confirmation: DeviceConfirmation,
  ): Promise<DiscoveredDevice> {
    if (!this.settingsService) {
      throw new Error('SettingsService is required for device confirmation');
    }

    const settings = await this.settingsService.getSettings(tenantId);
    // Prefer the persisted record; fall back to any LIVE in-memory scan buffer
    // (what the wizard just polled) so a confirm can't 404 due to a persistence
    // race or a later scan refreshing the list.
    let source = settings.discovered_devices.find(
      (d) => d.device_id === confirmation.device_id,
    );
    if (!source) {
      for (const session of this.scans.values()) {
        if (session.tenantId !== tenantId) continue;
        const found = session.devices.find(
          (d) => d.device_id === confirmation.device_id,
        );
        if (found) {
          source = found;
          break;
        }
      }
    }
    if (!source) {
      throw new NotFoundException(
        `Device ${confirmation.device_id} not found in tenant's discovered devices`,
      );
    }

    const device = { ...source };
    device.confirmed = true;
    device.assigned_outlet_id = confirmation.assigned_outlet_id;
    device.assigned_bay_id = confirmation.assigned_bay_id ?? null;
    device.confirmed_at = new Date().toISOString();
    device.status = 'online';

    // For an NVR, hand the device credentials + host to the agent (transiently,
    // in connection_params) so autoconfigure can enumerate its channels over
    // ONVIF. These are NOT persisted — the agent strips the password from its
    // configure:result, and we clear them below before saving.
    if (confirmation.credentials) {
      device.connection_params = {
        ...device.connection_params,
        host: device.ip_address,
        username: confirmation.credentials.username,
        password: confirmation.credentials.password,
      };
    }

    let autoConfigSuccess = true;
    let autoConfigError: string | undefined;
    let cameraRefId: string | null = null;
    try {
      await this.autoconfigure(device, tenantId);
      // Once configured, a camera is registered + its live relay is started.
      if (device.device_type === 'camera') {
        cameraRefId = await this.registerCameraFromDevice(tenantId, device);
      } else if (device.device_type === 'nvr') {
        // Each ONVIF channel behind the NVR becomes its own camera.
        cameraRefId = await this.registerNvrChannels(tenantId, device);
      }
      // Never persist raw credentials.
      if (device.connection_params.password) {
        device.connection_params = { ...device.connection_params, password: undefined };
      }
    } catch (error) {
      autoConfigSuccess = false;
      autoConfigError = error instanceof Error ? error.message : String(error);
      device.connection_params = {
        ...device.connection_params,
        auto_config_error: autoConfigError,
      };
      this.logger.warn(
        `Auto-configuration failed for device ${device.device_id}: ${autoConfigError}`,
      );
    }

    // Upsert by id (the device may not have been in the persisted list yet).
    const updatedDevices = [
      ...settings.discovered_devices.filter((d) => d.device_id !== device.device_id),
      device,
    ];
    await this.settingsService.updateSettings(tenantId, null, {
      discovered_devices: updatedDevices,
    });

    // Register (or refresh) the unified `branch_devices` row so the device shows
    // up in the registry + topology. Best-effort: a registry failure must not
    // fail the confirmation itself. Cameras carry the `cameras.id` as ref_id.
    if (this.deviceRegistry && device.assigned_outlet_id) {
      try {
        const bridgeId = await this.resolveBridgeId(device.assigned_outlet_id);
        await this.deviceRegistry.upsertFromDiscovery(
          tenantId,
          {
            device_id: device.device_id,
            device_type: device.device_type,
            ip_address: device.ip_address,
            manufacturer: device.manufacturer,
            model: device.model,
            suggested_label: device.suggested_label,
            connection_params: device.connection_params,
            assigned_outlet_id: device.assigned_outlet_id,
          },
          { bridgeId, refId: cameraRefId ?? undefined },
        );
      } catch (err) {
        this.logger.warn(
          `Failed registering device ${device.device_id} in branch_devices: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    if (this.auditService) {
      await this.auditService.log({
        tenantId,
        userId: null,
        operation: 'device_confirmed',
        entityType: 'discovered_device',
        entityId: device.device_id,
        afterValue: {
          device_type: device.device_type,
          ip_address: device.ip_address,
          assigned_outlet_id: device.assigned_outlet_id,
          assigned_bay_id: device.assigned_bay_id,
          auto_config_success: autoConfigSuccess,
          auto_config_error: autoConfigError,
        },
      });
      if (!autoConfigSuccess) {
        await this.auditService.log({
          tenantId,
          userId: null,
          operation: 'device_auto_config_failed',
          entityType: 'discovered_device',
          entityId: device.device_id,
          afterValue: {
            device_type: device.device_type,
            ip_address: device.ip_address,
            error: autoConfigError,
          },
        });
      }
    }

    this.logger.log(
      `Device ${device.device_id} confirmed for tenant ${tenantId} ` +
        `(type: ${device.device_type}, outlet: ${device.assigned_outlet_id})`,
    );
    return device;
  }

  /**
   * Route auto-configuration to the bridge agent. When a dispatch service is
   * wired the agent performs the real validation (RTSP probe / MQTT subscribe)
   * and returns the effective connection_params; otherwise we fall back to the
   * legacy local stubs (used in isolated unit tests).
   */
  private async autoconfigure(device: DiscoveredDevice, tenantId: string): Promise<void> {
    if (this.bridgeDispatch && device.assigned_outlet_id) {
      const result = await this.bridgeDispatch.dispatchConfigure(device.assigned_outlet_id, {
        deviceId: device.device_id,
        device_type: device.device_type,
        connection_params: device.connection_params,
      });
      if (!result.ok) {
        throw new Error(result.error ?? 'configure failed');
      }
      if (result.connection_params) {
        device.connection_params = {
          ...device.connection_params,
          ...result.connection_params,
        };
      }
      return;
    }

    // Legacy fallback (no bridge wired): compute params locally.
    switch (device.device_type) {
      case 'camera':
        await this.autoconfigureCamera(device);
        break;
      case 'iot_controller':
        await this.autoconfigureIoT(device, tenantId);
        break;
      case 'router':
        this.logger.debug(`Router ${device.device_id} confirmed — no auto-configuration needed`);
        break;
    }
  }

  /**
   * Insert a `cameras` row for a confirmed camera device and kick off its live
   * relay. No-op when the pool is not wired (isolated unit tests).
   */
  private async registerCameraFromDevice(
    tenantId: string,
    device: DiscoveredDevice,
  ): Promise<string | null> {
    if (!this.pool || !device.assigned_outlet_id) return null;

    const rtspUrl = String(device.connection_params.rtsp_url ?? '');
    const bridgeId = await this.resolveBridgeId(device.assigned_outlet_id);

    const inserted = await this.pool.query<{ id: string }>(
      `INSERT INTO cameras (tenant_id, outlet_id, bridge_id, name, rtsp_url, device_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        tenantId,
        device.assigned_outlet_id,
        bridgeId,
        device.suggested_label,
        rtspUrl,
        device.device_id,
      ],
    );
    const cameraId = inserted.rows[0]!.id;

    if (this.bridgeDispatch && rtspUrl) {
      this.bridgeDispatch.dispatchStreamStart(device.assigned_outlet_id, { cameraId, rtspUrl });
    }
    this.logger.log(`Registered camera ${cameraId} from device ${device.device_id}`);
    return cameraId;
  }

  /**
   * Register one `cameras` row per channel behind a confirmed NVR (channels are
   * resolved by the agent over ONVIF into `connection_params.channels`) and kick
   * off each channel's live relay. Idempotent per (device, channel token) via a
   * derived camera `device_id`. Returns the first camera id (or null when the NVR
   * exposed no channels — it still registers as an `nvr` in the device registry).
   */
  private async registerNvrChannels(
    tenantId: string,
    device: DiscoveredDevice,
  ): Promise<string | null> {
    if (!this.pool || !device.assigned_outlet_id) return null;
    const channels = Array.isArray(device.connection_params.channels)
      ? (device.connection_params.channels as Array<{
          name?: string;
          token?: string;
          channel?: number;
          stream?: 'main' | 'sub';
          rtsp_url?: string;
          vendor?: string;
        }>)
      : [];
    if (channels.length === 0) {
      this.logger.warn(
        `NVR ${device.device_id} confirmed but exposed no channels ` +
          `(wrong credentials / RTSP+ONVIF disabled) — registered as NVR only`,
      );
      return null;
    }
    const bridgeId = await this.resolveBridgeId(device.assigned_outlet_id);
    // Encrypt the NVR login once (best-effort) so live auto-reconnect + archive
    // playback can re-authenticate without the password living in the RTSP URL.
    const username = (device.connection_params.username as string) || '';
    const password = (device.connection_params.password as string) || '';
    let credEnc: string | null = null;
    if (username) {
      try {
        credEnc = encrypt(JSON.stringify({ username, password }));
      } catch (err) {
        this.logger.warn(
          `Could not encrypt NVR credentials (SETTINGS_ENCRYPTION_KEY?): ${
            err instanceof Error ? err.message : String(err)
          } — live/playback will need the password re-entered`,
        );
      }
    }
    const host = device.ip_address;
    let firstId: string | null = null;
    for (let i = 0; i < channels.length; i += 1) {
      const ch = channels[i]!;
      const rtspUrl = String(ch.rtsp_url ?? ''); // credential-less
      if (!rtspUrl) continue;
      const channelDeviceId = uuidv5(`${device.device_id}:${ch.token ?? i}`, DEVICE_ID_NAMESPACE);
      const name = `${device.suggested_label} · ${ch.name ?? `Ch ${i + 1}`}`;
      const playbackMeta = {
        vendor: ch.vendor ?? 'onvif',
        host,
        port: 554,
        channel: ch.channel ?? i + 1,
        stream: ch.stream ?? 'main',
        cred_enc: credEnc,
        onvif: !!ch.token && String(ch.token).startsWith('profile'),
      };
      // Manual upsert keyed by device_id (cameras.device_id has no unique index).
      const existing = await this.pool.query<{ id: string }>(
        `SELECT id FROM cameras WHERE device_id = $1 LIMIT 1`,
        [channelDeviceId],
      );
      let cameraId: string;
      if (existing.rows[0]) {
        cameraId = existing.rows[0].id;
        await this.pool.query(
          `UPDATE cameras SET rtsp_url = $2, name = $3, playback_meta = $4 WHERE id = $1`,
          [cameraId, rtspUrl, name, JSON.stringify(playbackMeta)],
        );
      } else {
        const inserted = await this.pool.query<{ id: string }>(
          `INSERT INTO cameras (tenant_id, outlet_id, bridge_id, name, rtsp_url, device_id, playback_meta)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [tenantId, device.assigned_outlet_id, bridgeId, name, rtspUrl, channelDeviceId, JSON.stringify(playbackMeta)],
        );
        cameraId = inserted.rows[0]!.id;
      }
      firstId = firstId ?? cameraId;
      if (this.bridgeDispatch) {
        // Pass the plaintext creds now (we have them at confirm); ongoing
        // reconnects re-derive them from the encrypted playback_meta.
        this.bridgeDispatch.dispatchStreamStart(device.assigned_outlet_id, {
          cameraId,
          rtspUrl,
          username: username || undefined,
          password: password || undefined,
        });
      }
    }
    this.logger.log(
      `Registered ${channels.length} channel camera(s) from NVR ${device.device_id}`,
    );
    return firstId;
  }

  /** Resolve the bridge paired to an outlet, or null when none/no pool. */
  private async resolveBridgeId(outletId: string): Promise<string | null> {
    if (!this.pool) return null;
    const res = await this.pool.query<{ id: string }>(
      `SELECT id FROM branch_bridges WHERE outlet_id = $1 LIMIT 1`,
      [outletId],
    );
    return res.rows[0]?.id ?? null;
  }

  // ─── Health monitoring (unchanged, settings-backed) ──────────────────────────

  /**
   * Ping each confirmed device, update online/offline status, and persist any
   * changes. Retained from the pre-bridge implementation for periodic sweeps.
   *
   * Requirements: 9.6, 10.6
   */
  async healthCheck(tenantId: string): Promise<DeviceHealthCheck[]> {
    if (!this.settingsService) {
      throw new Error('SettingsService is required for health checks');
    }

    const settings = await this.settingsService.getSettings(tenantId);
    const confirmedDevices = settings.discovered_devices.filter((d) => d.confirmed);
    if (confirmedDevices.length === 0) {
      this.logger.debug(`No confirmed devices for tenant ${tenantId}, skipping health check`);
      return [];
    }

    const results: DeviceHealthCheck[] = [];
    let statusChanged = false;

    for (const device of confirmedDevices) {
      const checkResult = await this.pingDevice(device.ip_address);
      results.push({
        device_id: device.device_id,
        reachable: checkResult.reachable,
        latency_ms: checkResult.latency_ms,
        checked_at: new Date().toISOString(),
      });

      const newStatus: DiscoveredDevice['status'] = checkResult.reachable ? 'online' : 'offline';
      if (device.status !== newStatus) {
        statusChanged = true;
        const idx = settings.discovered_devices.findIndex((d) => d.device_id === device.device_id);
        if (idx !== -1) {
          settings.discovered_devices[idx] = {
            ...settings.discovered_devices[idx]!,
            status: newStatus,
          };
        }
        if (newStatus === 'offline') {
          this.logger.warn(
            `Device ${device.device_id} (${device.suggested_label}) went offline for tenant ${tenantId}.`,
          );
        }
      }
    }

    if (statusChanged) {
      await this.settingsService.updateSettings(tenantId, null, {
        discovered_devices: settings.discovered_devices,
      });
    }

    this.logger.log(
      `Health check for tenant ${tenantId}: ${results.length} checked, ` +
        `${results.filter((r) => r.reachable).length} online.`,
    );
    return results;
  }

  /**
   * Ping a device to check reachability. Stub — designed to be mocked in tests.
   */
  async pingDevice(ip: string): Promise<{ reachable: boolean; latency_ms: number | null }> {
    this.logger.debug(`Pinging device at ${ip}...`);
    return { reachable: true, latency_ms: Math.floor(Math.random() * 50) + 1 };
  }

  // ─── Legacy local auto-config stubs (fallback when no bridge is wired) ────────

  /** Compute RTSP connection params for a camera locally (legacy fallback). */
  async autoconfigureCamera(device: DiscoveredDevice): Promise<void> {
    const rtspUrl = `rtsp://${device.ip_address}:554/stream`;
    device.connection_params = {
      ...device.connection_params,
      rtsp_url: rtspUrl,
      rtsp_port: 554,
      stream_path: '/stream',
      protocol: 'rtsp',
      configured_at: new Date().toISOString(),
    };
  }

  /** Compute MQTT subscription params for an IoT controller (legacy fallback). */
  async autoconfigureIoT(device: DiscoveredDevice, tenantId: string): Promise<void> {
    const baseTopic = `${tenantId}/iot/${device.device_id}/#`;
    device.connection_params = {
      ...device.connection_params,
      mqtt_topic: baseTopic,
      mqtt_broker_ip: device.ip_address,
      mqtt_port: 1883,
      protocol: 'mqtt',
      configured_at: new Date().toISOString(),
    };
  }
}
