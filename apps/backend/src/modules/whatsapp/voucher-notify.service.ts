import { Injectable, Inject, Optional, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';
import { WhatsappService } from './whatsapp.service';

/**
 * VoucherNotifyService — sends the buyer a thank-you WhatsApp message with the
 * actual voucher codes right after a voucher BOOK sale (voucher-ticket module).
 *
 * Subscribes to VoucherBookSold rather than being called inline from
 * VoucherTicketService, so the send goes through the branch-aware, mock-visible
 * WhatsappService.sendText without VoucherTicketService needing to depend on
 * the whatsapp module (avoids a circular dependency).
 */
@Injectable()
export class VoucherNotifyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VoucherNotifyService.name);
  private unsubscribes: Array<() => void> = [];

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() private readonly eventBus?: EventBusService,
    @Optional() private readonly whatsapp?: WhatsappService,
  ) {}

  onModuleInit(): void {
    if (this.eventBus) {
      this.unsubscribes.push(
        this.eventBus.on(DomainEventType.VoucherBookSold, (e) =>
          this.safe(() => this.onVoucherBookSold(e.tenantId!, e.outletId ?? null, e.payload as { bookId: string }))),
      );
      this.logger.log('Voucher-purchase notification subscribed (voucher.book_sold)');
    }
  }

  onModuleDestroy(): void {
    this.unsubscribes.forEach((u) => u());
    this.unsubscribes = [];
  }

  private async safe(fn: () => Promise<unknown>): Promise<void> {
    try { await fn(); } catch (e) { this.logger.error(`Voucher-purchase notification failed: ${e instanceof Error ? e.message : e}`); }
  }

  private async onVoucherBookSold(tenantId: string, outletId: string | null, payload: { bookId: string }): Promise<void> {
    if (!this.whatsapp) return;
    const bookRes = await this.pool.query<{ buyer_name: string | null; buyer_phone: string | null; expiry_date: string | null }>(
      `SELECT buyer_name, buyer_phone, expiry_date::text AS expiry_date FROM voucher_books WHERE id = $1 AND tenant_id = $2`,
      [payload.bookId, tenantId],
    );
    const book = bookRes.rows[0];
    if (!book?.buyer_phone) return;

    const codesRes = await this.pool.query<{ code: string }>(
      `SELECT code FROM voucher_tickets WHERE book_id = $1 AND tenant_id = $2 ORDER BY code`,
      [payload.bookId, tenantId],
    );
    const codes = codesRes.rows.map((r) => r.code);
    if (codes.length === 0) return;

    const text =
      `Terima kasih! Pembelian ${codes.length} voucher berhasil ✅\n` +
      `Kode voucher Anda:\n${codes.join('\n')}` +
      `${book.expiry_date ? `\nBerlaku sampai ${book.expiry_date}.` : ''}\n` +
      `Tunjukkan kode ini di kasir untuk digunakan.`;

    await this.whatsapp.sendText(tenantId, book.buyer_phone, text, outletId ?? null);
  }
}
