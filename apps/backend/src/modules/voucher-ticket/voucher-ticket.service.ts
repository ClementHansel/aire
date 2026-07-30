import { Injectable, Inject, Optional, BadRequestException, NotFoundException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { JWTPayload } from '@aire/shared';
import { DATABASE_POOL } from '../auth/database.provider';
import { PosCheckoutService, resolveServiceBusinessUnit } from '../order/pos-checkout.service';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';

export interface SellBookDto {
  outletId: string;
  buyerName?: string;
  buyerPhone?: string;
  quantity: number;
  benefitType?: 'service' | 'fixed' | 'percentage';
  benefitServiceId?: string | null;
  benefitValue?: number;
  unitPrice?: number;
  expiryDate?: string | null;
  /** Tender used to settle the sale. Defaults to cash. */
  paymentMethod?: string;
}

/** Input to issueBonusBook — a FREE grant, no order/price fields. */
export interface IssueBonusBookDto {
  outletId: string;
  quantity: number;
  benefitType: 'service' | 'fixed' | 'percentage';
  benefitServiceId?: string | null;
  benefitValue?: number;
  expiryDate?: string | null;
  buyerName?: string | null;
  buyerPhone?: string | null;
  /** The order that earned this bonus (e.g. the membership fee order, or the
   *  voucher-pack purchase order) — stored for audit only; no cash order is
   *  created here. */
  orderId?: string | null;
}

export interface VoucherTicket {
  id: string; code: string; status: string; expiryDate: string | null; redeemedAt: string | null;
}

/**
 * Shareable digital vouchers. Codes use the format BRANCH-MMYYYY-NNNNNN
 * (e.g. BTR-062026-000123), are not bound to a customer/plate, and are single-use.
 * On sale the full code list is sent to the buyer's WhatsApp.
 */
@Injectable()
export class VoucherTicketService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly checkout: PosCheckoutService,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  /**
   * Sell a book of shareable voucher tickets. The sale is a completed, PAID cash
   * transaction: it creates a real order (settled immediately) so the revenue
   * books through the standard OrderPaid → accounting path (Dr Cash/Bank, Cr
   * Sales), exactly like a voucher-pack sale. Codes are generated and returned in
   * the same call so the POS can deliver them to the buyer right away.
   */
  async sellBook(user: JWTPayload, dto: SellBookDto): Promise<{ bookId: string; codes: string[] }> {
    const tenantId = user.tenant_id;
    const outletId = dto.outletId ?? user.outlet_id ?? undefined;
    if (!outletId) throw new BadRequestException('outletId is required');
    const qty = Number(dto.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000) throw new BadRequestException('quantity must be 1–1000');

    const unitPrice = dto.unitPrice ?? 0;
    const total = unitPrice * qty;
    const paymentMethod = dto.paymentMethod ?? 'cash';
    // Book the cash into the sale's branch (which may differ from the operator's
    // home outlet); operator/tenant come from the authenticated user.
    const orderUser: JWTPayload = { ...user, outlet_id: outletId };

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const outletRes = await client.query<{ code: string | null }>(
        'SELECT code FROM outlets WHERE id = $1 AND tenant_id = $2',
        [outletId, tenantId],
      );
      if (outletRes.rows.length === 0) throw new NotFoundException('Branch not found');
      const branchCode = (outletRes.rows[0]!.code || 'XXX').toUpperCase().slice(0, 3).padEnd(3, 'X');

      const now = new Date();
      const period = `${String(now.getMonth() + 1).padStart(2, '0')}${now.getFullYear()}`; // MMYYYY

      // Atomically reserve `qty` sequence numbers for this branch+period.
      const counterRes = await client.query<{ last_number: number }>(
        `INSERT INTO voucher_counters (outlet_id, period, last_number) VALUES ($1, $2, $3)
         ON CONFLICT (outlet_id, period) DO UPDATE SET last_number = voucher_counters.last_number + EXCLUDED.last_number
         RETURNING last_number`,
        [outletId, period, qty],
      );
      const high = counterRes.rows[0]!.last_number;
      const start = high - qty + 1;

      // Route the sale through a real, immediately-PAID order so the cash books
      // via OrderPaid → accounting. Upsert the buyer as a customer when we have a
      // phone; otherwise it is a walk-in and the order carries no customer.
      let customerId: string | null = null;
      if (dto.buyerPhone && dto.buyerName) {
        customerId = await this.checkout.upsertCustomer(
          client,
          tenantId,
          dto.buyerName.trim(),
          dto.buyerPhone.trim(),
        );
      }
      // A shareable ticket book carries no business_unit of its own — derive it
      // from its single benefit service when the benefit is service-typed, so
      // the sale's revenue lands in the right AIRE/LEAD bucket instead of
      // defaulting to AIRE by accident. Fixed/percentage benefits (not tied to
      // one service) fall back to AIRE (see resolveServiceBusinessUnit).
      const businessUnit = await resolveServiceBusinessUnit(client, [
        dto.benefitType === 'service' ? dto.benefitServiceId : null,
      ]);

      const order = await this.checkout.createPackOrder(client, orderUser, {
        customerId,
        customerName: dto.buyerName?.trim() || 'Walk-in',
        customerPhone: dto.buyerPhone?.trim() || '',
        total,
        note: `Voucher Book: ${qty} tickets`,
        paidNow: true,
        paymentMethod,
        businessUnit,
      });

      const bookRes = await client.query<{ id: string }>(
        `INSERT INTO voucher_books (tenant_id, outlet_id, buyer_name, buyer_phone, quantity, benefit_type, benefit_service_id, benefit_value, unit_price, expiry_date, order_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [
          tenantId, outletId, dto.buyerName ?? null, dto.buyerPhone ?? null, qty,
          dto.benefitType ?? 'service', dto.benefitServiceId ?? null, dto.benefitValue ?? 0,
          unitPrice, dto.expiryDate ?? null, order.id,
        ],
      );
      const bookId = bookRes.rows[0]!.id;

      const codes: string[] = [];
      for (let n = start; n <= high; n++) {
        const code = `${branchCode}-${period}-${String(n).padStart(6, '0')}`;
        codes.push(code);
        await client.query(
          `INSERT INTO voucher_tickets (tenant_id, book_id, outlet_id, code, expiry_date)
           VALUES ($1, $2, $3, $4, $5)`,
          [tenantId, bookId, outletId, code, dto.expiryDate ?? null],
        );
      }

      await client.query('COMMIT');

      // Cash now books through the order: emit OrderPaid AFTER commit so the
      // accounting poster (commission/feedback too) read committed rows and post
      // Dr Cash/Bank, Cr Sales — mirrors OrderService.payOrder for a cash sale.
      if (total > 0) {
        void this.eventBus?.emit({
          type: DomainEventType.OrderPaid,
          tenantId,
          outletId,
          actor: user.sub,
          payload: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            total,
            paymentMethod,
          },
        });
      }

      // Shareable voucher-book sale — mirror VoucherPackSold so the AI feed /
      // monitoring and revenue tracking see the sale at sell time.
      void this.eventBus?.emit({
        type: DomainEventType.VoucherBookSold,
        tenantId,
        outletId,
        actor: 'pos',
        payload: { bookId, orderId: order.id, quantity: qty, unitPrice, total },
      });

      // WhatsApp delivery of the code list to the buyer now happens via
      // VoucherNotifyService, subscribed to VoucherBookSold (emitted above) —
      // it uses the branch-aware, mock-visible WhatsappService.sendText.
      // Sending inline here as well would double-send.

      return { bookId, codes };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Insert a FREE bonus book of shareable voucher tickets — no order, no
   * charge — onto the caller's transaction (`client`). Used by
   * CampaignGrantService so a campaign-granted bonus (e.g. "buy 10x wash ->
   * get 3x spray wax free", AIRIN-102) lands on the SAME plaintext-code
   * model the dashboard's Issued Vouchers tab reads and POS
   * resolveDigitalVouchers redeems — instead of the hashed
   * voucher_packs/voucher_codes model the dashboard never queries
   * (AIRIN-138: that's why campaign-granted vouchers used to vanish).
   *
   * Mirrors sellBook's code-generation scheme (BRANCH-MMYYYY-NNNNNN) but
   * takes an externally-managed client rather than opening its own
   * transaction, so the caller can commit the book/tickets insert and its
   * own campaign_grants dedupe row atomically together.
   */
  async issueBonusBook(
    client: PoolClient,
    tenantId: string,
    dto: IssueBonusBookDto,
  ): Promise<{ bookId: string; codes: string[] }> {
    const qty = Number(dto.quantity);
    if (!Number.isInteger(qty) || qty < 1) throw new BadRequestException('quantity must be a positive integer');

    const outletRes = await client.query<{ code: string | null }>(
      'SELECT code FROM outlets WHERE id = $1 AND tenant_id = $2',
      [dto.outletId, tenantId],
    );
    if (outletRes.rows.length === 0) throw new NotFoundException('Branch not found');
    const branchCode = (outletRes.rows[0]!.code || 'XXX').toUpperCase().slice(0, 3).padEnd(3, 'X');

    const now = new Date();
    const period = `${String(now.getMonth() + 1).padStart(2, '0')}${now.getFullYear()}`; // MMYYYY

    const counterRes = await client.query<{ last_number: number }>(
      `INSERT INTO voucher_counters (outlet_id, period, last_number) VALUES ($1, $2, $3)
       ON CONFLICT (outlet_id, period) DO UPDATE SET last_number = voucher_counters.last_number + EXCLUDED.last_number
       RETURNING last_number`,
      [dto.outletId, period, qty],
    );
    const high = counterRes.rows[0]!.last_number;
    const start = high - qty + 1;

    const bookRes = await client.query<{ id: string }>(
      `INSERT INTO voucher_books (tenant_id, outlet_id, buyer_name, buyer_phone, quantity, benefit_type, benefit_service_id, benefit_value, unit_price, expiry_date, order_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10) RETURNING id`,
      [
        tenantId, dto.outletId, dto.buyerName ?? null, dto.buyerPhone ?? null, qty,
        dto.benefitType, dto.benefitServiceId ?? null, dto.benefitValue ?? 0,
        dto.expiryDate ?? null, dto.orderId ?? null,
      ],
    );
    const bookId = bookRes.rows[0]!.id;

    const codes: string[] = [];
    for (let n = start; n <= high; n++) {
      const code = `${branchCode}-${period}-${String(n).padStart(6, '0')}`;
      codes.push(code);
      await client.query(
        `INSERT INTO voucher_tickets (tenant_id, book_id, outlet_id, code, expiry_date)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, bookId, dto.outletId, code, dto.expiryDate ?? null],
      );
    }

    return { bookId, codes };
  }

  /** Validate a shareable code (read-only). */
  async validate(tenantId: string, code: string): Promise<{ valid: boolean; reason?: string; ticket?: VoucherTicket }> {
    const res = await this.pool.query(
      `SELECT id, code, status, expiry_date, redeemed_at FROM voucher_tickets WHERE tenant_id = $1 AND code = $2`,
      [tenantId, code.trim().toUpperCase()],
    );
    const t = res.rows[0];
    if (!t) return { valid: false, reason: 'Code not found' };
    if (t.status === 'redeemed') return { valid: false, reason: 'Already used' };
    if (t.status !== 'active') return { valid: false, reason: `Voucher ${t.status}` };
    if (t.expiry_date && new Date(t.expiry_date) < new Date(new Date().toDateString())) return { valid: false, reason: 'Expired' };
    return { valid: true, ticket: this.mapTicket(t) };
  }

  /** Redeem a code (single-use). Safe under concurrency via the status guard. */
  async redeem(tenantId: string, code: string, orderId?: string, outletId?: string): Promise<VoucherTicket> {
    const res = await this.pool.query(
      `UPDATE voucher_tickets SET status = 'redeemed', redeemed_at = NOW(), redeemed_order_id = $3, redeemed_outlet_id = $4
       WHERE tenant_id = $1 AND code = $2 AND status = 'active'
       RETURNING id, code, status, expiry_date, redeemed_at`,
      [tenantId, code.trim().toUpperCase(), orderId ?? null, outletId ?? null],
    );
    if (res.rows.length === 0) throw new BadRequestException('Voucher is not available for redemption');
    const ticket = this.mapTicket(res.rows[0]);
    // Shareable tickets bypass the order voucher path, so emit here too — keeps
    // VoucherRedeemed complete across both voucher kinds (pack codes + books).
    void this.eventBus?.emit({
      type: DomainEventType.VoucherRedeemed,
      tenantId,
      outletId: outletId ?? null,
      actor: 'pos',
      payload: { ticketId: ticket.id, code: ticket.code, orderId: orderId ?? null, source: 'ticket' },
    });
    return ticket;
  }

  /**
   * List voucher-ticket books (the dashboard's "Voucher-pack purchases"
   * section, AIRIN-133). dateFrom/dateTo/outletIds are optional — filters
   * on the book's own created_at/outlet_id (unlike memberships, a voucher
   * book IS its own sale record, no join needed for either).
   */
  async listBooks(
    tenantId: string,
    filters?: { dateFrom?: string; dateTo?: string; outletIds?: string[] | null },
  ): Promise<Record<string, unknown>[]> {
    const { dateFrom, dateTo, outletIds } = filters ?? {};
    const qp: unknown[] = [tenantId];
    let filter = '';
    if (outletIds != null) { filter += ` AND b.outlet_id = ANY($${qp.length + 1}::uuid[])`; qp.push(outletIds); }
    if (dateFrom) { filter += ` AND b.created_at >= $${qp.length + 1}::timestamptz`; qp.push(dateFrom); }
    if (dateTo) { filter += ` AND b.created_at < ($${qp.length + 1}::date + INTERVAL '1 day')`; qp.push(dateTo); }

    const res = await this.pool.query(
      // benefit_service_id is only set for benefit_type = 'service'; the joined
      // name lets the dashboard label a pack by what it actually grants
      // ("Voucher Cuci Mobil") instead of the raw benefit type.
      `SELECT b.id, b.buyer_name, b.buyer_phone, b.quantity, b.benefit_type, b.unit_price, b.created_at,
              b.outlet_id, o.name AS outlet_name, bs.name AS benefit_name,
              COUNT(t.id) FILTER (WHERE t.status = 'redeemed')::int AS redeemed
       FROM voucher_books b
       JOIN outlets o ON o.id = b.outlet_id
       LEFT JOIN services bs ON bs.id = b.benefit_service_id
       LEFT JOIN voucher_tickets t ON t.book_id = b.id
       WHERE b.tenant_id = $1 ${filter}
       GROUP BY b.id, o.name, bs.name
       ORDER BY b.created_at DESC LIMIT 200`,
      qp,
    );
    return res.rows.map((b) => ({
      id: b.id, buyerName: b.buyer_name, buyerPhone: b.buyer_phone, quantity: b.quantity,
      benefitType: b.benefit_type, benefitName: b.benefit_name ?? null, unitPrice: parseFloat(b.unit_price),
      outletId: b.outlet_id, outletName: b.outlet_name,
      redeemed: b.redeemed, createdAt: b.created_at,
    }));
  }

  async listTickets(tenantId: string, bookId: string): Promise<VoucherTicket[]> {
    const res = await this.pool.query(
      `SELECT id, code, status, expiry_date, redeemed_at FROM voucher_tickets WHERE tenant_id = $1 AND book_id = $2 ORDER BY code`,
      [tenantId, bookId],
    );
    return res.rows.map((r) => this.mapTicket(r));
  }

  private mapTicket = (r: any): VoucherTicket => ({
    id: r.id, code: r.code, status: r.status,
    expiryDate: r.expiry_date ?? null, redeemedAt: r.redeemed_at ?? null,
  });
}
