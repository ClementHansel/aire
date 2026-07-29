import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JWTPayload } from '@aire/shared';
import { VoucherPackService } from './voucher-pack.service';
import { DomainEventType } from '../events/event.types';

/**
 * VoucherPackService.sellPack — business_unit derivation (AIRIN pack
 * business_unit gap). A voucher template carries no business_unit of its
 * own; the fee order must be tagged from the template's linked service(s)
 * instead of taking the orders table's AIRE column default.
 */
describe('VoucherPackService.sellPack — business_unit', () => {
  let pool: { connect: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn> };
  let client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
  let checkout: { upsertCustomer: ReturnType<typeof vi.fn>; createPackOrder: ReturnType<typeof vi.fn> };
  let templates: { getTemplate: ReturnType<typeof vi.fn> };
  let notifications: { sendWhatsApp: ReturnType<typeof vi.fn> };
  let eventBus: { emit: ReturnType<typeof vi.fn> };
  let service: VoucherPackService;

  const user: JWTPayload = { sub: 'op-1', tenant_id: 'tenant-1', outlet_id: 'outlet-1', role: 'cashier', iat: 0, exp: 0 };

  beforeEach(() => {
    client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
    pool = { connect: vi.fn().mockResolvedValue(client), query: vi.fn() };
    checkout = {
      upsertCustomer: vi.fn().mockResolvedValue('cust-1'),
      createPackOrder: vi.fn().mockResolvedValue({ id: 'order-1', orderNumber: 'ORD-1', total: 200000 }),
    };
    templates = { getTemplate: vi.fn() };
    notifications = { sendWhatsApp: vi.fn() };
    eventBus = { emit: vi.fn() };
    service = new VoucherPackService(pool as any, checkout as any, templates as any, notifications as any, eventBus as any);
  });

  it('derives business_unit from the template service_ids', async () => {
    templates.getTemplate.mockResolvedValue({
      id: 'tpl-1', name: 'Detailing Pack', is_active: true, sale_price: '200000',
      max_uses: 5, service_ids: ['svc-detailing-1'],
    });
    pool.query.mockResolvedValueOnce({ rows: [{ business_unit: 'LEAD', n: '1' }] });

    await service.sellPack(user, 'tpl-1', { name: 'Budi', phone: '0811' });

    const [, , params] = checkout.createPackOrder.mock.calls[0];
    expect(params).toMatchObject({ businessUnit: 'LEAD' });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM services WHERE id = ANY'), [['svc-detailing-1']]);
  });

  it('falls back to AIRE when the template has no service_ids (fixed/percentage voucher)', async () => {
    templates.getTemplate.mockResolvedValue({
      id: 'tpl-2', name: 'Rp 50k off', is_active: true, sale_price: '50000',
      max_uses: 1, service_ids: null,
    });

    await service.sellPack(user, 'tpl-2', { name: 'Budi', phone: '0811' });

    const [, , params] = checkout.createPackOrder.mock.calls[0];
    expect(params).toMatchObject({ businessUnit: 'AIRE' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('still emits VoucherPackSold and commits regardless of business_unit', async () => {
    templates.getTemplate.mockResolvedValue({
      id: 'tpl-1', name: 'Detailing Pack', is_active: true, sale_price: '200000',
      max_uses: 5, service_ids: ['svc-1'],
    });
    pool.query.mockResolvedValueOnce({ rows: [{ business_unit: 'AIRE', n: '1' }] });

    await service.sellPack(user, 'tpl-1', { name: 'Budi', phone: '0811' });

    expect(client.query).toHaveBeenCalledWith('COMMIT');
    const emitted = eventBus.emit.mock.calls.map((c: unknown[]) => (c[0] as { type: string }).type);
    expect(emitted).toContain(DomainEventType.VoucherPackSold);
  });
});
