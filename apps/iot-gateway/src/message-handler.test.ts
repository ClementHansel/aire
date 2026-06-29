import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MessageHandler,
  validateSensorMessage,
  buildBayKey,
} from './message-handler';
import { BayStatusEvent, SensorMessage } from './types';

describe('validateSensorMessage', () => {
  const validMessage: SensorMessage = {
    bayId: 'bay-1',
    vehiclePresent: true,
    waterFlow: 12.5,
    foamLevel: 80,
    machineStatus: 'running',
    timestamp: '2025-01-15T10:30:00Z',
  };

  it('should accept a valid sensor message', () => {
    expect(validateSensorMessage(validMessage)).toBe(true);
  });

  it('should accept message with machineStatus idle', () => {
    expect(
      validateSensorMessage({ ...validMessage, machineStatus: 'idle' }),
    ).toBe(true);
  });

  it('should accept message with machineStatus error', () => {
    expect(
      validateSensorMessage({ ...validMessage, machineStatus: 'error' }),
    ).toBe(true);
  });

  it('should accept message with vehiclePresent false', () => {
    expect(
      validateSensorMessage({ ...validMessage, vehiclePresent: false }),
    ).toBe(true);
  });

  it('should accept message with zero waterFlow', () => {
    expect(
      validateSensorMessage({ ...validMessage, waterFlow: 0 }),
    ).toBe(true);
  });

  it('should reject null', () => {
    expect(validateSensorMessage(null)).toBe(false);
  });

  it('should reject undefined', () => {
    expect(validateSensorMessage(undefined)).toBe(false);
  });

  it('should reject non-object', () => {
    expect(validateSensorMessage('string')).toBe(false);
    expect(validateSensorMessage(123)).toBe(false);
  });

  it('should reject message with empty bayId', () => {
    expect(validateSensorMessage({ ...validMessage, bayId: '' })).toBe(false);
  });

  it('should reject message with non-string bayId', () => {
    expect(validateSensorMessage({ ...validMessage, bayId: 123 })).toBe(false);
  });

  it('should reject message with non-boolean vehiclePresent', () => {
    expect(
      validateSensorMessage({ ...validMessage, vehiclePresent: 'yes' }),
    ).toBe(false);
  });

  it('should reject message with negative waterFlow', () => {
    expect(
      validateSensorMessage({ ...validMessage, waterFlow: -1 }),
    ).toBe(false);
  });

  it('should reject message with non-number waterFlow', () => {
    expect(
      validateSensorMessage({ ...validMessage, waterFlow: 'high' }),
    ).toBe(false);
  });

  it('should reject message with negative foamLevel', () => {
    expect(
      validateSensorMessage({ ...validMessage, foamLevel: -5 }),
    ).toBe(false);
  });

  it('should reject message with invalid machineStatus', () => {
    expect(
      validateSensorMessage({ ...validMessage, machineStatus: 'unknown' }),
    ).toBe(false);
  });

  it('should reject message with empty timestamp', () => {
    expect(
      validateSensorMessage({ ...validMessage, timestamp: '' }),
    ).toBe(false);
  });

  it('should reject message with non-string timestamp', () => {
    expect(
      validateSensorMessage({ ...validMessage, timestamp: 12345 }),
    ).toBe(false);
  });

  it('should reject message missing required fields', () => {
    expect(validateSensorMessage({ bayId: 'bay-1' })).toBe(false);
    expect(
      validateSensorMessage({
        bayId: 'bay-1',
        vehiclePresent: true,
      }),
    ).toBe(false);
  });
});

describe('buildBayKey', () => {
  it('should combine tenant, outlet, and bay IDs with colons', () => {
    expect(buildBayKey('tenant-1', 'outlet-1', 'bay-1')).toBe(
      'tenant-1:outlet-1:bay-1',
    );
  });

  it('should produce unique keys for different bays', () => {
    const key1 = buildBayKey('t1', 'o1', 'b1');
    const key2 = buildBayKey('t1', 'o1', 'b2');
    expect(key1).not.toBe(key2);
  });

  it('should produce unique keys for different outlets', () => {
    const key1 = buildBayKey('t1', 'o1', 'b1');
    const key2 = buildBayKey('t1', 'o2', 'b1');
    expect(key1).not.toBe(key2);
  });

  it('should produce unique keys for different tenants', () => {
    const key1 = buildBayKey('t1', 'o1', 'b1');
    const key2 = buildBayKey('t2', 'o1', 'b1');
    expect(key1).not.toBe(key2);
  });
});

describe('MessageHandler', () => {
  let handler: MessageHandler;
  let broadcastedEvents: BayStatusEvent[];

  const validMessage: SensorMessage = {
    bayId: 'bay-1',
    vehiclePresent: true,
    waterFlow: 12.5,
    foamLevel: 80,
    machineStatus: 'running',
    timestamp: '2025-01-15T10:30:00Z',
  };

  beforeEach(() => {
    handler = new MessageHandler();
    broadcastedEvents = [];
    handler.onBroadcast((event) => {
      broadcastedEvents.push(event);
    });
  });

  describe('handleSensorMessage', () => {
    it('should return true for a valid sensor message', () => {
      const result = handler.handleSensorMessage(
        'tenant-1',
        'outlet-1',
        'bay-1',
        validMessage,
      );
      expect(result).toBe(true);
    });

    it('should return false for an invalid sensor message', () => {
      const result = handler.handleSensorMessage(
        'tenant-1',
        'outlet-1',
        'bay-1',
        { invalid: 'data' },
      );
      expect(result).toBe(false);
    });

    it('should broadcast a BayStatusEvent on valid message', () => {
      handler.handleSensorMessage('tenant-1', 'outlet-1', 'bay-1', validMessage);

      expect(broadcastedEvents).toHaveLength(1);
      expect(broadcastedEvents[0]).toEqual({
        type: 'bay:status-changed',
        tenantId: 'tenant-1',
        outletId: 'outlet-1',
        bayId: 'bay-1',
        sensorData: validMessage,
      });
    });

    it('should not broadcast on invalid message', () => {
      handler.handleSensorMessage('tenant-1', 'outlet-1', 'bay-1', null);
      expect(broadcastedEvents).toHaveLength(0);
    });

    it('should store the latest message per bay', () => {
      handler.handleSensorMessage('tenant-1', 'outlet-1', 'bay-1', validMessage);

      const latest = handler.getLatestMessage('tenant-1', 'outlet-1', 'bay-1');
      expect(latest).toEqual(validMessage);
    });

    it('should overwrite previous message for the same bay', () => {
      const updatedMessage: SensorMessage = {
        ...validMessage,
        vehiclePresent: false,
        machineStatus: 'idle',
        timestamp: '2025-01-15T10:31:00Z',
      };

      handler.handleSensorMessage('tenant-1', 'outlet-1', 'bay-1', validMessage);
      handler.handleSensorMessage(
        'tenant-1',
        'outlet-1',
        'bay-1',
        updatedMessage,
      );

      const latest = handler.getLatestMessage('tenant-1', 'outlet-1', 'bay-1');
      expect(latest).toEqual(updatedMessage);
    });

    it('should store messages independently for different bays', () => {
      const bay2Message: SensorMessage = {
        ...validMessage,
        bayId: 'bay-2',
        vehiclePresent: false,
      };

      handler.handleSensorMessage('tenant-1', 'outlet-1', 'bay-1', validMessage);
      handler.handleSensorMessage(
        'tenant-1',
        'outlet-1',
        'bay-2',
        bay2Message,
      );

      expect(
        handler.getLatestMessage('tenant-1', 'outlet-1', 'bay-1'),
      ).toEqual(validMessage);
      expect(
        handler.getLatestMessage('tenant-1', 'outlet-1', 'bay-2'),
      ).toEqual(bay2Message);
    });

    it('should handle missing broadcaster gracefully', () => {
      const handlerNoBroadcast = new MessageHandler();
      // No broadcaster registered
      const result = handlerNoBroadcast.handleSensorMessage(
        'tenant-1',
        'outlet-1',
        'bay-1',
        validMessage,
      );
      expect(result).toBe(true);
    });
  });

  describe('getLatestMessage', () => {
    it('should return undefined for unknown bay', () => {
      expect(
        handler.getLatestMessage('tenant-1', 'outlet-1', 'unknown-bay'),
      ).toBeUndefined();
    });
  });

  describe('getAllLatestMessages', () => {
    it('should return empty map when no messages received', () => {
      const messages = handler.getAllLatestMessages();
      expect(messages.size).toBe(0);
    });

    it('should return all stored messages', () => {
      handler.handleSensorMessage('t1', 'o1', 'b1', validMessage);
      handler.handleSensorMessage('t1', 'o1', 'b2', {
        ...validMessage,
        bayId: 'b2',
      });

      const messages = handler.getAllLatestMessages();
      expect(messages.size).toBe(2);
    });
  });

  describe('clear', () => {
    it('should remove all stored messages', () => {
      handler.handleSensorMessage('t1', 'o1', 'b1', validMessage);
      handler.clear();

      expect(handler.getLatestMessage('t1', 'o1', 'b1')).toBeUndefined();
      expect(handler.getAllLatestMessages().size).toBe(0);
    });
  });
});
