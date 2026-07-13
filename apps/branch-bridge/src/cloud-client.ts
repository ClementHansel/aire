import { io, type Socket } from 'socket.io-client';
import type {
  AgentToCloudEvents,
  CommandRequest,
  ConfigureRequest,
  ScanRequest,
  StreamStartRequest,
  StreamStopRequest,
} from './types';

const HEARTBEAT_INTERVAL_MS = 15000;

/** Handlers the agent supplies for cloud -> agent events. */
export interface CloudHandlers {
  onScan: (req: ScanRequest) => void | Promise<void>;
  onConfigure: (req: ConfigureRequest) => void | Promise<void>;
  onStreamStart: (req: StreamStartRequest) => void | Promise<void>;
  onStreamStop: (req: StreamStopRequest) => void | Promise<void>;
  onCommand: (req: CommandRequest) => void | Promise<void>;
}

/** Snapshot the agent supplies for each heartbeat. */
export type HeartbeatSource = () => { cameras: string[]; devices: string[] };

/**
 * Holds the single outbound Socket.IO connection to the cloud `/bridge`
 * namespace, wires cloud->agent handlers, exposes typed emit helpers, and
 * sends a heartbeat every 15s.
 */
export class CloudClient {
  private socket: Socket;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(
    cloudUrl: string,
    token: string,
    private handlers: CloudHandlers,
    private heartbeatSource: HeartbeatSource,
  ) {
    this.socket = io(`${cloudUrl}/bridge`, {
      auth: { token },
      reconnection: true,
      // Start on HTTP long-polling and upgrade to WebSocket when the upgrade
      // succeeds. WebSocket-only has no fallback, so a flaky/absent WS upgrade
      // (common behind branch routers, proxies, or nginx without the upgrade
      // headers) causes constant connect/disconnect churn. Polling-first keeps
      // the link stable and upgrades opportunistically.
      transports: ['polling', 'websocket'],
    });

    this.registerHandlers();
  }

  private registerHandlers(): void {
    this.socket.on('connect', () => {
      console.log('[CloudClient] connected to /bridge');
    });
    this.socket.on('disconnect', (reason) => {
      console.log(`[CloudClient] disconnected: ${reason}`);
    });
    this.socket.on('connect_error', (err) => {
      console.error('[CloudClient] connect_error:', err.message);
    });

    this.socket.on('scan', (req: ScanRequest) => {
      void this.handlers.onScan(req);
    });
    this.socket.on('configure', (req: ConfigureRequest) => {
      void this.handlers.onConfigure(req);
    });
    this.socket.on('stream:start', (req: StreamStartRequest) => {
      void this.handlers.onStreamStart(req);
    });
    this.socket.on('stream:stop', (req: StreamStopRequest) => {
      void this.handlers.onStreamStop(req);
    });
    this.socket.on('command', (req: CommandRequest) => {
      void this.handlers.onCommand(req);
    });
  }

  /** Start the 15s heartbeat loop. */
  start(): void {
    if (this.heartbeatTimer) return;
    const send = () => {
      const { cameras, devices } = this.heartbeatSource();
      this.emit('heartbeat', { ts: Date.now(), cameras, devices });
    };
    this.heartbeatTimer = setInterval(send, HEARTBEAT_INTERVAL_MS);
  }

  /** Typed emit helper: event name must be an agent->cloud event. */
  emit<E extends keyof AgentToCloudEvents>(
    event: E,
    payload: AgentToCloudEvents[E],
  ): void {
    this.socket.emit(event as string, payload);
  }

  isConnected(): boolean {
    return this.socket.connected;
  }

  disconnect(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.socket.removeAllListeners();
    this.socket.disconnect();
  }
}
