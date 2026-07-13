import { describe, it, expect } from 'vitest';
import {
  parseSensorTopic,
  buildCommandTopic,
  toSensorEvent,
  SENSOR_SUBSCRIPTION,
} from './mqtt-bridge';

describe('parseSensorTopic', () => {
  it('parses a valid sensor topic', () => {
    expect(parseSensorTopic('aire/t1/o1/bay/b1/sensor')).toEqual({
      tenantId: 't1',
      outletId: 'o1',
      bayId: 'b1',
    });
  });
  it('rejects wrong prefix / segment count / suffix', () => {
    expect(parseSensorTopic('nope/t1/o1/bay/b1/sensor')).toBeNull();
    expect(parseSensorTopic('aire/t1/o1/bay/b1/command')).toBeNull();
    expect(parseSensorTopic('aire/t1/o1/bay/b1')).toBeNull();
    expect(parseSensorTopic('aire/t1/o1/zone/b1/sensor')).toBeNull();
    expect(parseSensorTopic('aire//o1/bay/b1/sensor')).toBeNull();
  });
});

describe('buildCommandTopic', () => {
  it('builds the command topic', () => {
    expect(buildCommandTopic('t1', 'o1', 'b1')).toBe('aire/t1/o1/bay/b1/command');
  });
});

describe('SENSOR_SUBSCRIPTION', () => {
  it('uses the shared wildcard scheme', () => {
    expect(SENSOR_SUBSCRIPTION).toBe('aire/+/+/bay/+/sensor');
  });
});

describe('toSensorEvent', () => {
  it('passes through a well-formed payload', () => {
    const ev = toSensorEvent('b1', {
      bayId: 'b1',
      vehiclePresent: true,
      waterFlow: 12.5,
      foamLevel: 80,
      machineStatus: 'running',
      timestamp: '2026-07-12T00:00:00.000Z',
    });
    expect(ev.machineStatus).toBe('running');
    expect(ev.waterFlow).toBe(12.5);
    expect(ev.vehiclePresent).toBe(true);
  });
  it('coerces missing/invalid fields to safe defaults', () => {
    const ev = toSensorEvent('fallback-bay', { machineStatus: 'bogus' });
    expect(ev.bayId).toBe('fallback-bay');
    expect(ev.vehiclePresent).toBe(false);
    expect(ev.waterFlow).toBe(0);
    expect(ev.foamLevel).toBe(0);
    expect(ev.machineStatus).toBe('idle');
    expect(typeof ev.timestamp).toBe('string');
  });
});
