import { Injectable, Inject, Optional } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { JWTPayload, normalizePhone } from '@aire/shared';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';

export interface PackOrderResult {
  id: string;
  orderNumber: string;
  total: number;
  customerId: string;
}

/**
 * PosCheckoutService — shared helpers for selling non-service "packs"
 * (membership plans, voucher packs) through the POS.
 *
 * Creates the real customer and order records that the standard payment
 * flow (cash / QRIS sandbox / EDC / transfer) then settles. Packs are not
 * services, so the order carries no order_items; the pack price is recorded
 * directly as the order subtotal/total.
 */
@Injectable()
export class PosCheckoutService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  /**
   * Find or create a customer by normalized phone within the tenant.
   */
  async upsertCustomer(
    client: PoolClient,
    tenantId: string,
    name: string,
    phone: string,
    email?: string,
  ): Promise<string> {
    const { normalized } = normalizePhone(phone);
    const phoneNormalized = normalized || phone.replace(/\D/g, '');
    const cleanEmail = email?.trim() || null;

    // COALESCE keeps an existing email when a later sale omits it.
    // `xmax = 0` is true only for a freshly INSERTed row, letting us emit
    // CustomerCreated on genuine creation and stay silent on repeat sales.
    const res = await client.query<{ id: string; inserted: boolean }>(
      `INSERT INTO customers (tenant_id, name, phone, phone_normalized, email)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, phone_normalized)
       DO UPDATE SET name = EXCLUDED.name, email = COALESCE(EXCLUDED.email, customers.email), updated_at = NOW()
       RETURNING id, (xmax = 0) AS inserted`,
      [tenantId, name, phone, phoneNormalized, cleanEmail],
    );
    const row = res.rows[0]!;
    if (row.inserted) {
      void this.eventBus?.emit({
        type: DomainEventType.CustomerCreated,
        tenantId, actor: 'pos',
        payload: { customerId: row.id, name, phone: phoneNormalized },
      });
    }
    return row.id;
  }

  /**
   * Generate a sequential per-outlet daily order number: ORD-YYYYMMDD-NNN.
   */
  private async generateOrderNumber(client: PoolClient, outletId: string): Promise<string> {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const res = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM orders
       WHERE outlet_id = $1 AND DATE(created_at) = CURRENT_DATE`,
      [outletId],
    );
    const count = parseInt(res.rows[0]!.count, 10) + 1;
    return `ORD-${dateStr}-${count.toString().padStart(3, '0')}`;
  }

  /**
   * Create a pending order for a pack purchase (no line items) and log the
   * initial status. Returns the created order id/number/total plus customer id.
   * Runs inside the provided transaction client.
   */
  async createPackOrder(
    client: PoolClient,
    user: JWTPayload,
    params: { customerId: string; customerName: string; customerPhone: string; total: number; note: string },
  ): Promise<Omit<PackOrderResult, 'customerId'>> {
    const orderNumber = await this.generateOrderNumber(client, user.outlet_id!);
    const res = await client.query<{ id: string; order_number: string; total: string }>(
      `INSERT INTO orders
        (tenant_id, outlet_id, operator_id, customer_id, order_number, status,
         customer_name, customer_phone, subtotal, total, note)
       VALUES ($1, $2, $3, $4, $5, 'ordered', $6, $7, $8, $8, $9)
       RETURNING id, order_number, total`,
      [
        user.tenant_id,
        user.outlet_id,
        user.sub,
        params.customerId,
        orderNumber,
        params.customerName,
        params.customerPhone,
        params.total,
        params.note,
      ],
    );
    const order = res.rows[0]!;

    await client.query(
      `INSERT INTO order_status_logs (order_id, from_status, to_status, operator_id, created_at)
       VALUES ($1, 'ordered', 'ordered', $2, NOW())`,
      [order.id, user.sub],
    );

    return { id: order.id, orderNumber: order.order_number, total: parseFloat(order.total) };
  }

  /** Expose the pool for callers needing a transaction client. */
  get db(): Pool {
    return this.pool;
  }
}
