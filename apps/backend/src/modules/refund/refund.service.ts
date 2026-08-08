import { Injectable, Inject, Optional, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { randomInt } from 'node:crypto';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';
import { NotificationService } from '../notification/notification.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { NotificationRendererService, renderNotification } from '../notification/notification-renderer.service';
import { JWTPayload, Role, checkVoidAuthorization } from '@aire/shared';
import * as bcrypt from 'bcrypt';

export interface RefundItemInput {
  orderItemId: string;
  quantity: number;
  amount: number;
}

export interface CreateRefundDto {
  orderId: string;
  reason: string;
  refundMethod: string; // cash | bank | qris | edc | transfer
  items: RefundItemInput[];
  adminPin?: string;
}

/**
 * RefundService — first-class money-out reversal of a paid order, partial or full.
 *
 * Unlike voidOrder (which cancels the record and leaves money untouched), a refund
 * records the money actually returned: it creates a `refunds` row + per-line
 * `refund_items`, prorates the PPN portion, restocks recipe stock proportional to
 * the refunded fraction, and — for cash refunds — books a petty-cash `out` against
 * the operator's open shift so the drawer reconciles at close. Authorization reuses
 * the shared void rules (money-out requires the same admin-PIN gate). The accounting
 * module posts a balanced reversal on RefundIssued (idempotent per refund id).
 *
 * Authorization PIN: reuses the same one-time, emailed/WhatsApp'd 6-digit PIN
 * mechanism as order.service.ts's void flow (void_pin_requests, keyed by
 * order_id — a refund is on an order, so the order's PIN authorizes it too).
 * See requestRefundPin / the PIN verification in createRefund.
 */
@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  /** One-time refund-PIN validity window (requestRefundPin / createRefund). */
  private static readonly REFUND_PIN_TTL_MINUTES = 10;

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() private readonly eventBus?: EventBusService,
    @Optional() private readonly notification?: NotificationService,
    @Optional() private readonly whatsapp?: WhatsappService,
    @Optional() @Inject(NotificationRendererService) private readonly renderer?: NotificationRendererService,
  ) {}

  /**
   * Issues a one-time 6-digit PIN authorizing a refund on this order, and
   * delivers it to the tenant — over WhatsApp (to the tenant's configured
   * escalation number) when available, else by email to the tenant owner.
   * Reuses the same `void_pin_requests` table as the order-void flow, keyed
   * by order_id: a refund is always against an order, so any prior unconsumed
   * PIN for that order (from a void request or an earlier refund request) is
   * invalidated first — only the most recently requested PIN is ever valid.
   */
  async requestRefundPin(
    orderId: string,
    user: JWTPayload,
  ): Promise<{ sent: boolean; expiresInMinutes: number; channel: 'whatsapp' | 'email' }> {
    const cur = await this.pool.query<{ id: string; outlet_id: string | null; order_number: string }>(
      `SELECT id, outlet_id, order_number FROM orders WHERE id = $1 AND tenant_id = $2`,
      [orderId, user.tenant_id],
    );
    const order = cur.rows[0];
    if (!order) throw new BadRequestException('Order not found');

    const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const pinHash = bcrypt.hashSync(pin, 10);
    const expiresAt = new Date(Date.now() + RefundService.REFUND_PIN_TTL_MINUTES * 60_000);

    // Invalidate any still-live PIN for this order first — a new request
    // supersedes it rather than leaving two valid codes at once (shared table
    // with the void flow, so this also supersedes a live void PIN).
    await this.pool.query(
      `UPDATE void_pin_requests SET consumed_at = NOW()
       WHERE tenant_id = $1 AND order_id = $2 AND consumed_at IS NULL`,
      [user.tenant_id, orderId],
    );
    await this.pool.query(
      `INSERT INTO void_pin_requests (tenant_id, outlet_id, order_id, pin_hash, requested_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user.tenant_id, order.outlet_id, orderId, pinHash, user.sub, expiresAt.toISOString()],
    );

    const channel = await this.deliverRefundPin(user.tenant_id, order.order_number, pin);
    return { sent: true, expiresInMinutes: RefundService.REFUND_PIN_TTL_MINUTES, channel };
  }

  /**
   * Delivers the plaintext refund PIN, preferring WhatsApp (to the tenant's
   * agent-config escalation number, via the same WAHA integration the AI
   * agent uses) and falling back to email (tenant owner) when no escalation
   * number is configured or the WhatsApp send fails. Logs which channel won.
   */
  private async deliverRefundPin(
    tenantId: string,
    orderNumber: string,
    pin: string,
  ): Promise<'whatsapp' | 'email'> {
    const text = (await renderNotification(this.renderer, tenantId, 'refund_pin', {
      orderNumber,
      pin,
      ttlMinutes: RefundService.REFUND_PIN_TTL_MINUTES,
    })) ?? '';

    if (this.whatsapp) {
      const cfg = await this.pool.query<{ escalation_number: string | null }>(
        `SELECT escalation_number FROM agent_configs WHERE tenant_id = $1`,
        [tenantId],
      );
      const escalationNumber = cfg.rows[0]?.escalation_number;
      if (escalationNumber) {
        const ok = await this.whatsapp.sendText(tenantId, escalationNumber, text);
        if (ok) {
          this.logger.log(`Refund PIN for order ${orderNumber} delivered via WhatsApp (escalation number)`);
          return 'whatsapp';
        }
        this.logger.warn(`Refund PIN WhatsApp delivery failed for order ${orderNumber}; falling back to email`);
      }
    }

    const ownerRes = await this.pool.query<{ email: string }>(
      `SELECT email FROM users
       WHERE tenant_id = $1 AND role = 'tenant_owner' AND is_active = true
       ORDER BY created_at ASC LIMIT 1`,
      [tenantId],
    );
    const ownerEmail = ownerRes.rows[0]?.email;
    if (!ownerEmail) {
      throw new BadRequestException(
        'No WhatsApp escalation number or active tenant owner with an email is configured to receive the refund PIN',
      );
    }
    const sendResult = await this.notification?.sendEmail({
      to: ownerEmail,
      subject: `Kode PIN Refund — Order ${orderNumber}`,
      body: text,
    });
    if (sendResult && !sendResult.success) {
      this.logger.warn(`Refund PIN email failed to send for order ${orderNumber}: ${sendResult.error}`);
    } else {
      this.logger.log(`Refund PIN for order ${orderNumber} delivered via email`);
    }
    return 'email';
  }

  async createRefund(tenantId: string, dto: CreateRefundDto, user: JWTPayload) {
    if (!dto?.orderId) throw new BadRequestException('orderId is required');
    if (!dto.reason?.trim()) throw new BadRequestException('A refund reason is required');
    if (!Array.isArray(dto.items) || dto.items.length === 0) {
      throw new BadRequestException('At least one line must be selected for refund');
    }
    const method = (dto.refundMethod ?? 'cash').toLowerCase();

    const cur = await this.pool.query(
      `SELECT o.id, o.status, o.total, o.tax, o.order_number, o.outlet_id, o.created_at,
              s.status AS shift_status, ot.settings AS outlet_settings
       FROM orders o
       LEFT JOIN pos_shifts s ON s.id = o.shift_id
       LEFT JOIN outlets ot ON ot.id = o.outlet_id
       WHERE o.id = $1 AND o.tenant_id = $2`,
      [dto.orderId, tenantId],
    );
    const order = cur.rows[0];
    if (!order) throw new NotFoundException('Order not found');
    if (!['paid', 'confirmed', 'completed'].includes(order.status)) {
      throw new BadRequestException('Only a paid order can be refunded');
    }
    if (order.shift_status === 'closed') {
      throw new BadRequestException('Order is day-locked (its shift is closed) and cannot be refunded');
    }

    // Authorization — money-out, gated like a void. Verifies against the same
    // one-time PIN mechanism as order.service.ts's void flow: the latest
    // unconsumed, unexpired void_pin_requests row for this order (requested
    // via requestRefundPin, above) — not the old static users.admin_pin_hash.
    const freeWindow = Number(order.outlet_settings?.free_void_window_minutes ?? 0) || 0;
    let pinRow: { id: string; pin_hash: string } | null = null;
    if (dto.adminPin) {
      const pr = await this.pool.query<{ id: string; pin_hash: string }>(
        `SELECT id, pin_hash FROM void_pin_requests
         WHERE tenant_id = $1 AND order_id = $2 AND consumed_at IS NULL AND expires_at > NOW()
         ORDER BY created_at DESC LIMIT 1`,
        [tenantId, dto.orderId],
      );
      pinRow = pr.rows[0] ?? null;
    }
    const auth = checkVoidAuthorization(
      {
        role: user.role as Role,
        reason: dto.reason,
        adminPin: dto.adminPin,
        orderCreatedAt: new Date(order.created_at).toISOString(),
        currentTime: new Date().toISOString(),
        freeVoidWindowMinutes: freeWindow,
      },
      (pin) => !!pinRow && bcrypt.compareSync(pin, pinRow.pin_hash),
    );
    if (!auth.authorized) {
      throw new BadRequestException({
        message: auth.error?.message ?? 'Refund not authorized',
        code: auth.error?.code,
        requiresPin: auth.requiresPin,
      });
    }

    // Validate lines against the order and already-refunded amounts.
    const itemsRes = await this.pool.query<{ id: string; quantity: string; subtotal: string }>(
      `SELECT id, quantity, subtotal FROM order_items WHERE order_id = $1`,
      [dto.orderId],
    );
    const orderItems = new Map(itemsRes.rows.map((r) => [r.id, r]));
    const prior = await this.pool.query<{ order_item_id: string; qty: string; amt: string }>(
      `SELECT ri.order_item_id, COALESCE(SUM(ri.quantity),0) AS qty, COALESCE(SUM(ri.amount),0) AS amt
       FROM refund_items ri JOIN refunds r ON r.id = ri.refund_id
       WHERE r.order_id = $1 AND r.status <> 'cancelled'
       GROUP BY ri.order_item_id`,
      [dto.orderId],
    );
    const refundedByItem = new Map(prior.rows.map((r) => [r.order_item_id, { qty: parseFloat(r.qty), amt: parseFloat(r.amt) }]));

    let total = 0;
    for (const line of dto.items) {
      const oi = orderItems.get(line.orderItemId);
      if (!oi) throw new BadRequestException('Refund line does not belong to this order');
      const qty = Number(line.quantity);
      const amount = Number(line.amount);
      if (!(qty > 0) || !(amount > 0)) throw new BadRequestException('Refund quantity and amount must be positive');
      const already = refundedByItem.get(line.orderItemId) ?? { qty: 0, amt: 0 };
      if (qty + already.qty > parseFloat(oi.quantity) + 1e-6) {
        throw new BadRequestException('Refund quantity exceeds the quantity sold on that line');
      }
      if (amount + already.amt > parseFloat(oi.subtotal) + 1e-6) {
        throw new BadRequestException('Refund amount exceeds the amount paid on that line');
      }
      total += amount;
    }
    total = Math.round(total * 100) / 100;
    const orderTotal = parseFloat(order.total) || 0;
    if (total > orderTotal + 1e-6) throw new BadRequestException('Refund total exceeds the order total');

    // Prorate PPN (tax is only whole-order grain).
    const orderTax = parseFloat(order.tax ?? '0') || 0;
    const fraction = orderTotal > 0 ? Math.min(total / orderTotal, 1) : 0;
    const taxReversed = Math.round(orderTax * fraction * 100) / 100;

    // The refund hits the operator's currently-open shift (not the order's shift,
    // which may already be closed) so a cash refund reconciles the live drawer.
    const openShift = await this.pool.query<{ id: string }>(
      `SELECT id FROM pos_shifts WHERE tenant_id = $1 AND operator_id = $2 AND status = 'open'
       ORDER BY opened_at DESC LIMIT 1`,
      [tenantId, user.sub],
    );
    const shiftId = openShift.rows[0]?.id ?? null;

    const refundNumber = await this.nextRefundNumber(tenantId);

    const client = await this.pool.connect();
    let refundId = '';
    try {
      await client.query('BEGIN');

      const ins = await client.query<{ id: string }>(
        `INSERT INTO refunds
           (tenant_id, outlet_id, order_id, refund_number, status, reason, refund_method,
            total, tax_reversed, shift_id, approved_by, created_by, pin_used)
         VALUES ($1,$2,$3,$4,'completed',$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [
          tenantId, order.outlet_id, dto.orderId, refundNumber, dto.reason.trim(), method,
          total, taxReversed, shiftId, user.sub, user.sub, !!auth.requiresPin,
        ],
      );
      refundId = ins.rows[0]!.id;

      for (const line of dto.items) {
        await client.query(
          `INSERT INTO refund_items (refund_id, order_item_id, quantity, amount) VALUES ($1,$2,$3,$4)`,
          [refundId, line.orderItemId, Number(line.quantity), Math.round(Number(line.amount) * 100) / 100],
        );
      }

      // Restock recipe stock proportional to the refunded fraction (mirrors void
      // at f=1). Cumulative fractions across partial refunds sum to ≤ 1 because
      // per-line amounts are capped at the amount paid.
      if (fraction > 0) {
        const moves = await client.query<{ item_id: string; quantity: string }>(
          `SELECT item_id, quantity FROM inventory_movements
           WHERE reference = $1 AND type = 'sale' AND tenant_id = $2`,
          [order.order_number, tenantId],
        );
        for (const m of moves.rows) {
          const qty = Math.round(parseFloat(m.quantity) * fraction * 1000) / 1000;
          if (qty <= 0) continue;
          await client.query(
            `UPDATE inventory_items SET quantity = quantity + $1, updated_at = NOW() WHERE id = $2`,
            [qty, m.item_id],
          );
          await client.query(
            `INSERT INTO inventory_movements (tenant_id, item_id, type, quantity, reason, reference, actor)
             VALUES ($1,$2,'sale_return',$3,$4,$5,$6)`,
            [tenantId, m.item_id, qty, `Refund ${refundNumber}`, order.order_number, user.sub],
          );
        }
      }

      // Cash refund → petty-cash 'out' so expected_cash at shift close subtracts it.
      if (method === 'cash' && shiftId) {
        await client.query(
          `INSERT INTO petty_cash_movements (tenant_id, shift_id, type, amount, category, reason, actor)
           VALUES ($1,$2,'out',$3,'refund',$4,$5)`,
          [tenantId, shiftId, total, `Refund ${refundNumber} (order ${order.order_number})`, user.sub],
        );
      }

      // Single-use: consume the one-time PIN so it can't be replayed. Done in
      // the same transaction as the refund itself, so a rollback (e.g. a
      // later step throwing) leaves the PIN valid to retry with.
      if (pinRow) {
        await client.query(`UPDATE void_pin_requests SET consumed_at = NOW() WHERE id = $1`, [pinRow.id]);
      }

      await client.query(
        `INSERT INTO audit_logs (tenant_id, user_id, operation, entity_type, entity_id, before_value, after_value)
         VALUES ($1,$2,'order.refund','refund',$3,$4,$5)`,
        [
          tenantId, user.sub, refundId,
          JSON.stringify({ orderId: dto.orderId, orderTotal }),
          JSON.stringify({ refundNumber, total, taxReversed, method, reason: dto.reason, pinUsed: !!auth.requiresPin }),
        ],
      );

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    void this.eventBus?.emit({
      type: DomainEventType.RefundIssued,
      tenantId,
      outletId: order.outlet_id,
      actor: user.sub,
      payload: { refundId, orderId: dto.orderId, total, tax: taxReversed, method },
    });

    return { id: refundId, refundNumber, total, taxReversed };
  }

  async listRefunds(tenantId: string, opts: { from?: string; to?: string; outletId?: string } = {}) {
    const conds = ['r.tenant_id = $1'];
    const params: unknown[] = [tenantId];
    if (opts.from) { params.push(opts.from); conds.push(`r.created_at >= $${params.length}`); }
    if (opts.to) { params.push(opts.to); conds.push(`r.created_at < ($${params.length}::date + 1)`); }
    if (opts.outletId) { params.push(opts.outletId); conds.push(`r.outlet_id = $${params.length}`); }
    const res = await this.pool.query(
      `SELECT r.id, r.refund_number, r.order_id, o.order_number, r.status, r.reason,
              r.refund_method, r.total, r.tax_reversed, r.outlet_id, ot.name AS outlet_name,
              r.created_at
       FROM refunds r
       LEFT JOIN orders o ON o.id = r.order_id
       LEFT JOIN outlets ot ON ot.id = r.outlet_id
       WHERE ${conds.join(' AND ')}
       ORDER BY r.created_at DESC LIMIT 500`,
      params,
    );
    return res.rows.map((r) => this.mapRefund(r));
  }

  async getRefund(tenantId: string, id: string) {
    const res = await this.pool.query(
      `SELECT r.*, o.order_number FROM refunds r LEFT JOIN orders o ON o.id = r.order_id
       WHERE r.id = $1 AND r.tenant_id = $2`,
      [id, tenantId],
    );
    const r = res.rows[0];
    if (!r) throw new NotFoundException('Refund not found');
    const items = await this.pool.query(
      `SELECT ri.id, ri.order_item_id, ri.quantity, ri.amount, s.name AS service_name
       FROM refund_items ri
       LEFT JOIN order_items oi ON oi.id = ri.order_item_id
       LEFT JOIN services s ON s.id = oi.service_id
       WHERE ri.refund_id = $1`,
      [id],
    );
    return { ...this.mapRefund(r), items: items.rows };
  }

  /** The order's lines with remaining refundable quantity/amount, for building a refund. */
  async refundableLines(tenantId: string, orderId: string) {
    const ord = await this.pool.query<{ status: string; total: string; tax: string; order_number: string }>(
      `SELECT status, total, tax, order_number FROM orders WHERE id = $1 AND tenant_id = $2`,
      [orderId, tenantId],
    );
    const o = ord.rows[0];
    if (!o) throw new NotFoundException('Order not found');
    const items = await this.pool.query(
      `SELECT oi.id, s.name AS service_name, oi.quantity, oi.unit_price, oi.subtotal,
              COALESCE((SELECT SUM(ri.quantity) FROM refund_items ri JOIN refunds r ON r.id = ri.refund_id
                        WHERE ri.order_item_id = oi.id AND r.status <> 'cancelled'),0) AS refunded_qty,
              COALESCE((SELECT SUM(ri.amount) FROM refund_items ri JOIN refunds r ON r.id = ri.refund_id
                        WHERE ri.order_item_id = oi.id AND r.status <> 'cancelled'),0) AS refunded_amt
       FROM order_items oi LEFT JOIN services s ON s.id = oi.service_id
       WHERE oi.order_id = $1 ORDER BY oi.sort_order`,
      [orderId],
    );
    return {
      orderId,
      orderNumber: o.order_number,
      status: o.status,
      refundable: ['paid', 'confirmed', 'completed'].includes(o.status),
      lines: items.rows.map((r) => {
        const qty = parseFloat(r.quantity);
        const subtotal = parseFloat(r.subtotal);
        const refundedQty = parseFloat(r.refunded_qty) || 0;
        const refundedAmt = parseFloat(r.refunded_amt) || 0;
        return {
          orderItemId: r.id,
          serviceName: r.service_name,
          quantity: qty,
          unitPrice: parseFloat(r.unit_price),
          subtotal,
          remainingQty: Math.max(qty - refundedQty, 0),
          remainingAmount: Math.max(Math.round((subtotal - refundedAmt) * 100) / 100, 0),
        };
      }),
    };
  }

  async listByOrder(tenantId: string, orderId: string) {
    const res = await this.pool.query(
      `SELECT id, refund_number, status, total, tax_reversed, refund_method, reason, created_at
       FROM refunds WHERE tenant_id = $1 AND order_id = $2 ORDER BY created_at DESC`,
      [tenantId, orderId],
    );
    return res.rows.map((r) => this.mapRefund(r));
  }

  private mapRefund(r: Record<string, unknown>) {
    return {
      id: r.id,
      refundNumber: r.refund_number,
      orderId: r.order_id,
      orderNumber: r.order_number,
      status: r.status,
      reason: r.reason,
      method: r.refund_method,
      total: parseFloat(String(r.total)),
      taxReversed: parseFloat(String(r.tax_reversed ?? 0)),
      outletId: r.outlet_id,
      outletName: r.outlet_name,
      createdAt: r.created_at,
    };
  }

  /** RFN-YYYYMMDD-NNN, per-tenant per-day running sequence. */
  private async nextRefundNumber(tenantId: string): Promise<string> {
    const now = new Date();
    const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const prefix = `RFN-${ymd}-`;
    const res = await this.pool.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM refunds WHERE tenant_id = $1 AND refund_number LIKE $2`,
      [tenantId, `${prefix}%`],
    );
    const seq = (parseInt(res.rows[0]!.n, 10) || 0) + 1;
    return `${prefix}${String(seq).padStart(3, '0')}`;
  }
}
