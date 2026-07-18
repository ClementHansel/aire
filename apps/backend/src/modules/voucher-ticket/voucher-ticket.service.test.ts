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
    service = new VoucherTicketService(pool as any, checkout as any, undefined, eventBus as any);
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
});
