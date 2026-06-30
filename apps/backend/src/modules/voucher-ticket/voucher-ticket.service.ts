import { Injectable, Inject, Optional, BadRequestException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { NotificationService, NotificationType } from '../notification';

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
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  async sellBook(tenantId: string, dto: SellBookDto): Promise<{ bookId: string; codes: string[] }> {
    if (!dto.outletId) throw new BadRequestException('outletId is required');
    const qty = Number(dto.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000) throw new BadRequestException('quantity must be 1–1000');

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const outletRes = await client.query<{ code: string | null }>(
        'SELECT code FROM outlets WHERE id = $1 AND tenant_id = $2',
        [dto.outletId, tenantId],
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
        [dto.outletId, period, qty],
      );
      const high = counterRes.rows[0]!.last_number;
      const start = high - qty + 1;

      const bookRes = await client.query<{ id: string }>(
        `INSERT INTO voucher_books (tenant_id, outlet_id, buyer_name, buyer_phone, quantity, benefit_type, benefit_service_id, benefit_value, unit_price, expiry_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [
          tenantId, dto.outletId, dto.buyerName ?? null, dto.buyerPhone ?? null, qty,
          dto.benefitType ?? 'service', dto.benefitServiceId ?? null, dto.benefitValue ?? 0,
          dto.unitPrice ?? 0, dto.expiryDate ?? null,
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

      await client.query('COMMIT');

      // Best-effort WhatsApp delivery of the code list to the buyer.
      if (dto.buyerPhone && this.notifications) {
        try {
          await this.notifications.queueNotification(NotificationType.VoucherDelivery, {
            phone: dto.buyerPhone,
            tenantId,
            customerName: dto.buyerName ?? '',
            codes: codes.join(', '),
            quantity: qty,
          } as Record<string, unknown>);
        } catch { /* delivery is best-effort */ }
      }

      return { bookId, codes };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
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
    return this.mapTicket(res.rows[0]);
  }

  async listBooks(tenantId: string): Promise<Record<string, unknown>[]> {
    const res = await this.pool.query(
      `SELECT b.id, b.buyer_name, b.buyer_phone, b.quantity, b.benefit_type, b.unit_price, b.created_at,
              o.name AS outlet_name,
              COUNT(t.id) FILTER (WHERE t.status = 'redeemed')::int AS redeemed
       FROM voucher_books b
       JOIN outlets o ON o.id = b.outlet_id
       LEFT JOIN voucher_tickets t ON t.book_id = b.id
       WHERE b.tenant_id = $1
       GROUP BY b.id, o.name
       ORDER BY b.created_at DESC LIMIT 200`,
      [tenantId],
    );
    return res.rows.map((b) => ({
      id: b.id, buyerName: b.buyer_name, buyerPhone: b.buyer_phone, quantity: b.quantity,
      benefitType: b.benefit_type, unitPrice: parseFloat(b.unit_price), outletName: b.outlet_name,
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
