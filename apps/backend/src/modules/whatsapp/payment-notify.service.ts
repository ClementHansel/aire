import { Injectable, Inject, Optional, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { DATABASE_POOL } from '../auth/database.provider';
import { WhatsappService } from './whatsapp.service';

const fmtRp = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

/**
 * PaymentNotifyService — sends the customer a thank-you WhatsApp message with a
 * link to their public receipt/invoice for a paid order.
 *
 * This used to fire automatically on every `order.paid` event. It no longer
 * does: WhatsApp Business charges per conversation, and a shop doing three
 * hundred washes a day was paying for three hundred messages nobody asked for.
 * The cashier now decides, one sale at a time, from the receipt screen
 * (AIRIN-168) — which is also the moment they know whether the customer wants
 * it.
 *
 * Re-sending is deliberately allowed: the customer's phone was mistyped, or the
 * message went to the wrong number, and the cashier needs a second attempt. The
 * public token is still minted at most once per order, so the link is stable
 * however many times it is sent.
 */
@Injectable()
export class PaymentNotifyService {
  private readonly logger = new Logger(PaymentNotifyService.name);

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() private readonly whatsapp?: WhatsappService,
  ) {}

  /**
   * Send (or re-send) the receipt message for one paid order.
   *
   * Returns why it did nothing rather than throwing: the money is already
   * collected, so a notification problem must never look like a failed sale.
   */
  async sendReceipt(
    tenantId: string,
    orderId: string,
    outletIdHint: string | null = null,
  ): Promise<{ sent: boolean; reason?: string; phone?: string }> {
    if (!this.whatsapp) return { sent: false, reason: 'WhatsApp is not configured' };

    const ord = await this.pool.query<{
      customer_phone: string | null; customer_name: string | null; outlet_id: string | null;
      order_number: string; total: string; public_token: string | null; status: string;
    }>(
      `SELECT customer_phone, customer_name, outlet_id, order_number, total, public_token, status
         FROM orders WHERE id = $1 AND tenant_id = $2`,
      [orderId, tenantId],
    );
    const o = ord.rows[0];
    if (!o) return { sent: false, reason: 'Order not found' };
    if (!o.customer_phone) return { sent: false, reason: 'This order has no customer phone number' };
    if (!['paid', 'confirmed', 'completed'].includes(o.status)) {
      return { sent: false, reason: 'The order is not paid yet' };
    }

    // Mint the public token once; every later send reuses the same link.
    let token = o.public_token;
    if (!token) {
      const fresh = randomUUID();
      const upd = await this.pool.query<{ public_token: string }>(
        `UPDATE orders SET public_token = $1
          WHERE id = $2 AND tenant_id = $3 AND public_token IS NULL
        RETURNING public_token`,
        [fresh, orderId, tenantId],
      );
      if ((upd.rowCount ?? 0) > 0) {
        token = fresh;
      } else {
        // A concurrent send minted it first — read it back rather than issuing a
        // second link for the same receipt.
        const again = await this.pool.query<{ public_token: string | null }>(
          `SELECT public_token FROM orders WHERE id = $1 AND tenant_id = $2`,
          [orderId, tenantId],
        );
        token = again.rows[0]?.public_token ?? null;
      }
    }
    if (!token) return { sent: false, reason: 'Could not create the receipt link' };

    // Match the public-URL convention used for the confirm-booking link
    // (portal-booking.service / bridge.controller) so the receipt link works in
    // production without extra env config.
    const base = process.env.APP_PUBLIC_URL || process.env.PUBLIC_APP_URL || 'https://app.useairin.id';
    const url = `${base}/receipt/${token}`;
    const text =
      `Terima kasih atas pembayaran Anda 🙏\n` +
      `Pesanan ${o.order_number} — Total ${fmtRp(Number(o.total))}.\n` +
      `Lihat invoice: ${url}`;

    const ok = await this.whatsapp
      .sendText(tenantId, o.customer_phone, text, o.outlet_id ?? outletIdHint ?? null)
      .catch((e) => { this.logger.warn(`Receipt WhatsApp failed for order ${orderId}: ${e}`); return false; });

    return ok
      ? { sent: true, phone: o.customer_phone }
      : { sent: false, reason: 'WhatsApp delivery failed', phone: o.customer_phone };
  }
}
