import mqtt, { type MqttClient, type IClientOptions } from 'mqtt';
import type {
  BayCommandAction,
  CommandRequest,
  SensorEvent,
} from './types';

/** Wildcard subscription for all bay sensor topics on the local broker. */
export const SENSOR_SUBSCRIPTION = 'aire/+/+/bay/+/sensor';

/**
 * Parse a sensor topic: aire/{tenantId}/{outletId}/bay/{bayId}/sensor.
 * Returns null when the topic does not match. (Mirrors iot-gateway logic.)
 */
export function parseSensorTopic(
  topic: string,
): { tenantId: string; outletId: string; bayId: string } | null {
  const parts = topic.split('/');
  if (parts.length !== 6) return null;
  if (parts[0] !== 'aire') return null;
  if (parts[3] !== 'bay') return null;
  if (parts[5] !== 'sensor') return null;
  const [, tenantId, outletId, , bayId] = parts;
  if (!tenantId || !outletId || !bayId) return null;
  return { tenantId, outletId, bayId };
}

/** Build a bay command topic. */
export function buildCommandTopic(
  tenantId: string,
  outletId: string,
  bayId: string,
): string {
  return `aire/${tenantId}/${outletId}/bay/${bayId}/command`;
}

/** Coerce an arbitrary parsed payload into a SensorEvent for the given bay. */
export function toSensorEvent(bayId: string, raw: unknown): SensorEvent {
  const msg = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const machine = msg.machineStatus;
  const machineStatus: SensorEvent['machineStatus'] =
    machine === 'running' || machine === 'error' ? machine : 'idle';
  return {
    bayId: typeof msg.bayId === 'string' && msg.bayId ? msg.bayId : bayId,
    vehiclePresent: Boolean(msg.vehiclePresent),
    waterFlow: typeof msg.waterFlow === 'number' ? msg.waterFlow : 0,
    foamLevel: typeof msg.foamLevel === 'number' ? msg.foamLevel : 0,
    machineStatus,
    timestamp:
      typeof msg.timestamp === 'string' && msg.timestamp
        ? msg.timestamp
        : new Date().toISOString(),
  };
}

export interface MqttBridgeOptions {
  mqttUrl: string;
  simulate: boolean;
  tenantId: string;
  outletId: string;
}

/**
 * Bridges the local MQTT broker to the cloud: forwards bay sensor readings up
 * as `sensor` events, and publishes cloud `command`s down to bay controllers.
 * In simulate mode it fabricates a sensor reading every ~10s and never touches
 * a real broker.
 */
export class MqttBridge {
  private client: MqttClient | null = null;
  private connected = false;
  private simTimer: NodeJS.Timeout | null = null;
  /** Last tenant/outlet observed from a sensor topic, used as a publish fallback. */
  private lastScope: { tenantId: string; outletId: string } | null = null;

  constructor(
    private options: MqttBridgeOptions,
    private onSensor: (event: SensorEvent) => void,
  ) {}

  async connect(): Promise<void> {
    if (this.options.simulate) {
      this.startSimulation();
      return;
    }

    const opts: IClientOptions = {
      clientId: `aire-branch-bridge-${Date.now()}`,
      clean: true,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
    };

    await new Promise<void>((resolve, reject) => {
      const client = mqtt.connect(this.options.mqttUrl, opts);
      this.client = client;

      client.on('connect', () => {
        this.connected = true;
        console.log(`[MqttBridge] connected to ${this.options.mqttUrl}`);
        client.subscribe(SENSOR_SUBSCRIPTION, { qos: 1 }, (err) => {
          if (err) {
            console.error('[MqttBridge] subscribe failed:', err.message);
          } else {
            console.log(`[MqttBridge] subscribed to ${SENSOR_SUBSCRIPTION}`);
          }
        });
        resolve();
      });

      client.on('message', (topic, payload) => {
        this.handleMessage(topic, payload);
      });

      client.on('error', (err) => {
        console.error('[MqttBridge] error:', err.message);
        if (!this.connected) reject(err);
      });

      client.on('close', () => {
        this.connected = false;
      });
    });
  }

  private handleMessage(topic: string, payload: Buffer): void {
    const parsed = parseSensorTopic(topic);
    if (!parsed) return;
    this.lastScope = { tenantId: parsed.tenantId, outletId: parsed.outletId };
    let raw: unknown = {};
    try {
      raw = JSON.parse(payload.toString());
    } catch {
      console.warn(`[MqttBridge] non-JSON payload on ${topic}`);
      return;
    }
    this.onSensor(toSensorEvent(parsed.bayId, raw));
  }

  /** Publish a bay command received from the cloud to the local broker. */
  publishCommand(command: CommandRequest): void {
    const scope = this.lastScope ?? {
      tenantId: this.options.tenantId,
      outletId: this.options.outletId,
    };
    const topic = buildCommandTopic(scope.tenantId, scope.outletId, command.bayId);
    const payload = JSON.stringify({
      action: command.action as BayCommandAction,
      bayId: command.bayId,
    });

    if (this.options.simulate || !this.client || !this.connected) {
      console.log(`[MqttBridge] (simulate) command -> ${topic}: ${payload}`);
      return;
    }
    this.client.publish(topic, payload, { qos: 1 }, (err) => {
      if (err) console.error(`[MqttBridge] publish failed to ${topic}:`, err.message);
      else console.log(`[MqttBridge] published ${command.action} -> ${topic}`);
    });
  }

  /** Emit a synthetic sensor reading roughly every 10s (simulate mode). */
  private startSimulation(): void {
    console.log('[MqttBridge] simulate mode: emitting fake sensor every ~10s');
    const emit = () => {
      const running = Math.random() > 0.5;
      this.onSensor({
        bayId: 'sim-bay-1',
        vehiclePresent: running,
        waterFlow: running ? Math.round(Math.random() * 30 * 10) / 10 : 0,
        foamLevel: running ? Math.round(Math.random() * 100) : 0,
        machineStatus: running ? 'running' : 'idle',
        timestamp: new Date().toISOString(),
      });
    };
    emit();
    this.simTimer = setInterval(emit, 10000);
  }

  isConnected(): boolean {
    return this.options.simulate ? true : this.connected;
  }

  async disconnect(): Promise<void> {
    if (this.simTimer) {
      clearInterval(this.simTimer);
      this.simTimer = null;
    }
    if (this.client) {
      await new Promise<void>((resolve) => {
        this.client!.end(false, {}, () => resolve());
      });
      this.client = null;
    }
  }
}
