import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JWTPayload } from '@aire/shared';
import { PosCheckoutService, resolveServiceBusinessUnit } from './pos-checkout.service';

/**
 * resolveServiceBusinessUnit — shared helper so membership/voucher-pack/
 * voucher-ticket sales tag their fee order with the RIGHT business unit
 * instead of the orders table's AIRE column default (the pack-order
 * business_unit gap this fixes).
 */
describe('resolveServiceBusinessUnit', () => {
  let db: { query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    db = { query: vi.fn() };
  });

  it('returns AIRE without querying when no service ids are given', async () => {
    const result = await resolveServiceBusinessUnit(db as any, []);
    expect(result).toBe('AIRE');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('returns AIRE without querying when every id is null/undefined', async () => {
    const result = await resolveServiceBusinessUnit(db as any, [null, undefined]);
    expect(result).toBe('AIRE');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('looks up and returns the linked service business_unit', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ business_unit: 'LEAD', n: '1' }] });
    const result = await resolveServiceBusinessUnit(db as any, ['svc-1']);
    expect(result).toBe('LEAD');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('FROM services WHERE id = ANY');
    expect(params).toEqual([['svc-1']]);
  });

  it('de-dupes ids and drops nulls before querying', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ business_unit: 'AIRE', n: '1' }] });
    await resolveServiceBusinessUnit(db as any, ['svc-1', 'svc-1', null, 'svc-2']);
    const [, params] = db.query.mock.calls[0];
    expect(params).toEqual([['svc-1', 'svc-2']]);
  });

  it('falls back to AIRE if the query somehow returns no rows', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await resolveServiceBusinessUnit(db as any, ['svc-missing']);
    expect(result).toBe('AIRE');
  });
});

describe('PosCheckoutService.createPackOrder — business_unit', () => {
  let service: PosCheckoutService;
  let client: { query: ReturnType<typeof vi.fn> };
  const user: JWTPayload = { sub: 'op-1', tenant_id: 'tenant-1', outlet_id: 'outlet-1', role: 'cashier', iat: 0, exp: 0 };

  beforeEach(() => {
    client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('COUNT(*) AS count FROM orders')) return { rows: [{ count: '0' }] };
        if (sql.includes('INSERT INTO orders')) {
          return { rows: [{ id: 'order-1', order_number: 'ORD-1', total: '100000', license_plate: null, vehicle_brand: null, vehicle_model: null }] };
        }
        return { rows: [] };
      }),
    };
    service = new PosCheckoutService({} as any, undefined);
  });

  it('writes the caller-supplied businessUnit onto the order', async () => {
    await service.createPackOrder(client as any, user, {
      customerId: 'cust-1', customerName: 'Budi', customerPhone: '0811',
      total: 100000, note: 'Voucher Pack: Test', businessUnit: 'LEAD' as any,
    });

    const insertCall = client.query.mock.calls.find((c: unknown[]) => String(c[0]).includes('INSERT INTO orders'));
    expect(insertCall![0]).toContain('business_unit');
    expect(insertCall![1]).toContain('LEAD');
  });

  it('defaults to AIRE, explicitly, when the caller omits businessUnit', async () => {
    await service.createPackOrder(client as any, user, {
      customerId: 'cust-1', customerName: 'Budi', customerPhone: '0811',
      total: 100000, note: 'Membership: Test',
    });

    const insertCall = client.query.mock.calls.find((c: unknown[]) => String(c[0]).includes('INSERT INTO orders'));
    expect(insertCall![1]).toContain('AIRE');
  });
});
