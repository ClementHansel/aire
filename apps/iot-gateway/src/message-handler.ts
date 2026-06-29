import { BayStatusEvent, SensorMessage } from './types';

/**
 * Callback type for broadcasting WebSocket events.
 */
export type WebSocketBroadcaster = (event: BayStatusEvent) => void;

/**
 * Validates that a sensor message has the required fields and correct types.
 */
export function validateSensorMessage(data: unknown): data is SensorMessage {
  if (!data || typeof data !== 'object') return false;

  const msg = data as Record<string, unknown>;

  if (typeof msg.bayId !== 'string' || msg.bayId.length === 0) return false;
  if (typeof msg.vehiclePresent !== 'boolean') return false;
  if (typeof msg.waterFlow !== 'number' || msg.waterFlow < 0) return false;
  if (typeof msg.foamLevel !== 'number' || msg.foamLevel < 0) return false;
  if (!isValidMachineStatus(msg.machineStatus)) return false;
  if (typeof msg.timestamp !== 'string' || msg.timestamp.length === 0)
    return false;

  return true;
}

/**
 * Check if a value is a valid machine status.
 */
function isValidMachineStatus(value: unknown): value is SensorMessage['machineStatus'] {
  return value === 'idle' || value === 'running' || value === 'error';
}

/**
 * Processes incoming sensor messages from bay controllers.
 * Validates data, transforms to WebSocket events, and broadcasts to connected clients.
 */
export class MessageHandler {
  private broadcaster: WebSocketBroadcaster | null = null;
  private lastMessages: Map<string, SensorMessage> = new Map();

  /**
   * Register a WebSocket broadcaster function for real-time UI updates.
   */
  onBroadcast(broadcaster: WebSocketBroadcaster): void {
    this.broadcaster = broadcaster;
  }

  /**
   * Handle an incoming sensor message from a bay controller.
   * Validates the message, stores the latest state, and broadcasts to WebSocket clients.
   *
   * @returns true if message was valid and processed, false otherwise.
   */
  handleSensorMessage(
    tenantId: string,
    outletId: string,
    bayId: string,
    rawMessage: unknown,
  ): boolean {
    if (!validateSensorMessage(rawMessage)) {
      console.warn(
        `[MessageHandler] Invalid sensor message from bay ${bayId}:`,
        rawMessage,
      );
      return false;
    }

    const message: SensorMessage = rawMessage;

    // Store latest message for this bay
    const key = buildBayKey(tenantId, outletId, bayId);
    this.lastMessages.set(key, message);

    // Build and broadcast WebSocket event
    const event: BayStatusEvent = {
      type: 'bay:status-changed',
      tenantId,
      outletId,
      bayId,
      sensorData: message,
    };

    if (this.broadcaster) {
      this.broadcaster(event);
    }

    return true;
  }

  /**
   * Get the latest sensor message for a specific bay.
   */
  getLatestMessage(
    tenantId: string,
    outletId: string,
    bayId: string,
  ): SensorMessage | undefined {
    const key = buildBayKey(tenantId, outletId, bayId);
    return this.lastMessages.get(key);
  }

  /**
   * Get all latest sensor messages.
   */
  getAllLatestMessages(): Map<string, SensorMessage> {
    return new Map(this.lastMessages);
  }

  /**
   * Clear stored state (useful for testing or reset scenarios).
   */
  clear(): void {
    this.lastMessages.clear();
  }
}

/**
 * Build a unique key for a bay combining tenant, outlet, and bay IDs.
 */
export function buildBayKey(
  tenantId: string,
  outletId: string,
  bayId: string,
): string {
  return `${tenantId}:${outletId}:${bayId}`;
}
