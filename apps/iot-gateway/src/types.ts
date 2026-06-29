/**
 * Sensor message received from ESP32/RPi bay controllers via MQTT.
 * Topic: aire/{tenant_id}/{outlet_id}/bay/{bay_id}/sensor
 */
export interface SensorMessage {
  bayId: string;
  vehiclePresent: boolean;
  waterFlow: number;
  foamLevel: number;
  machineStatus: 'idle' | 'running' | 'error';
  timestamp: string;
}

/**
 * Command message published to bay controllers via MQTT.
 * Topic: aire/{tenant_id}/{outlet_id}/bay/{bay_id}/command
 */
export interface BayCommand {
  action: 'gate_open' | 'gate_close' | 'start_wash' | 'stop_wash' | 'emergency_stop';
  bayId: string;
}

/**
 * Parsed MQTT topic structure for sensor data.
 */
export interface ParsedSensorTopic {
  tenantId: string;
  outletId: string;
  bayId: string;
}

/**
 * WebSocket event emitted when bay sensor data is received.
 */
export interface BayStatusEvent {
  type: 'bay:status-changed';
  tenantId: string;
  outletId: string;
  bayId: string;
  sensorData: SensorMessage;
}

/**
 * Configuration for the IoT gateway service.
 */
export interface IoTGatewayConfig {
  mqttBrokerUrl: string;
  mqttUsername?: string;
  mqttPassword?: string;
  mqttClientId: string;
  websocketPort: number;
  /** Tenant IDs to subscribe to. Empty array = subscribe to all via wildcard. */
  tenantIds: string[];
}
