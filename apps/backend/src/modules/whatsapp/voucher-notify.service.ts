import { Injectable, Inject, Optional, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';
import { WhatsappService } from './whatsapp.service';
import { loadBookSummary, loadActiveCodes, formatCodeList } from './voucher-book.query';
import { NotificationRendererService, renderNotification } from '../notification/notification-renderer.service';

/**
 * VoucherNotifyService — sends the customer the voucher NAME and the full list
 * of codes as soon as a book of vouchers becomes theirs.
 *
 * It listens for a book coming into existence rather than being called inline,
 * so the send goes through the branch-aware, mock-visible
 * WhatsappService.sendText without the voucher/campaign modules having to
 * depend on the whatsapp module (that would be a circular dependency).
 *
 * Three routes produce a book, and all three land here:
 *   - VoucherBookSold   — a dashboard ad-hoc sale, AND a POS voucher-pack sale
 *   - CampaignBonusGranted — a bonus book minted by a campaign trigger
 *
 * NB the POS pack sale and the campaign bonus used to attempt delivery through
 * NotificationService.sendWhatsApp, which posts a registered TEMPLATE to the
 * Meta WhatsApp Business API. That vendor was never wired here (the platform
 * sends via WAHA/kirimdev, and WHATSAPP_API_URL/TOKEN are unset in production),
 * so those messages could only ever fail — which is why a customer buying a
 * voucher pack never received their codes.
 */
@Injectable()
export class VoucherNotifyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VoucherNotifyService.name);
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
        this.eventBus.on(DomainEventType.VoucherBookSold, (e) =>
          this.safe(() => this.deliverCodes(e.tenantId!, e.outletId ?? null, (e.payload as { bookId: string }).bookId))),
        this.eventBus.on(DomainEventType.CampaignBonusGranted, (e) =>
          this.safe(() => this.deliverCodes(e.tenantId!, e.outletId ?? null, (e.payload as { bookId?: string }).bookId))),
      );
      this.logger.log('Voucher-purchase notification subscribed (voucher.book_sold, campaign.bonus_granted)');
    }
  }

  onModuleDestroy(): void {
    this.unsubscribes.forEach((u) => u());
    this.unsubscribes = [];
  }

  private async safe(fn: () => Promise<unknown>): Promise<void> {
    try { await fn(); } catch (e) { this.logger.error(`Voucher-purchase notification failed: ${e instanceof Error ? e.message : e}`); }
  }

  private async deliverCodes(tenantId: string, eventOutletId: string | null, bookId: string | undefined): Promise<void> {
    if (!this.whatsapp || !bookId) return;

    const book = await loadBookSummary(this.pool, tenantId, bookId);
    if (!book?.buyerPhone) return; // walk-in buyer, nowhere to send

    // Every code, not just the unused ones: this fires at issue time, so they are
    // all unused — and reading the book's own tickets keeps it correct even if the
    // event is replayed after one has been redeemed.
    const codes = await loadActiveCodes(this.pool, tenantId, bookId);
    if (codes.length === 0) return;

    // A purchase and a bonus read differently enough to be two entries the owner
    // can word separately; everything after the opening line is shared.
    const key = book.source === 'bonus' ? 'voucher_bonus_granted' : 'voucher_purchased';
    const text = await renderNotification(this.renderer, tenantId, key, {
      customerName: book.buyerName?.trim() ?? '',
      voucherName: book.name,
      codeCount: codes.length,
      codeList: formatCodeList(codes),
      expiryDate: book.expiryDate ?? '',
    });
    if (!text) return; // unknown key, or the owner switched this notification off

    await this.whatsapp.sendText(tenantId, book.buyerPhone, text, book.outletId ?? eventOutletId ?? null);
  }
}
