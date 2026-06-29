import mqtt, { MqttClient, IClientOptions } from 'mqtt';
import { BayCommand, IoTGatewayConfig, SensorMessage } from './types';

/**
 * MQTT topic patterns for the AIRE IoT system.
 *
 * Sensor data: aire/{tenant_id}/{outlet_id}/bay/{bay_id}/sensor
 * Commands:    aire/{tenant_id}/{outlet_id}/bay/{bay_id}/command
 */
const SENSOR_TOPIC_PATTERN = 'aire/+/+/bay/+/sensor';

/**
 * Build a sensor subscription topic for a specific tenant, or wildcard for all.
 */
export function buildSensorSubscriptionTopic(tenantId?: string): string {
  if (tenantId) {
    return `aire/${tenantId}/+/bay/+/sensor`;
  }
  return SENSOR_TOPIC_PATTERN;
}

/**
 * Build a command publish topic for a specific bay.
 */
export function buildCommandTopic(
  tenantId: string,
  outletId: string,
  bayId: string,
): string {
  return `aire/${tenantId}/${outletId}/bay/${bayId}/command`;
}

export type SensorMessageHandler = (
  tenantId: string,
  outletId: string,
  bayId: string,
  message: SensorMessage,
) => void;

/**
 * MQTT client wrapper for the AIRE IoT gateway.
 * Manages connection to Mosquitto broker, subscribes to sensor topics,
 * and publishes commands to bay controllers.
 */
export class AireMqttClient {
  private client: MqttClient | null = null;
  private config: IoTGatewayConfig;
  private messageHandler: SensorMessageHandler | null = null;
  private connected = false;

  constructor(config: IoTGatewayConfig) {
    this.config = config;
  }

  /**
   * Register a handler for incoming sensor messages.
   */
  onSensorMessage(handler: SensorMessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * Connect to the MQTT broker and subscribe to sensor topics.
   */
  async connect(): Promise<void> {
    const options: IClientOptions = {
      clientId: this.config.mqttClientId,
      clean: true,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
    };

    if (this.config.mqttUsername) {
      options.username = this.config.mqttUsername;
    }
    if (this.config.mqttPassword) {
      options.password = this.config.mqttPassword;
    }

    return new Promise((resolve, reject) => {
      this.client = mqtt.connect(this.config.mqttBrokerUrl, options);

      this.client.on('connect', () => {
        this.connected = true;
        console.log(
          `[IoT Gateway] Connected to MQTT broker at ${this.config.mqttBrokerUrl}`,
        );
        this.subscribeToSensorTopics();
        resolve();
      });

      this.client.on('error', (err) => {
        console.error('[IoT Gateway] MQTT connection error:', err.message);
        if (!this.connected) {
          reject(err);
        }
      });

      this.client.on('reconnect', () => {
        console.log('[IoT Gateway] Reconnecting to MQTT broker...');
      });

      this.client.on('close', () => {
        this.connected = false;
        console.log('[IoT Gateway] MQTT connection closed');
      });

      this.client.on('message', (topic, payload) => {
        this.handleIncomingMessage(topic, payload);
      });
    });
  }

  /**
   * Subscribe to sensor data topics based on configured tenant IDs.
   */
  private subscribeToSensorTopics(): void {
    if (!this.client) return;

    if (this.config.tenantIds.length === 0) {
      // Subscribe to all tenants via wildcard
      const topic = buildSensorSubscriptionTopic();
      this.client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          console.error(
            `[IoT Gateway] Failed to subscribe to ${topic}:`,
            err.message,
          );
        } else {
          console.log(`[IoT Gateway] Subscribed to ${topic}`);
        }
      });
    } else {
      // Subscribe to specific tenants
      for (const tenantId of this.config.tenantIds) {
        const topic = buildSensorSubscriptionTopic(tenantId);
        this.client.subscribe(topic, { qos: 1 }, (err) => {
          if (err) {
            console.error(
              `[IoT Gateway] Failed to subscribe to ${topic}:`,
              err.message,
            );
          } else {
            console.log(`[IoT Gateway] Subscribed to ${topic}`);
          }
        });
      }
    }
  }

  /**
   * Handle incoming MQTT messages and route sensor data to the handler.
   */
  private handleIncomingMessage(topic: string, payload: Buffer): void {
    const parsed = parseSensorTopic(topic);
    if (!parsed) {
      console.warn(`[IoT Gateway] Received message on unknown topic: ${topic}`);
      return;
    }

    try {
      const message: SensorMessage = JSON.parse(payload.toString());
      if (this.messageHandler) {
        this.messageHandler(
          parsed.tenantId,
          parsed.outletId,
          parsed.bayId,
          message,
        );
      }
    } catch (err) {
      console.error(
        `[IoT Gateway] Failed to parse sensor message from ${topic}:`,
        err,
      );
    }
  }

  /**
   * Publish a command to a specific bay controller.
   */
  publishCommand(
    tenantId: string,
    outletId: string,
    command: BayCommand,
  ): void {
    if (!this.client || !this.connected) {
      console.error(
        '[IoT Gateway] Cannot publish command: not connected to broker',
      );
      return;
    }

    const topic = buildCommandTopic(tenantId, outletId, command.bayId);
    const payload = JSON.stringify(command);

    this.client.publish(topic, payload, { qos: 1 }, (err) => {
      if (err) {
        console.error(
          `[IoT Gateway] Failed to publish command to ${topic}:`,
          err.message,
        );
      } else {
        console.log(
          `[IoT Gateway] Published command ${command.action} to bay ${command.bayId}`,
        );
      }
    });
  }

  /**
   * Disconnect from the MQTT broker.
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      return new Promise((resolve) => {
        this.client!.end(false, () => {
          this.connected = false;
          console.log('[IoT Gateway] Disconnected from MQTT broker');
          resolve();
        });
      });
    }
  }

  /**
   * Check if the client is currently connected.
   */
  isConnected(): boolean {
    return this.connected;
  }
}

/**
 * Parse an MQTT sensor topic into its component parts.
 * Expected format: aire/{tenant_id}/{outlet_id}/bay/{bay_id}/sensor
 *
 * @returns Parsed topic parts or null if format is invalid.
 */
export function parseSensorTopic(
  topic: string,
): { tenantId: string; outletId: string; bayId: string } | null {
  const parts = topic.split('/');

  // Expected: ['aire', tenantId, outletId, 'bay', bayId, 'sensor']
  if (parts.length !== 6) return null;
  if (parts[0] !== 'aire') return null;
  if (parts[3] !== 'bay') return null;
  if (parts[5] !== 'sensor') return null;

  const tenantId = parts[1];
  const outletId = parts[2];
  const bayId = parts[4];

  if (!tenantId || !outletId || !bayId) return null;

  return { tenantId, outletId, bayId };
}
