import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger, Inject } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { RealtimeGateway } from '../realtime';
import { BridgeService, ResolvedBridge } from './bridge.service';
import {
  BridgeEvents,
  DeviceEvent,
  ScanDoneEvent,
  ConfigureResultEvent,
  HlsPlaylistEvent,
  HlsSegmentEvent,
  SensorEvent,
  HeartbeatEvent,
} from './bridge.events';

/** Per-socket state stored on `socket.data` once the handshake is resolved. */
interface SocketBridgeData {
  bridge: ResolvedBridge;
}

/**
 * BridgeGateway — the cloud end of the on-prem branch-bridge socket.
 *
 * Runs as a SECOND Socket.IO gateway on the dedicated `/bridge` namespace
 * (RealtimeGateway owns `/` for browser clients). Exactly one agent connects
 * per bridge, outbound-only, authenticated by the opaque `pairing_token` in
 * `handshake.auth.token`.
 *
 * Responsibilities:
 *  - Resolve + scope the connection (invalid token → immediate disconnect).
 *  - Maintain liveness (`online`/`offline`, `last_seen_at`).
 *  - Fan every inbound agent event onto the in-process {@link BridgeEvents} bus,
 *    tagged with the resolved bridge context, so feature services consume data
 *    without depending on the transport.
 *  - Provide {@link emitToOutlet} so the dispatch service can push
 *    cloud→agent commands to the right socket.
 *
 * `sensor` is the one event handled inline here (rather than only re-emitted):
 * it writes `bays.sensor_data` and forwards a bay-status change to browser
 * clients via {@link RealtimeGateway}, matching the existing bay realtime path.
 */
@WebSocketGateway({ namespace: '/bridge', cors: { origin: '*' } })
export class BridgeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(BridgeGateway.name);

  /** bridgeId → live socket (used for status + targeted teardown). */
  private readonly bridgeSockets = new Map<string, Socket>();
  /** outletId → live socket (used by the dispatch service to route commands). */
  private readonly outletSockets = new Map<string, Socket>();

  constructor(
    private readonly bridgeService: BridgeService,
    private readonly bridgeEvents: BridgeEvents,
    private readonly realtimeGateway: RealtimeGateway,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const raw = client.handshake.auth?.token;
    const token = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined;

    const resolved = token ? await this.bridgeService.resolveByToken(token) : null;
    if (!resolved) {
      this.logger.warn(`Bridge socket ${client.id} rejected: invalid pairing token`);
      client.disconnect(true);
      return;
    }

    (client.data as SocketBridgeData).bridge = resolved;
    this.bridgeSockets.set(resolved.bridgeId, client);
    this.outletSockets.set(resolved.outletId, client);

    await this.bridgeService.setStatus(resolved.bridgeId, 'online').catch((e) =>
      this.logger.error(`Failed marking bridge online: ${e}`),
    );
    this.logger.log(
      `Bridge online: ${resolved.bridgeId} (outlet ${resolved.outletId}) socket ${client.id}`,
    );
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const ctx = (client.data as SocketBridgeData)?.bridge;
    if (!ctx) return;

    // Only clear the maps if this socket is still the current one for the bridge
    // (guards against a fast reconnect having already replaced it).
    if (this.bridgeSockets.get(ctx.bridgeId) === client) {
      this.bridgeSockets.delete(ctx.bridgeId);
    }
    if (this.outletSockets.get(ctx.outletId) === client) {
      this.outletSockets.delete(ctx.outletId);
    }

    await this.bridgeService.setStatus(ctx.bridgeId, 'offline').catch((e) =>
      this.logger.error(`Failed marking bridge offline: ${e}`),
    );
    // Let consumers drop per-bridge live state (Cctv forgets its streaming set so
    // a reconnected agent gets a fresh stream:start on the next live request).
    this.bridgeEvents.emit('bridge:offline', {
      bridgeId: ctx.bridgeId,
      tenantId: ctx.tenantId,
      outletId: ctx.outletId,
    });
    this.logger.log(`Bridge offline: ${ctx.bridgeId} socket ${client.id}`);
  }

  // ─── Cloud → Agent ─────────────────────────────────────────────────────────

  /**
   * Emit a command to the agent paired with `outletId`. Returns false when no
   * agent is currently connected for that outlet (bridge offline / absent), so
   * callers can decide whether that is fatal.
   */
  emitToOutlet(outletId: string, event: string, payload: unknown): boolean {
    const socket = this.outletSockets.get(outletId);
    if (!socket) return false;
    socket.emit(event, payload);
    return true;
  }

  /** Whether an agent is currently connected for the given bridge id. */
  isBridgeOnline(bridgeId: string): boolean {
    return this.bridgeSockets.has(bridgeId);
  }

  // ─── Agent → Cloud (inbound events) ──────────────────────────────────────────

  @SubscribeMessage('device')
  onDevice(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { scanId: string; device: DeviceEvent['device'] },
  ): void {
    const ctx = this.ctx(client);
    if (!ctx) return;
    const event: DeviceEvent = { ...ctx, scanId: body.scanId, device: body.device };
    this.bridgeEvents.emit('device', event);
  }

  @SubscribeMessage('scan:done')
  onScanDone(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { scanId: string; count: number; errors?: ScanDoneEvent['errors'] },
  ): void {
    const ctx = this.ctx(client);
    if (!ctx) return;
    const event: ScanDoneEvent = {
      ...ctx,
      scanId: body.scanId,
      count: body.count ?? 0,
      errors: body.errors ?? [],
    };
    this.bridgeEvents.emit('scan:done', event);
  }

  @SubscribeMessage('configure:result')
  onConfigureResult(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: { deviceId: string; ok: boolean; error?: string; connection_params?: Record<string, unknown> },
  ): void {
    const ctx = this.ctx(client);
    if (!ctx) return;
    const event: ConfigureResultEvent = { ...ctx, ...body };
    this.bridgeEvents.emit('configure:result', event);
  }

  @SubscribeMessage('hls:playlist')
  onHlsPlaylist(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { cameraId: string; m3u8: string },
  ): void {
    const ctx = this.ctx(client);
    if (!ctx) return;
    const event: HlsPlaylistEvent = { ...ctx, cameraId: body.cameraId, m3u8: body.m3u8 };
    this.bridgeEvents.emit('hls:playlist', event);
  }

  @SubscribeMessage('hls:segment')
  onHlsSegment(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: { cameraId: string; name: string; dataB64: string; durationSec: number; seq: number },
  ): void {
    const ctx = this.ctx(client);
    if (!ctx) return;
    const event: HlsSegmentEvent = { ...ctx, ...body };
    this.bridgeEvents.emit('hls:segment', event);
  }

  @SubscribeMessage('sensor')
  async onSensor(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: Omit<SensorEvent, keyof ResolvedBridge>,
  ): Promise<void> {
    const ctx = this.ctx(client);
    if (!ctx) return;
    const event: SensorEvent = { ...ctx, ...body };

    // Re-emit for any other listeners (analytics, automations).
    this.bridgeEvents.emit('sensor', event);

    if (!event.bayId) return;

    // Bay ids are UUIDs. Simulated/misconfigured controllers may send a
    // non-UUID id (e.g. "sim-bay-1"); skip the DB write for those rather than
    // letting Postgres throw an uuid-cast error on every message.
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(event.bayId)) {
      this.logger.debug(
        `Ignoring sensor data for non-UUID bay "${event.bayId}" (outlet ${event.outletId})`,
      );
      return;
    }

    const sensorData: Record<string, unknown> = {
      vehiclePresent: event.vehiclePresent,
      waterFlow: event.waterFlow,
      foamLevel: event.foamLevel,
      machineStatus: event.machineStatus,
      timestamp: event.timestamp ?? new Date().toISOString(),
    };

    try {
      const res = await this.pool.query<{ status: string }>(
        `UPDATE bays
         SET sensor_data = $2::jsonb, last_heartbeat = NOW(), updated_at = NOW()
         WHERE id = $1 AND outlet_id = $3
         RETURNING status`,
        [event.bayId, JSON.stringify(sensorData), event.outletId],
      );
      const status = res.rows[0]?.status ?? 'available';
      this.realtimeGateway.emitBayStatusChanged(event.outletId, {
        bayId: event.bayId,
        status,
        sensorData,
      });
    } catch (e) {
      this.logger.error(`Failed persisting sensor data for bay ${event.bayId}: ${e}`);
    }
  }

  @SubscribeMessage('heartbeat')
  async onHeartbeat(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { ts?: number; cameras?: string[]; devices?: string[]; agentVersion?: string },
  ): Promise<void> {
    const ctx = this.ctx(client);
    if (!ctx) return;
    const event: HeartbeatEvent = {
      ...ctx,
      ts: body.ts ?? Date.now(),
      cameras: body.cameras ?? [],
      devices: body.devices ?? [],
    };
    this.bridgeEvents.emit('heartbeat', event);
    await this.bridgeService.touch(ctx.bridgeId, body.agentVersion).catch(() => undefined);
  }

  /** Read the resolved bridge context bound to a socket during handshake. */
  private ctx(client: Socket): ResolvedBridge | null {
    return (client.data as SocketBridgeData)?.bridge ?? null;
  }
}
