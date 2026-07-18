import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { TenantLifecycleService } from './tenant-lifecycle.service';

function tenantRow(status: string) {
  return {
    id: 'tenant-001', name: 'AIRE Wash', slug: 'aire-wash', plan: 'standard',
    status, settings: {}, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-06-01T00:00:00Z',
  };
}

describe('TenantLifecycleService', () => {
  let service: TenantLifecycleService;
  let mockPool: { query: ReturnType<typeof vi.fn> };
  let mockAuth: { invalidateTenantStatus: ReturnType<typeof vi.fn> };
  let mockEvents: { emit: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = { query: vi.fn() };
    mockAuth = { invalidateTenantStatus: vi.fn() };
    mockEvents = { emit: vi.fn().mockResolvedValue('evt-1') };
    service = new TenantLifecycleService(mockPool as any, mockAuth as any, mockEvents as any);
  });

  it('suspends an active tenant: records history, invalidates cache, emits event', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ status: 'active' }] })   // current status
      .mockResolvedValueOnce({ rows: [tenantRow('suspended')] }) // UPDATE returning
      .mockResolvedValueOnce({ rows: [] });                      // INSERT status event

    const result = await service.suspend('tenant-001', { reason: 'nonpayment', actorUserId: 'admin-1' });

    expect(result.status).toBe('suspended');
    // history row written with from→to + reason + source + actor
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO tenant_status_events'),
      ['tenant-001', 'active', 'suspended', 'nonpayment', 'admin', 'admin-1'],
    );
    expect(mockAuth.invalidateTenantStatus).toHaveBeenCalledWith('tenant-001');
    expect(mockEvents.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tenant.suspended', tenantId: 'tenant-001' }),
    );
  });

  it('is a no-op when the status is unchanged (idempotent) — no history/event', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ status: 'suspended' }] }) // already suspended
      .mockResolvedValueOnce({ rows: [tenantRow('suspended')] }); // UPDATE returning

    await service.suspend('tenant-001', {});

    expect(mockAuth.invalidateTenantStatus).not.toHaveBeenCalled();
    expect(mockEvents.emit).not.toHaveBeenCalled();
    // Only the SELECT + UPDATE ran — no INSERT into the history table.
    const insertCalls = mockPool.query.mock.calls.filter((c) => String(c[0]).includes('tenant_status_events'));
    expect(insertCalls).toHaveLength(0);
  });

  it('throws NotFound for a missing tenant', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    await expect(service.cancel('nope', {})).rejects.toThrow(NotFoundException);
  });
});
