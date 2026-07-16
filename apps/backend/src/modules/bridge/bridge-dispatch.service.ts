import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { BridgeGateway } from './bridge.gateway';
import { BridgeEvents, ConfigureResultEvent } from './bridge.events';

/** Result of a `configure` round-trip with the agent. */
export interface ConfigureResult {
  ok: boolean;
  error?: string;
  connection_params?: Record<string, unknown>;
}

/** A configure request awaiting its `configure:result`. */
interface PendingConfigure {
  resolve: (r: ConfigureResult) => void;
  timer: NodeJS.Timeout;
}

/** How long to wait for a `configure:result` before giving up. */
const CONFIGURE_TIMEOUT_MS = 20_000;

/**
 * BridgeDispatchService — the cloud→agent command surface.
 *
 * Feature services (Discovery, Cctv, bay commands) call these methods; the
 * service serialises them onto the correct outlet's socket via
 * {@link BridgeGateway.emitToOutlet}. Request/response commands (`configure`)
 * are correlated back to a Promise via a pending map keyed by deviceId, resolved
 * when the matching `configure:result` arrives on the {@link BridgeEvents} bus.
 *
 * Depends on the gateway (to send) and the event bus (to receive) but nothing
 * depends on it in return — keeping the module graph acyclic.
 */
@Injectable()
export class BridgeDispatchService implements OnModuleInit {
  private readonly logger = new Logger(BridgeDispatchService.name);
  private readonly pendingConfigures = new Map<string, PendingConfigure>();

  constructor(
    private readonly gateway: BridgeGateway,
    private readonly bridgeEvents: BridgeEvents,
  ) {}

  onModuleInit(): void {
    this.bridgeEvents.on('configure:result', (e: ConfigureResultEvent) => {
      const pending = this.pendingConfigures.get(e.deviceId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pendingConfigures.delete(e.deviceId);
      pending.resolve({ ok: e.ok, error: e.error, connection_params: e.connection_params });
    });
  }

  /**
   * Ask the outlet's agent to run a LAN scan. Returns a fresh scanId the caller
   * uses to correlate the streamed `device` / `scan:done` results. Throws when
   * the bridge is offline / absent — a scan cannot be buffered against nothing.
   */
  dispatchScan(outletId: string, protocols?: string[]): string {
    const scanId = uuidv4();
    const sent = this.gateway.emitToOutlet(outletId, 'scan', { scanId, protocols });
    if (!sent) {
      throw new ServiceUnavailableException(
        `No bridge is online for outlet ${outletId}; cannot start a scan`,
      );
    }
    this.logger.log(`Dispatched scan ${scanId} to outlet ${outletId}`);
    return scanId;
  }

  /**
   * Ask the agent to configure a confirmed device (validate RTSP / subscribe
   * MQTT) and wait for its result. Resolves `{ ok:false, error:'timeout' }` if
   * the agent does not reply within {@link CONFIGURE_TIMEOUT_MS}.
   */
  dispatchConfigure(
    outletId: string,
    params: { deviceId: string; device_type: string; connection_params: Record<string, unknown> },
  ): Promise<ConfigureResult> {
    return new Promise<ConfigureResult>((resolve) => {
      const sent = this.gateway.emitToOutlet(outletId, 'configure', {
        deviceId: params.deviceId,
        device_type: params.device_type,
        connection_params: params.connection_params,
      });
      if (!sent) {
        resolve({ ok: false, error: `No bridge online for outlet ${outletId}` });
        return;
      }

      // Replace any stale pending entry for the same device.
      const stale = this.pendingConfigures.get(params.deviceId);
      if (stale) clearTimeout(stale.timer);

      const timer = setTimeout(() => {
        this.pendingConfigures.delete(params.deviceId);
        resolve({ ok: false, error: 'configure timed out' });
      }, CONFIGURE_TIMEOUT_MS);

      this.pendingConfigures.set(params.deviceId, { resolve, timer });
    });
  }

  /**
   * Ask the agent to start relaying a camera's RTSP feed as HLS. Best-effort.
   * `username`/`password` (NVR/camera login) are injected into the URL by the
   * agent at stream time so the credential is never persisted in the DB URL.
   */
  dispatchStreamStart(
    outletId: string,
    params: { cameraId: string; rtspUrl: string; username?: string; password?: string },
  ): boolean {
    const sent = this.gateway.emitToOutlet(outletId, 'stream:start', params);
    if (!sent) {
      this.logger.warn(
        `stream:start for camera ${params.cameraId} not delivered — bridge offline (outlet ${outletId})`,
      );
    }
    return sent;
  }

  /** Ask the agent to stop the ffmpeg relay for a camera. Best-effort. */
  dispatchStreamStop(outletId: string, params: { cameraId: string }): boolean {
    return this.gateway.emitToOutlet(outletId, 'stream:stop', params);
  }

  /** Ask the agent to relay an NVR ARCHIVE (playback) window as a transient HLS session. */
  dispatchPlaybackStart(
    outletId: string,
    params: { sessionId: string; rtspUrl: string; username?: string; password?: string },
  ): boolean {
    const sent = this.gateway.emitToOutlet(outletId, 'playback:start', params);
    if (!sent) {
      this.logger.warn(
        `playback:start ${params.sessionId} not delivered — bridge offline (outlet ${outletId})`,
      );
    }
    return sent;
  }

  /** Ask the agent to stop a playback session. Best-effort. */
  dispatchPlaybackStop(outletId: string, params: { sessionId: string }): boolean {
    return this.gateway.emitToOutlet(outletId, 'playback:stop', params);
  }

  /**
   * Send a bay control command (gate/wash/emergency) to the outlet's agent,
   * which publishes it on the local MQTT command topic. Throws when offline.
   */
  dispatchCommand(outletId: string, params: { bayId: string; action: string }): void {
    const sent = this.gateway.emitToOutlet(outletId, 'command', params);
    if (!sent) {
      throw new ServiceUnavailableException(
        `No bridge is online for outlet ${outletId}; cannot send command`,
      );
    }
  }
}
