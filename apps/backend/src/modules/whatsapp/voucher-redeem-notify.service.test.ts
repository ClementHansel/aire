import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoucherRedeemNotifyService } from './voucher-redeem-notify.service';
import { DomainEventType } from '../events/event.types';

/**
 * Samuel's ask (2026-08-07): "Notifikasi saat penggunaan voucher — jadi selalu
 * ada notifikasi saat voucher digunakan, trus sisa vouchernya brp dengan kode
 * sisanya apa." So: what was used, how many remain, and which codes.
 */
describe('VoucherRedeemNotifyService', () => {
  let pool: { query: ReturnType<typeof vi.fn> };
  let whatsapp: { sendText: ReturnType<typeof vi.fn> };
  let handler: (e: unknown) => Promise<void>;
  let service: VoucherRedeemNotifyService;

  const book = {
    buyer_phone: '0811', buyer_name: 'Budi', expiry_date: null,
    source: 'sale', outlet_id: 'outlet-9',
    template_name: 'Voucher Cuci 10x', benefit_name: null, benefit_type: 'service',
  };
  const remaining = [{ code: 'KCL-082026-000003' }, { code: 'KCL-082026-000004' }];

  const fire = (payload: unknown) =>
    handler({ tenantId: 'tenant-1', outletId: 'outlet-evt', payload });

  beforeEach(() => {
    pool = { query: vi.fn() };
    whatsapp = { sendText: vi.fn().mockResolvedValue(true) };
    const eventBus = {
      on: vi.fn((_t: string, fn: (e: unknown) => Promise<void>) => { handler = fn; return () => {}; }),
    };
    service = new VoucherRedeemNotifyService(pool as any, eventBus as any, whatsapp as any);
    service.onModuleInit();
  });

  /** Order path: affected books → order contact → book summary → remaining codes. */
  const givenOrderRedemption = (used = '2', rest = remaining, b: Record<string, unknown> | null = book) => {
    pool.query.mockResolvedValueOnce({ rows: [{ book_id: 'book-1', used }] });
    pool.query.mockResolvedValueOnce({ rows: [{ customer_phone: '0899', outlet_id: 'outlet-3' }] });
    pool.query.mockResolvedValueOnce({ rows: b ? [b] : [] });
    pool.query.mockResolvedValueOnce({ rows: rest });
  };

  it('reports what was used and lists the remaining codes', async () => {
    givenOrderRedemption();
    await fire({ orderId: 'order-1', orderNumber: 'ORD-9', count: 2, discount: 50000 });

    const [, to, text] = whatsapp.sendText.mock.calls[0];
    expect(to).toBe('0811'); // the book's owner
    expect(text).toContain('Voucher *Voucher Cuci 10x* berhasil digunakan (2 kode) di transaksi ORD-9');
    expect(text).toContain('hemat Rp 50.000');
    expect(text).toContain('Sisa voucher kakak: *2* kode');
    expect(text).toContain('1. KCL-082026-000003');
    expect(text).toContain('2. KCL-082026-000004');
  });

  it('says the book is finished instead of printing an empty list', async () => {
    givenOrderRedemption('1', []);
    await fire({ orderId: 'order-1', orderNumber: 'ORD-9', count: 1, discount: 25000 });

    const text = whatsapp.sendText.mock.calls[0][2];
    expect(text).toContain('sudah terpakai semua');
    expect(text).not.toContain('Sisa voucher kakak');
  });

  it('withholds the remaining CODES from someone who is not the owner', async () => {
    // Book vouchers are shareable, so the redeemer is often not the buyer. With no
    // buyer on file we can only reach the person at the counter — who must not be
    // handed the rest of someone else's codes.
    givenOrderRedemption('1', remaining, { ...book, buyer_phone: null });
    await fire({ orderId: 'order-1', orderNumber: 'ORD-9', count: 1, discount: 25000 });

    const [, to, text] = whatsapp.sendText.mock.calls[0];
    expect(to).toBe('0899'); // fell back to the order's customer
    expect(text).toContain('Sisa voucher: *2* kode.');
    expect(text).not.toContain('KCL-082026-000003');
  });

  it('handles the standalone ticket-redeem payload, which carries no order at all', async () => {
    // This shape used to render "(xundefined) di transaksi undefined".
    pool.query.mockResolvedValueOnce({ rows: [{ book_id: 'book-1' }] }); // ticket → book
    pool.query.mockResolvedValueOnce({ rows: [book] });
    pool.query.mockResolvedValueOnce({ rows: remaining });

    await fire({ ticketId: 'tkt-1', code: 'KCL-082026-000001', orderId: null, source: 'ticket' });

    const text = whatsapp.sendText.mock.calls[0][2];
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('NaN');
    expect(text).toContain('Voucher *Voucher Cuci 10x* berhasil digunakan.');
    expect(text).toContain('Sisa voucher kakak: *2* kode');
  });

  it('messages each book separately when one order burns codes from two', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ book_id: 'book-1', used: '1' }, { book_id: 'book-2', used: '1' }] });
    pool.query.mockResolvedValueOnce({ rows: [{ customer_phone: '0899', outlet_id: 'outlet-3' }] });
    pool.query.mockResolvedValueOnce({ rows: [book] });
    pool.query.mockResolvedValueOnce({ rows: remaining });
    pool.query.mockResolvedValueOnce({ rows: [{ ...book, buyer_phone: '0822', template_name: 'Voucher Wax' }] });
    pool.query.mockResolvedValueOnce({ rows: [] });

    await fire({ orderId: 'order-1', orderNumber: 'ORD-9', count: 2, discount: 60000 });

    expect(whatsapp.sendText).toHaveBeenCalledTimes(2);
    expect(whatsapp.sendText.mock.calls[0][1]).toBe('0811');
    expect(whatsapp.sendText.mock.calls[1][1]).toBe('0822');
    expect(whatsapp.sendText.mock.calls[1][2]).toContain('Voucher Wax');
  });

  it('stays silent when the redemption touched no book (legacy hashed pack only)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await fire({ orderId: 'order-1', orderNumber: 'ORD-9', count: 1, discount: 10000 });
    expect(whatsapp.sendText).not.toHaveBeenCalled();
  });

  it('never lets a failure throw into the event bus', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'));
    await expect(fire({ orderId: 'order-1', orderNumber: 'ORD-9', count: 1, discount: 1 })).resolves.not.toThrow();
  });
});
