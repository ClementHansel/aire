import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { BridgeService } from './bridge.service';

/** Raw `branch_bridges` row as pg returns it. */
function bridgeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bridge-1',
    tenant_id: 'tenant-1',
    outlet_id: 'outlet-1',
    name: 'Main branch',
    status: 'offline',
    agent_version: null,
    last_seen_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeService(query = vi.fn()) {
  const pool = { query } as never;
  return { service: new BridgeService(pool), query };
}

describe('BridgeService - createBridge', () => {
  let query: ReturnType<typeof vi.fn>;
  let service: BridgeService;

  beforeEach(() => {
    query = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('FROM outlets')) return Promise.resolve({ rows: [{ '?column?': 1 }] });
      if (sql.includes('SELECT 1 FROM branch_bridges')) return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO branch_bridges')) return Promise.resolve({ rows: [bridgeRow()] });
      return Promise.resolve({ rows: [] });
    });
    ({ service } = makeService(query));
  });

  it('generates a 48-hex-char pairing token', async () => {
    const { pairingToken } = await service.createBridge('tenant-1', 'outlet-1', 'Main branch');
    expect(pairingToken).toMatch(/^[0-9a-f]{48}$/);
  });

  it('generates a unique token per creation', async () => {
    const a = await service.createBridge('tenant-1', 'outlet-1');
    const b = await service.createBridge('tenant-1', 'outlet-1');
    expect(a.pairingToken).not.toBe(b.pairingToken);
  });

  it('passes the generated token to the INSERT', async () => {
    const { pairingToken } = await service.createBridge('tenant-1', 'outlet-1');
    const insertCall = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO branch_bridges'));
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toContain(pairingToken);
  });

  it('does not expose the token on the returned bridge DTO', async () => {
    const { bridge } = await service.createBridge('tenant-1', 'outlet-1');
    expect(bridge).not.toHaveProperty('pairingToken');
    expect(bridge).not.toHaveProperty('pairing_token');
    expect(bridge.id).toBe('bridge-1');
  });

  it('requires an outletId', async () => {
    await expect(service.createBridge('tenant-1', '')).rejects.toThrow(BadRequestException);
  });

  it('rejects an outlet that does not belong to the tenant', async () => {
    query.mockImplementation((sql: string) =>
      sql.includes('FROM outlets') ? Promise.resolve({ rows: [] }) : Promise.resolve({ rows: [] }),
    );
    await expect(service.createBridge('tenant-1', 'outlet-x')).rejects.toThrow(BadRequestException);
  });

  it('rejects a duplicate bridge for the same outlet', async () => {
    query.mockImplementation((sql: string) => {
      if (sql.includes('FROM outlets')) return Promise.resolve({ rows: [{ x: 1 }] });
      if (sql.includes('SELECT 1 FROM branch_bridges')) return Promise.resolve({ rows: [{ x: 1 }] });
      return Promise.resolve({ rows: [] });
    });
    await expect(service.createBridge('tenant-1', 'outlet-1')).rejects.toThrow(ConflictException);
  });
});

describe('BridgeService - resolveByToken', () => {
  it('resolves a known token to its bridge context', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ id: 'bridge-1', tenant_id: 'tenant-1', outlet_id: 'outlet-1' }],
    });
    const { service } = makeService(query);
    const resolved = await service.resolveByToken('abc');
    expect(resolved).toEqual({ bridgeId: 'bridge-1', tenantId: 'tenant-1', outletId: 'outlet-1' });
  });

  it('returns null for an empty token without hitting the DB', async () => {
    const query = vi.fn();
    const { service } = makeService(query);
    expect(await service.resolveByToken('')).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it('returns null for an unknown token', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const { service } = makeService(query);
    expect(await service.resolveByToken('nope')).toBeNull();
  });
});

describe('BridgeService - rotateToken / deleteBridge', () => {
  it('rotates to a fresh 48-hex token', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [bridgeRow({ status: 'offline' })] });
    const { service } = makeService(query);
    const { pairingToken } = await service.rotateToken('tenant-1', 'bridge-1');
    expect(pairingToken).toMatch(/^[0-9a-f]{48}$/);
  });

  it('throws NotFound when rotating a missing bridge', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const { service } = makeService(query);
    await expect(service.rotateToken('tenant-1', 'missing')).rejects.toThrow(NotFoundException);
  });

  it('throws NotFound when deleting a missing bridge', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0 });
    const { service } = makeService(query);
    await expect(service.deleteBridge('tenant-1', 'missing')).rejects.toThrow(NotFoundException);
  });

  it('deletes an existing bridge', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const { service } = makeService(query);
    await expect(service.deleteBridge('tenant-1', 'bridge-1')).resolves.toBeUndefined();
  });
});
