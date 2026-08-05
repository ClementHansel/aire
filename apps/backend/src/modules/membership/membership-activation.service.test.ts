import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MembershipStatus } from '@aire/shared';
import { MembershipActivationService } from './membership-activation.service';
import { DomainEventType } from '../events/event.types';

describe('MembershipActivationService', () => {
  let service: MembershipActivationService;
  let mockPool: { query: ReturnType<typeof vi.fn> };
  let sell: { activateMembership: ReturnType<typeof vi.fn> };

  const tenantId = 'tenant-001';
  const orderId = 'order-001';
  const membershipId = 'membership-001';

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = { query: vi.fn() };
    sell = { activateMembership: vi.fn().mockResolvedValue({ id: membershipId }) };
    service = new MembershipActivationService(mockPool as any, sell as any);
  });

  it('subscribes to OrderPaid', () => {
    const on = vi.fn().mockReturnValue(() => {});
    const withBus = new MembershipActivationService(mockPool as any, sell as any, { on } as any);

    withBus.onModuleInit();

    expect(on).toHaveBeenCalledTimes(1);
    expect(on.mock.calls[0]![0]).toBe(DomainEventType.OrderPaid);
  });

  it('activates the pending membership sold on the paid order, carrying its vehicle', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: membershipId,
        license_plate: 'B 1234 ABC',
        plate_normalized: 'B1234ABC',
        vehicle_brand: 'Toyota',
        vehicle_model: 'Avanza',
      }],
    });

    const activated = await service.onOrderPaid(tenantId, orderId);

    expect(activated).toBe(true);
    expect(sell.activateMembership).toHaveBeenCalledWith(
      membershipId,
      { plates: [{ plate: 'B1234ABC', brand: 'Toyota', model: 'Avanza' }] },
      tenantId,
    );
  });

  it('only looks at PENDING memberships, so a duplicate OrderPaid cannot restart a term', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const activated = await service.onOrderPaid(tenantId, orderId);

    expect(activated).toBe(false);
    expect(sell.activateMembership).not.toHaveBeenCalled();
    const [sql, params] = mockPool.query.mock.calls[0]!;
    expect(String(sql)).toContain('m.status = $3');
    expect(params).toEqual([orderId, tenantId, MembershipStatus.Pending]);
  });

  it('is a no-op for an ordinary order with no membership sold', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    expect(await service.onOrderPaid(tenantId, 'plain-order')).toBe(false);
    expect(sell.activateMembership).not.toHaveBeenCalled();
  });

  it('activates with no plates when the order carries no vehicle', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: membershipId,
        license_plate: null,
        plate_normalized: null,
        vehicle_brand: null,
        vehicle_model: null,
      }],
    });

    await service.onOrderPaid(tenantId, orderId);

    expect(sell.activateMembership).toHaveBeenCalledWith(membershipId, { plates: [] }, tenantId);
  });

  it('scopes the lookup to the event tenant', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await service.onOrderPaid(tenantId, orderId);

    const [sql] = mockPool.query.mock.calls[0]!;
    expect(String(sql)).toContain('m.tenant_id = $2');
  });
});
