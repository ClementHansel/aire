import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JWTPayload } from '@aire/shared';
import { MembershipSellController } from './membership-sell.controller';

/**
 * MembershipSellController.sell — business_unit derivation (AIRIN pack
 * business_unit gap). A membership plan carries no business_unit of its
 * own; the fee order must be tagged from whichever service(s) the plan
 * actually grants (free or member-discounted) instead of taking the orders
 * table's AIRE column default.
 */
describe('MembershipSellController.sell — business_unit', () => {
  let controller: MembershipSellController;
  let planService: { getPlan: ReturnType<typeof vi.fn> };
  let sellService: { sellMembership: ReturnType<typeof vi.fn> };
  let client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
  let checkout: { db: { connect: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn> }; upsertCustomer: ReturnType<typeof vi.fn>; createPackOrder: ReturnType<typeof vi.fn> };

  const user: JWTPayload = { sub: 'op-1', tenant_id: 'tenant-1', outlet_id: 'outlet-1', role: 'cashier', iat: 0, exp: 0 };

  beforeEach(() => {
    client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
    checkout = {
      db: { connect: vi.fn().mockResolvedValue(client), query: vi.fn() },
      upsertCustomer: vi.fn().mockResolvedValue('cust-1'),
      createPackOrder: vi.fn().mockResolvedValue({ id: 'order-1', orderNumber: 'ORD-1', total: 349000 }),
    };
    sellService = { sellMembership: vi.fn().mockResolvedValue({ id: 'membership-1' }) };
    planService = { getPlan: vi.fn() };
    controller = new MembershipSellController(
      planService as any,
      sellService as any,
      checkout as any,
      {} as any,
      {} as any,
    );
  });

  it('derives business_unit from the plan free service', async () => {
    planService.getPlan.mockResolvedValue({
      id: 'plan-1', name: 'Unlimited Wash', price: 349000, maxPlates: 3,
      freeServiceIds: ['svc-1'], discountedServices: [],
    });
    checkout.db.query.mockResolvedValueOnce({ rows: [{ business_unit: 'LEAD', n: '1' }] });

    await controller.sell(user, { planId: 'plan-1', customer: { name: 'Budi', phone: '0812' } });

    expect(checkout.db.query).toHaveBeenCalledWith(expect.stringContaining('FROM services WHERE id = ANY'), [['svc-1']]);
    expect(checkout.createPackOrder).toHaveBeenCalledWith(client, user, expect.objectContaining({ businessUnit: 'LEAD' }));
  });

  it('derives business_unit from a discounted service when there is no free service', async () => {
    planService.getPlan.mockResolvedValue({
      id: 'plan-3', name: 'Member Discount Plan', price: 150000, maxPlates: 3,
      freeServiceIds: null, discountedServices: [{ serviceId: 'svc-2', discountPct: 10 }],
    });
    checkout.db.query.mockResolvedValueOnce({ rows: [{ business_unit: 'AIRE', n: '1' }] });

    await controller.sell(user, { planId: 'plan-3', customer: { name: 'Budi', phone: '0812' } });

    expect(checkout.db.query).toHaveBeenCalledWith(expect.stringContaining('FROM services WHERE id = ANY'), [['svc-2']]);
    expect(checkout.createPackOrder).toHaveBeenCalledWith(client, user, expect.objectContaining({ businessUnit: 'AIRE' }));
  });

  it('falls back to AIRE when the plan has no linked services at all', async () => {
    planService.getPlan.mockResolvedValue({
      id: 'plan-2', name: 'Flat Fee Plan', price: 100000, maxPlates: 3,
      freeServiceIds: null, discountedServices: [],
    });

    await controller.sell(user, { planId: 'plan-2', customer: { name: 'Budi', phone: '0812' } });

    expect(checkout.db.query).not.toHaveBeenCalled();
    expect(checkout.createPackOrder).toHaveBeenCalledWith(client, user, expect.objectContaining({ businessUnit: 'AIRE' }));
  });
});
