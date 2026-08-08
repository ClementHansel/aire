import { Injectable, Inject, Optional, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';
import { WhatsappService } from './whatsapp.service';
import { loadBookSummary, loadActiveCodes, formatCodeList } from './voucher-book.query';
import { NotificationRendererService, renderNotification } from '../notification/notification-renderer.service';

const fmtRp = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

/**
 * The two shapes VoucherRedeemed is emitted with. The POS checkout path
 * (order.service) knows the order and the money saved; the standalone
 * redeem endpoint (voucher-ticket.service) knows only the ticket. Reading
 * either as the other printed "(xundefined) di transaksi undefined".
 */
interface RedeemPayload {
  orderId?: string | null;
  orderNumber?: string;
  count?: number;
  discount?: number;
  ticketId?: string;
  code?: string;
  source?: string;
}

/**
 * VoucherRedeemNotifyService — tells the voucher's OWNER that one of their codes
 * was just used, and what they have left.
 *
 * Recipient: the book's buyer, not the person at the counter. Book vouchers are
 * shareable — whoever holds the code can redeem it — so the redeemer is often
 * not the owner. Messaging the owner is both the useful signal ("your balance
 * went down") and the safe one: the remaining CODES are the owner's property and
 * must not be listed to a third party who merely used one. When the book has no
 * buyer on file we fall back to the order's customer and send the count only,
 * since ownership can't be established.
 */
@Injectable()
export class VoucherRedeemNotifyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VoucherRedeemNotifyService.name);
  private unsubscribes: Array<() => void> = [];

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() private readonly eventBus?: EventBusService,
    @Optional() private readonly whatsapp?: WhatsappService,
    @Optional() @Inject(NotificationRendererService) private readonly renderer?: NotificationRendererService,
  ) {}

  onModuleInit(): void {
    if (this.eventBus) {
      this.unsubscribes.push(
        this.eventBus.on(DomainEventType.VoucherRedeemed, (e) =>
          this.safe(() => this.onVoucherRedeemed(e.tenantId!, e.outletId ?? null, e.payload as RedeemPayload))),
      );
      this.logger.log('Voucher-redeem notification subscribed (voucher.redeemed)');
    }
  }

  onModuleDestroy(): void {
    this.unsubscribes.forEach((u) => u());
    this.unsubscribes = [];
  }

  private async safe(fn: () => Promise<unknown>): Promise<void> {
    try { await fn(); } catch (e) { this.logger.error(`Voucher-redeem notification failed: ${e instanceof Error ? e.message : e}`); }
  }

  private async onVoucherRedeemed(tenantId: string, eventOutletId: string | null, payload: RedeemPayload): Promise<void> {
    if (!this.whatsapp) return;

    // Which books did this redemption touch? One order can burn codes from more
    // than one book, and each book has its own owner and its own balance — so
    // each gets its own message rather than one merged, ambiguous total.
    const books = await this.affectedBooks(tenantId, payload);
    if (books.length === 0) return;

    const order = payload.orderId ? await this.orderContact(tenantId, payload.orderId) : null;

    for (const { bookId, usedHere } of books) {
      const book = await loadBookSummary(this.pool, tenantId, bookId);
      if (!book) continue;

      // Owner gets the codes; anyone else gets the count only.
      const toOwner = !!book.buyerPhone;
      const phone = book.buyerPhone ?? order?.phone ?? null;
      if (!phone) continue;

      const remaining = await loadActiveCodes(this.pool, tenantId, bookId);

      // "(2 kode) di transaksi ORD-1042, hemat Rp100.000" — assembled here because
      // each clause is conditional; the owner edits where it sits in the sentence,
      // not which parts appear.
      const usedDetail = [
        usedHere > 1 ? ` (${usedHere} kode)` : '',
        payload.orderNumber ? ` di transaksi ${payload.orderNumber}` : '',
        payload.discount ? `, hemat ${fmtRp(Number(payload.discount))}` : '',
      ].join('');

      const text = await renderNotification(
        this.renderer,
        tenantId,
        // Three cases, three editable texts: nothing left, the owner (who gets
        // their codes listed), and a third party who redeemed a shared code and
        // must NOT be handed the rest of someone else's codes.
        remaining.length === 0 ? 'voucher_used_last' : toOwner ? 'voucher_used' : 'voucher_used_shared',
        {
          customerName: book.buyerName?.trim() ?? '',
          voucherName: book.name,
          usedDetail,
          remainingCount: remaining.length,
          remainingCodes: toOwner ? formatCodeList(remaining) : '',
        },
      );
      if (!text) continue;

      await this.whatsapp.sendText(tenantId, phone, text, book.outletId ?? order?.outletId ?? eventOutletId ?? null);
    }
  }

  /** The books this redemption drew from, with how many codes it took from each. */
  private async affectedBooks(tenantId: string, payload: RedeemPayload): Promise<{ bookId: string; usedHere: number }[]> {
    // Ticket path: we were handed the exact ticket.
    if (payload.ticketId) {
      const res = await this.pool.query<{ book_id: string }>(
        `SELECT book_id FROM voucher_tickets WHERE id = $1 AND tenant_id = $2`,
        [payload.ticketId, tenantId],
      );
      const bookId = res.rows[0]?.book_id;
      return bookId ? [{ bookId, usedHere: 1 }] : [];
    }

    // Order path: find every ticket this order redeemed. `count` in the payload
    // includes legacy hashed pack codes too, so it is NOT a per-book figure —
    // group the tickets themselves instead of trusting it.
    if (!payload.orderId) return [];
    const res = await this.pool.query<{ book_id: string; used: string }>(
      `SELECT book_id, COUNT(*)::text AS used FROM voucher_tickets
       WHERE tenant_id = $1 AND redeemed_order_id = $2
       GROUP BY book_id`,
      [tenantId, payload.orderId],
    );
    return res.rows.map((r) => ({ bookId: r.book_id, usedHere: Number(r.used) }));
  }

  private async orderContact(tenantId: string, orderId: string): Promise<{ phone: string | null; outletId: string | null } | null> {
    const res = await this.pool.query<{ customer_phone: string | null; outlet_id: string | null }>(
      `SELECT customer_phone, outlet_id FROM orders WHERE id = $1 AND tenant_id = $2`,
      [orderId, tenantId],
    );
    const o = res.rows[0];
    return o ? { phone: o.customer_phone, outletId: o.outlet_id } : null;
  }
}
