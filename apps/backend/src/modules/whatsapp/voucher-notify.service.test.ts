import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoucherNotifyService } from './voucher-notify.service';
import { DomainEventType } from '../events/event.types';

/**
 * Samuel's ask (2026-08-07): "Notifikasi saat pembelian voucher itu harusnya
 * kirim list dari nomer kode vouchernya — Terimakasih atas pembelian [nama
 * voucher] berikut kode dari voucher yang anda dapat gunakan [kode voucher]".
 * So: the NAME, then every code.
 */
describe('VoucherNotifyService', () => {
  let pool: { query: ReturnType<typeof vi.fn> };
  let whatsapp: { sendText: ReturnType<typeof vi.fn> };
  let handlers: Map<string, (e: unknown) => void>;
  let eventBus: { on: ReturnType<typeof vi.fn> };
  let service: VoucherNotifyService;

  const book = {
    buyer_phone: '0811', buyer_name: 'Budi', expiry_date: '2026-09-06',
    source: 'sale', outlet_id: 'outlet-9',
    template_name: 'Voucher Cuci 10x', benefit_name: 'Cuci Mobil', benefit_type: 'service',
  };
  const codes = [{ code: 'KCL-082026-000001' }, { code: 'KCL-082026-000002' }];

  /** loadBookSummary reads the book, then loadActiveCodes reads the tickets. */
  const given = (b: Record<string, unknown> | null, c = codes) => {
    pool.query.mockResolvedValueOnce({ rows: b ? [b] : [] });
    pool.query.mockResolvedValueOnce({ rows: c });
  };

  const fire = (type: string, payload: unknown) =>
    handlers.get(type)!({ tenantId: 'tenant-1', outletId: 'outlet-evt', payload });

  beforeEach(() => {
    pool = { query: vi.fn() };
    whatsapp = { sendText: vi.fn().mockResolvedValue(true) };
    handlers = new Map();
    eventBus = { on: vi.fn((type: string, fn: (e: unknown) => void) => { handlers.set(type, fn); return () => {}; }) };
    service = new VoucherNotifyService(pool as any, eventBus as any, whatsapp as any);
    service.onModuleInit();
  });

  it('sends the voucher NAME and every code on a purchase', async () => {
    given(book);
    await fire(DomainEventType.VoucherBookSold, { bookId: 'book-1' });

    const [tenantId, to, text, outletId] = whatsapp.sendText.mock.calls[0];
    expect(tenantId).toBe('tenant-1');
    expect(to).toBe('0811');
    expect(text).toContain('Terima kasih atas pembelian *Voucher Cuci 10x*');
    expect(text).toContain('Halo kak Budi!');
    expect(text).toContain('1. KCL-082026-000001');
    expect(text).toContain('2. KCL-082026-000002');
    expect(text).toContain('Berlaku sampai 2026-09-06');
    // The book's own branch wins over the event's, so the message goes out on the
    // line belonging to the branch that sold it.
    expect(outletId).toBe('outlet-9');
  });

  it('also delivers a campaign bonus, worded as a gift rather than a purchase', async () => {
    given({ ...book, source: 'bonus', template_name: 'Bonus 3x Spray Wax' });
    await fire(DomainEventType.CampaignBonusGranted, { bookId: 'book-2' });

    const text = whatsapp.sendText.mock.calls[0][2];
    expect(text).toContain('Selamat, kakak dapat bonus *Bonus 3x Spray Wax*');
    expect(text).not.toContain('pembelian');
  });

  it('falls back to the benefit service name when the book has no template', async () => {
    given({ ...book, template_name: null });
    await fire(DomainEventType.VoucherBookSold, { bookId: 'book-1' });
    expect(whatsapp.sendText.mock.calls[0][2]).toContain('*Cuci Mobil*');
  });

  it('names a discount voucher generically when nothing else is known', async () => {
    given({ ...book, template_name: null, benefit_name: null, benefit_type: 'percentage' });
    await fire(DomainEventType.VoucherBookSold, { bookId: 'book-1' });
    expect(whatsapp.sendText.mock.calls[0][2]).toContain('*Voucher Diskon*');
  });

  it('stays silent for a walk-in buyer with no phone', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...book, buyer_phone: null }] });
    await fire(DomainEventType.VoucherBookSold, { bookId: 'book-1' });
    expect(whatsapp.sendText).not.toHaveBeenCalled();
  });

  it('caps a huge book rather than emitting a wall of codes WhatsApp would truncate', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ code: `KCL-082026-${String(i + 1).padStart(6, '0')}` }));
    given(book, many);
    await fire(DomainEventType.VoucherBookSold, { bookId: 'book-1' });

    const text = whatsapp.sendText.mock.calls[0][2];
    expect(text).toContain('40. KCL-082026-000040');
    expect(text).not.toContain('41. KCL-082026-000041');
    expect(text).toContain('dan 20 kode lainnya');
  });

  it('never lets a failed send throw into the event bus', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'));
    await expect(fire(DomainEventType.VoucherBookSold, { bookId: 'book-1' })).resolves.not.toThrow();
  });
});
