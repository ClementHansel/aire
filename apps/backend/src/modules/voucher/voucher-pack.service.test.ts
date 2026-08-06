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
  let tickets: { issueBonusBook: ReturnType<typeof vi.fn> };
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
    tickets = { issueBonusBook: vi.fn().mockResolvedValue({ bookId: 'book-1', codes: ['KCL-082026-000001'] }) };
    eventBus = { emit: vi.fn() };
    service = new VoucherPackService(
      pool as any, checkout as any, templates as any, notifications as any, tickets as any, eventBus as any,
    );
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

/**
 * issuePack — the pack must be issued as a voucher BOOK of plaintext tickets.
 *
 * AIRIN-145: it used to write voucher_packs + voucher_codes holding only SHA-256
 * hashes, which no dashboard could ever render, so a bought pack was invisible in
 * Issued Vouchers (while a campaign bonus, moved onto books in migration 086,
 * showed up fine). These tests pin the model down so it cannot silently regress
 * to hashes.
 */
describe('VoucherPackService.issuePack — issues a visible book, not hashes', () => {
  let pool: { connect: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn> };
  let client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
  let checkout: { upsertCustomer: ReturnType<typeof vi.fn>; createPackOrder: ReturnType<typeof vi.fn> };
  let templates: { getTemplate: ReturnType<typeof vi.fn> };
  let notifications: { sendWhatsApp: ReturnType<typeof vi.fn> };
  let tickets: { issueBonusBook: ReturnType<typeof vi.fn> };
  let eventBus: { emit: ReturnType<typeof vi.fn> };
  let service: VoucherPackService;

  const user: JWTPayload = { sub: 'op-1', tenant_id: 'tenant-1', outlet_id: 'outlet-1', role: 'cashier', iat: 0, exp: 0 };
  const paidOrder = {
    id: 'order-1', status: 'paid', customer_id: 'cust-1',
    customer_name: 'Budi', customer_phone: '0811', outlet_id: 'outlet-9',
  };

  /** Stubs the two reads issuePack does before minting: the order, then the dedupe probe. */
  const givenPaidOrderNotYetIssued = () => {
    pool.query.mockResolvedValueOnce({ rows: [paidOrder] });   // order lookup
    pool.query.mockResolvedValueOnce({ rows: [] });            // no existing 'sale' book
  };

  beforeEach(() => {
    client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
    pool = { connect: vi.fn().mockResolvedValue(client), query: vi.fn().mockResolvedValue({ rows: [] }) };
    checkout = { upsertCustomer: vi.fn(), createPackOrder: vi.fn() };
    templates = {
      getTemplate: vi.fn().mockResolvedValue({
        id: 'tpl-1', name: 'Voucher Cuci 10x', is_active: true, sale_price: '300000',
        max_uses: 10, type: 'service_pack', value: '0',
        service_ids: ['svc-wash'], validity_days: 30, expiry_date: null,
      }),
    };
    notifications = { sendWhatsApp: vi.fn().mockResolvedValue({ success: true }) };
    tickets = {
      issueBonusBook: vi.fn().mockResolvedValue({
        bookId: 'book-1',
        codes: ['KCL-082026-000001', 'KCL-082026-000002'],
      }),
    };
    eventBus = { emit: vi.fn() };
    service = new VoucherPackService(
      pool as any, checkout as any, templates as any, notifications as any, tickets as any, eventBus as any,
    );
  });

  it('mints a book tagged source=sale against the paid order, never a hashed pack', async () => {
    givenPaidOrderNotYetIssued();

    const res = await service.issuePack(user, 'order-1', 'tpl-1');

    expect(tickets.issueBonusBook).toHaveBeenCalledWith(client, 'tenant-1', expect.objectContaining({
      // The SELLING branch off the order, not the operator's home outlet — that is
      // what gives the codes their branch prefix (first half of AIRIN-145).
      outletId: 'outlet-9',
      quantity: 10,
      benefitType: 'service',
      benefitServiceId: 'svc-wash',
      orderId: 'order-1',
      templateId: 'tpl-1',
      source: 'sale',
    }));
    // Nothing may still be writing the invisible hashed model.
    const written = client.query.mock.calls.map((c: unknown[]) => String(c[0])).join(' ');
    expect(written).not.toContain('INSERT INTO voucher_packs');
    expect(written).not.toContain('INSERT INTO voucher_codes');

    expect(res.packId).toBe('book-1');
    expect(res.childCodes).toEqual(['KCL-082026-000001', 'KCL-082026-000002']);
    expect(res.parentCode).toBeNull();
  });

  it('WhatsApps the plaintext codes and announces VoucherPackIssued', async () => {
    givenPaidOrderNotYetIssued();

    await service.issuePack(user, 'order-1', 'tpl-1');

    expect(notifications.sendWhatsApp).toHaveBeenCalledWith(expect.objectContaining({
      to: '0811',
      params: expect.objectContaining({ codes: 'KCL-082026-000001, KCL-082026-000002' }),
    }));
    // AIRIN-102 hangs a campaign bonus off this event — it must survive the move.
    const emitted = eventBus.emit.mock.calls.map((c: unknown[]) => (c[0] as { type: string }).type);
    expect(emitted).toContain(DomainEventType.VoucherPackIssued);
  });

  it('is idempotent per order: refuses a second issue for the same sale', async () => {
    pool.query.mockResolvedValueOnce({ rows: [paidOrder] });
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'book-existing' }] });

    await expect(service.issuePack(user, 'order-1', 'tpl-1')).rejects.toThrow(/already issued/i);
    expect(tickets.issueBonusBook).not.toHaveBeenCalled();
  });

  it("scopes the dedupe probe to source='sale' so a campaign bonus on the same order does not block issuing", async () => {
    givenPaidOrderNotYetIssued();

    await service.issuePack(user, 'order-1', 'tpl-1');

    const probe = pool.query.mock.calls.find((c: unknown[]) => String(c[0]).includes('FROM voucher_books'));
    expect(String(probe?.[0])).toContain("source = 'sale'");
  });

  it('refuses to issue for an unpaid order', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...paidOrder, status: 'ordered' }] });

    await expect(service.issuePack(user, 'order-1', 'tpl-1')).rejects.toThrow(/payment/i);
    expect(tickets.issueBonusBook).not.toHaveBeenCalled();
  });

  it('refuses an order with no branch, since a book must be attributed to one', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...paidOrder, outlet_id: null }] });
    pool.query.mockResolvedValueOnce({ rows: [] });

    await expect(service.issuePack(user, 'order-1', 'tpl-1')).rejects.toThrow(/branch/i);
    expect(tickets.issueBonusBook).not.toHaveBeenCalled();
  });
});
