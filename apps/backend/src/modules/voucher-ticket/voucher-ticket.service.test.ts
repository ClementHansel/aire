import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { JWTPayload } from '@aire/shared';
import { VoucherTicketService } from './voucher-ticket.service';
import { DomainEventType } from '../events/event.types';

/**
 * sellBook must route the cash through a real, immediately-PAID order so revenue
 * books via the OrderPaid → accounting path — while still returning the generated
 * codes in the same call (the POS delivers them to the buyer at sell time).
 */
describe('VoucherTicketService.sellBook', () => {
  let client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
  let pool: { connect: ReturnType<typeof vi.fn> };
  let checkout: { upsertCustomer: ReturnType<typeof vi.fn>; createPackOrder: ReturnType<typeof vi.fn> };
  let eventBus: { emit: ReturnType<typeof vi.fn> };
  let service: VoucherTicketService;

  const user: JWTPayload = {
    sub: 'op-1',
    tenant_id: 'tenant-1',
    outlet_id: 'outlet-1',
    role: 'cashier',
    iat: 0,
    exp: 0,
  };

  beforeEach(() => {
    client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.includes('FROM outlets')) return { rows: [{ code: 'BTR' }] };
        if (sql.includes('voucher_counters')) return { rows: [{ last_number: 3 }] };
        if (sql.includes('INSERT INTO voucher_books')) return { rows: [{ id: 'book-1' }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    pool = { connect: vi.fn().mockResolvedValue(client) };
    checkout = {
      upsertCustomer: vi.fn().mockResolvedValue('cust-1'),
      createPackOrder: vi.fn().mockResolvedValue({ id: 'order-1', orderNumber: 'ORD-1', total: 300 }),
    };
    eventBus = { emit: vi.fn() };
    service = new VoucherTicketService(pool as any, checkout as any, eventBus as any);
  });

  it('creates a PAID order for the cash total and books it via OrderPaid', async () => {
    const res = await service.sellBook(user, {
      outletId: 'outlet-1',
      buyerName: 'Bob',
      buyerPhone: '0811',
      quantity: 3,
      unitPrice: 100,
    });

    // Codes returned at sell time (contract with the POS/WhatsApp delivery).
    expect(res.bookId).toBe('book-1');
    expect(res.codes).toHaveLength(3);
    for (const c of res.codes) expect(c).toMatch(/^BTR-\d{6}-\d{6}$/);

    // Buyer upserted as a customer.
    expect(checkout.upsertCustomer).toHaveBeenCalledWith(client, 'tenant-1', 'Bob', '0811');

    // Order created PAID for unitPrice*qty, tagged as a voucher-book sale.
    expect(checkout.createPackOrder).toHaveBeenCalledTimes(1);
    const [, orderUser, params] = checkout.createPackOrder.mock.calls[0];
    expect(orderUser.outlet_id).toBe('outlet-1');
    expect(params).toMatchObject({
      customerId: 'cust-1',
      customerName: 'Bob',
      total: 300,
      note: 'Voucher Book: 3 tickets',
      paidNow: true,
      paymentMethod: 'cash',
    });

    // Book row linked to the order.
    const bookInsert = client.query.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes('INSERT INTO voucher_books'),
    );
    expect(bookInsert?.[1]).toContain('order-1');

    // Revenue books through OrderPaid (post-commit), plus VoucherBookSold.
    const emitted = eventBus.emit.mock.calls.map((c: unknown[]) => c[0] as { type: string; payload: any });
    const orderPaid = emitted.find((e) => e.type === DomainEventType.OrderPaid);
    expect(orderPaid).toBeDefined();
    expect(orderPaid!.payload).toMatchObject({ orderId: 'order-1', total: 300, paymentMethod: 'cash' });
    const bookSold = emitted.find((e) => e.type === DomainEventType.VoucherBookSold);
    expect(bookSold!.payload).toMatchObject({ bookId: 'book-1', orderId: 'order-1', total: 300 });

    // Transaction committed, no rollback.
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.query).not.toHaveBeenCalledWith('ROLLBACK');
  });

  it('handles a walk-in (no phone): creates the order with no customer', async () => {
    await service.sellBook(user, { outletId: 'outlet-1', quantity: 2, unitPrice: 50 });

    expect(checkout.upsertCustomer).not.toHaveBeenCalled();
    const [, , params] = checkout.createPackOrder.mock.calls[0];
    expect(params).toMatchObject({ customerId: null, customerName: 'Walk-in', customerPhone: '', total: 100, paidNow: true });
  });

  it('does not emit OrderPaid for a zero-value book but still records the sale', async () => {
    checkout.createPackOrder.mockResolvedValue({ id: 'order-2', orderNumber: 'ORD-2', total: 0 });
    await service.sellBook(user, { outletId: 'outlet-1', quantity: 1, unitPrice: 0 });

    const emitted = eventBus.emit.mock.calls.map((c: unknown[]) => c[0] as { type: string });
    expect(emitted.some((e) => e.type === DomainEventType.OrderPaid)).toBe(false);
    expect(emitted.some((e) => e.type === DomainEventType.VoucherBookSold)).toBe(true);
    expect(checkout.createPackOrder).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid quantity before touching the order flow', async () => {
    await expect(service.sellBook(user, { outletId: 'outlet-1', quantity: 0 })).rejects.toThrow();
    expect(checkout.createPackOrder).not.toHaveBeenCalled();
  });

  // AIRIN pack business_unit gap: a ticket book with a service-typed benefit
  // should tag the fee order with THAT service's business_unit, not silently
  // default to AIRE via the orders table's column default.
  it('derives business_unit from the benefit service when benefitType is "service"', async () => {
    client.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FROM outlets')) return { rows: [{ code: 'BTR' }] };
      if (sql.includes('voucher_counters')) return { rows: [{ last_number: 3 }] };
      if (sql.includes('INSERT INTO voucher_books')) return { rows: [{ id: 'book-1' }] };
      if (sql.includes('FROM services')) return { rows: [{ business_unit: 'LEAD', n: '1' }] };
      return { rows: [] };
    });

    await service.sellBook(user, {
      outletId: 'outlet-1', quantity: 1, unitPrice: 100,
      benefitType: 'service', benefitServiceId: 'service-detailing-1',
    });

    const [, , params] = checkout.createPackOrder.mock.calls[0];
    expect(params).toMatchObject({ businessUnit: 'LEAD' });
    const serviceLookup = client.query.mock.calls.find((c: unknown[]) => String(c[0]).includes('FROM services'));
    expect(serviceLookup?.[1]).toEqual([['service-detailing-1']]);
  });

  it('falls back to AIRE when the benefit is not service-typed (no service to derive from)', async () => {
    await service.sellBook(user, {
      outletId: 'outlet-1', quantity: 1, unitPrice: 100,
      benefitType: 'fixed', benefitValue: 10000,
    });

    const [, , params] = checkout.createPackOrder.mock.calls[0];
    expect(params).toMatchObject({ businessUnit: 'AIRE' });
    expect(client.query.mock.calls.some((c: unknown[]) => String(c[0]).includes('FROM services'))).toBe(false);
  });
});

/**
 * issueBonusBook — the FREE-grant counterpart to sellBook, used by
 * CampaignGrantService (AIRIN-138/AIRIN-102). No order is created; the
 * caller supplies its own transaction client so the book/tickets insert
 * commits atomically with the caller's own campaign_grants row.
 */
describe('VoucherTicketService.issueBonusBook', () => {
  let client: { query: ReturnType<typeof vi.fn> };
  let service: VoucherTicketService;

  beforeEach(() => {
    client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('FROM outlets')) return { rows: [{ code: 'BTR' }] };
        if (sql.includes('voucher_counters')) return { rows: [{ last_number: 3 }] };
        if (sql.includes('INSERT INTO voucher_books')) return { rows: [{ id: 'book-bonus-1' }] };
        return { rows: [] };
      }),
    };
    service = new VoucherTicketService({} as any, {} as any, undefined);
  });

  it('inserts a free book (unit_price 0) with the given benefit + plaintext codes, without opening its own transaction', async () => {
    const res = await service.issueBonusBook(client as any, 'tenant-1', {
      outletId: 'outlet-1',
      quantity: 3,
      benefitType: 'service',
      benefitServiceId: 'service-spray-wax',
      expiryDate: '2026-12-31',
      buyerName: 'Budi',
      buyerPhone: '0811',
      orderId: 'order-1',
    });

    expect(res.bookId).toBe('book-bonus-1');
    expect(res.codes).toHaveLength(3);
    for (const c of res.codes) expect(c).toMatch(/^BTR-\d{6}-\d{6}$/);

    // No BEGIN/COMMIT/ROLLBACK — the caller (CampaignGrantService) owns the transaction.
    expect(client.query).not.toHaveBeenCalledWith('BEGIN');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');

    const bookInsert = client.query.mock.calls.find((c: unknown[]) => String(c[0]).includes('INSERT INTO voucher_books'));
    // Trailing template_id + source (migration 090): a caller that names no
    // template gets NULL, and the default source is 'bonus' — the campaign-grant
    // caller this method was written for.
    expect(bookInsert?.[1]).toEqual([
      'tenant-1', 'outlet-1', 'Budi', '0811', 3,
      'service', 'service-spray-wax', 0,
      '2026-12-31', 'order-1',
      null, 'bonus',
    ]);

    const ticketInserts = client.query.mock.calls.filter((c: unknown[]) => String(c[0]).includes('INSERT INTO voucher_tickets'));
    expect(ticketInserts).toHaveLength(3);
  });

  it('rejects a non-positive quantity', async () => {
    await expect(
      service.issueBonusBook(client as any, 'tenant-1', { outletId: 'outlet-1', quantity: 0, benefitType: 'service' }),
    ).rejects.toThrow();
  });

  it('throws NotFoundException when the outlet does not belong to the tenant', async () => {
    client.query.mockImplementation((sql: string) => (sql.includes('FROM outlets') ? { rows: [] } : { rows: [] }));

    await expect(
      service.issueBonusBook(client as any, 'tenant-1', { outletId: 'bad-outlet', quantity: 1, benefitType: 'fixed', benefitValue: 5000 }),
    ).rejects.toThrow();
  });
});

/**
 * listBooks — the dashboard's "Voucher-pack purchases" section (AIRIN-133).
 * Optional dateFrom/dateTo/outletIds filter server-side now; omitted means
 * the full tenant list (unchanged default for any existing caller).
 */
describe('VoucherTicketService.listBooks', () => {
  let pool: { query: ReturnType<typeof vi.fn> };
  let service: VoucherTicketService;

  beforeEach(() => {
    pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    service = new VoucherTicketService(pool as any, {} as any, undefined);
  });

  it('queries with no filter clauses and no extra params when no filters are given', async () => {
    await service.listBooks('tenant-1');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).not.toContain('b.outlet_id = ANY');
    expect(sql).not.toContain('b.created_at >=');
    expect(params).toEqual(['tenant-1']);
  });

  it('adds outlet_id/date filter clauses (and their params) only when provided', async () => {
    await service.listBooks('tenant-1', { dateFrom: '2026-07-01', dateTo: '2026-07-31', outletIds: ['outlet-1', 'outlet-2'] });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('b.outlet_id = ANY($2::uuid[])');
    expect(sql).toContain('b.created_at >= $3::timestamptz');
    expect(sql).toContain("b.created_at < ($4::date + INTERVAL '1 day')");
    expect(params).toEqual(['tenant-1', ['outlet-1', 'outlet-2'], '2026-07-01', '2026-07-31']);
  });

  it('exposes outletId (not just outletName) on each row', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'book-1', buyer_name: 'Budi', buyer_phone: '0811', quantity: 5,
        benefit_type: 'service', unit_price: '10000', outlet_id: 'outlet-1', outlet_name: 'Bintaro',
        redeemed: 2, created_at: new Date('2026-07-15T00:00:00Z'),
      }],
    });
    const rows = await service.listBooks('tenant-1');
    expect(rows[0]).toMatchObject({ id: 'book-1', outletId: 'outlet-1', outletName: 'Bintaro' });
  });

  it('an empty outletIds array (ScopeService: no branches) still restricts, not unrestricts', async () => {
    await service.listBooks('tenant-1', { outletIds: [] });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('b.outlet_id = ANY($2::uuid[])');
    expect(params).toEqual(['tenant-1', []]);
  });
});
