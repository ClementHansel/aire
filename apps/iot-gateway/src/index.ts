import { AireMqttClient } from './mqtt-client';
import { MessageHandler } from './message-handler';
import { IoTGatewayConfig, BayStatusEvent } from './types';

export { AireMqttClient, parseSensorTopic, buildCommandTopic, buildSensorSubscriptionTopic } from './mqtt-client';
export { MessageHandler, validateSensorMessage, buildBayKey } from './message-handler';
export type { SensorMessage, BayCommand, ParsedSensorTopic, BayStatusEvent, IoTGatewayConfig } from './types';

/**
 * Load configuration from environment variables.
 */
function loadConfig(): IoTGatewayConfig {
  const tenantIdsRaw = process.env.IOT_TENANT_IDS || '';
  const tenantIds = tenantIdsRaw
    ? tenantIdsRaw.split(',').map((id) => id.trim()).filter(Boolean)
    : [];

  return {
    mqttBrokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
    mqttUsername: process.env.MQTT_USERNAME || undefined,
    mqttPassword: process.env.MQTT_PASSWORD || undefined,
    mqttClientId: process.env.MQTT_CLIENT_ID || `aire-iot-gateway-${Date.now()}`,
    websocketPort: parseInt(process.env.IOT_WS_PORT || '4002', 10),
    tenantIds,
  };
}

/**
 * Placeholder WebSocket broadcaster.
 * In production, this would forward events to the Socket.IO server
 * or directly to connected WebSocket clients.
 */
function createWebSocketBroadcaster(): (event: BayStatusEvent) => void {
  return (event: BayStatusEvent) => {
    console.log(
      `[IoT Gateway] Broadcasting event: ${event.type} for bay ${event.bayId}` +
      ` (tenant: ${event.tenantId}, outlet: ${event.outletId})`,
    );
    // TODO: Forward to Socket.IO server or direct WebSocket connections
    // This will be implemented when the WebSocket integration is built
  };
}

/**
 * Start the IoT gateway service.
 */
async function main(): Promise<void> {
  console.log('[IoT Gateway] Starting AIRE IoT Gateway Service...');

  const config = loadConfig();
  console.log(`[IoT Gateway] MQTT Broker: ${config.mqttBrokerUrl}`);
  console.log(`[IoT Gateway] WebSocket Port: ${config.websocketPort}`);
  console.log(
    `[IoT Gateway] Tenant filter: ${config.tenantIds.length > 0 ? config.tenantIds.join(', ') : 'all (wildcard)'}`,
  );

  // Initialize message handler
  const messageHandler = new MessageHandler();
  messageHandler.onBroadcast(createWebSocketBroadcaster());

  // Initialize MQTT client
  const mqttClient = new AireMqttClient(config);
  mqttClient.onSensorMessage((tenantId, outletId, bayId, message) => {
    messageHandler.handleSensorMessage(tenantId, outletId, bayId, message);
  });

  // Connect to MQTT broker
  try {
    await mqttClient.connect();
    console.log('[IoT Gateway] Service started successfully');
  } catch (err) {
    console.error('[IoT Gateway] Failed to start:', err);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[IoT Gateway] Shutting down...');
    await mqttClient.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Only run main if this file is executed directly (not imported)
if (require.main === module) {
  main();
}
