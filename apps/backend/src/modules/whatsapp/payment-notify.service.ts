import { Injectable, Inject, Optional, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';
import { WhatsappService } from './whatsapp.service';

const fmtRp = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

/**
 * PaymentNotifyService — sends the customer a thank-you WhatsApp message with a
 * link to their public receipt/invoice right after an order is paid.
 *
 * Idempotency: the public_token is minted at most once per order via
 * `UPDATE ... WHERE public_token IS NULL`. Only the request that actually mints
 * the token (affects 1 row) sends the notification — a duplicate OrderPaid
 * delivery (webhooks fire twice) finds the token already set and skips.
 */
@Injectable()
export class PaymentNotifyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentNotifyService.name);
  private unsubscribes: Array<() => void> = [];

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() private readonly eventBus?: EventBusService,
    @Optional() private readonly whatsapp?: WhatsappService,
  ) {}

  onModuleInit(): void {
    if (this.eventBus) {
      this.unsubscribes.push(
        this.eventBus.on(DomainEventType.OrderPaid, (e) =>
          this.safe(() => this.onOrderPaid(e.tenantId!, e.outletId ?? null, (e.payload as { orderId: string }).orderId))),
      );
      this.logger.log('Payment thank-you notification subscribed (order.paid)');
    }
  }

  onModuleDestroy(): void {
    this.unsubscribes.forEach((u) => u());
    this.unsubscribes = [];
  }

  private async safe(fn: () => Promise<unknown>): Promise<void> {
    try { await fn(); } catch (e) { this.logger.error(`Payment notification failed: ${e instanceof Error ? e.message : e}`); }
  }

  private async onOrderPaid(tenantId: string, payloadOutletId: string | null, orderId: string): Promise<void> {
    if (!this.whatsapp) return;
    const ord = await this.pool.query<{
      customer_phone: string | null; customer_name: string | null; outlet_id: string | null;
      order_number: string; total: string; public_token: string | null;
    }>(
      `SELECT customer_phone, customer_name, outlet_id, order_number, total, public_token FROM orders WHERE id = $1 AND tenant_id = $2`,
      [orderId, tenantId],
    );
    const o = ord.rows[0];
    if (!o?.customer_phone) return;

    // Mint the public token idempotently — a duplicate OrderPaid delivery (webhooks
    // fire twice) or an order already notified will already have a token, so it
    // is only the caller that actually mints it (affects 1 row) that notifies.
    if (o.public_token) return;
    const token = randomUUID();
    const upd = await this.pool.query(
      `UPDATE orders SET public_token = $1 WHERE id = $2 AND tenant_id = $3 AND public_token IS NULL`,
      [token, orderId, tenantId],
    );
    if ((upd.rowCount ?? 0) === 0) return; // already minted by a concurrent/duplicate delivery

    // Match the public-URL convention used for the confirm-booking link
    // (portal-booking.service / bridge.controller) so the receipt link works in
    // production without extra env config.
    const base = process.env.APP_PUBLIC_URL || process.env.PUBLIC_APP_URL || 'https://app.useairin.id';
    const url = `${base}/receipt/${token}`;
    const text =
      `Terima kasih atas pembayaran Anda 🙏\n` +
      `Pesanan ${o.order_number} — Total ${fmtRp(Number(o.total))}.\n` +
      `Lihat invoice: ${url}`;

    await this.whatsapp.sendText(tenantId, o.customer_phone, text, o.outlet_id ?? payloadOutletId ?? null);
  }
}
