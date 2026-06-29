import { describe, it, expect } from 'vitest';
import {
  parseSensorTopic,
  buildCommandTopic,
  buildSensorSubscriptionTopic,
} from './mqtt-client';

describe('parseSensorTopic', () => {
  it('should parse a valid sensor topic', () => {
    const result = parseSensorTopic('aire/tenant-1/outlet-1/bay/bay-1/sensor');
    expect(result).toEqual({
      tenantId: 'tenant-1',
      outletId: 'outlet-1',
      bayId: 'bay-1',
    });
  });

  it('should parse topics with UUID-style IDs', () => {
    const result = parseSensorTopic(
      'aire/550e8400-e29b-41d4-a716-446655440000/660e8400-e29b-41d4-a716-446655440001/bay/770e8400-e29b-41d4-a716-446655440002/sensor',
    );
    expect(result).toEqual({
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
      outletId: '660e8400-e29b-41d4-a716-446655440001',
      bayId: '770e8400-e29b-41d4-a716-446655440002',
    });
  });

  it('should return null for topic with wrong prefix', () => {
    expect(parseSensorTopic('other/tenant-1/outlet-1/bay/bay-1/sensor')).toBeNull();
  });

  it('should return null for topic with wrong segment count (too few)', () => {
    expect(parseSensorTopic('aire/tenant-1/outlet-1/bay/sensor')).toBeNull();
  });

  it('should return null for topic with wrong segment count (too many)', () => {
    expect(
      parseSensorTopic('aire/tenant-1/outlet-1/bay/bay-1/sensor/extra'),
    ).toBeNull();
  });

  it('should return null for topic without "bay" segment', () => {
    expect(
      parseSensorTopic('aire/tenant-1/outlet-1/notbay/bay-1/sensor'),
    ).toBeNull();
  });

  it('should return null for topic without "sensor" suffix', () => {
    expect(
      parseSensorTopic('aire/tenant-1/outlet-1/bay/bay-1/command'),
    ).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(parseSensorTopic('')).toBeNull();
  });

  it('should return null for completely unrelated topic', () => {
    expect(parseSensorTopic('home/bedroom/temperature')).toBeNull();
  });
});

describe('buildCommandTopic', () => {
  it('should build the correct command topic', () => {
    const topic = buildCommandTopic('tenant-1', 'outlet-1', 'bay-1');
    expect(topic).toBe('aire/tenant-1/outlet-1/bay/bay-1/command');
  });

  it('should handle UUID-style IDs', () => {
    const topic = buildCommandTopic(
      '550e8400-e29b-41d4-a716-446655440000',
      '660e8400-e29b-41d4-a716-446655440001',
      '770e8400-e29b-41d4-a716-446655440002',
    );
    expect(topic).toBe(
      'aire/550e8400-e29b-41d4-a716-446655440000/660e8400-e29b-41d4-a716-446655440001/bay/770e8400-e29b-41d4-a716-446655440002/command',
    );
  });
});

describe('buildSensorSubscriptionTopic', () => {
  it('should build wildcard topic when no tenantId provided', () => {
    const topic = buildSensorSubscriptionTopic();
    expect(topic).toBe('aire/+/+/bay/+/sensor');
  });

  it('should build tenant-specific topic with wildcards for outlet and bay', () => {
    const topic = buildSensorSubscriptionTopic('tenant-1');
    expect(topic).toBe('aire/tenant-1/+/bay/+/sensor');
  });
});
