import { Injectable, Inject, Optional } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { JWTPayload, normalizePhone, normalizePlate } from '@aire/shared';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';

/**
 * Find or create a customer by normalized phone, on a caller-supplied client so
 * it joins the caller's transaction.
 *
 * Standalone rather than a method because both PosCheckoutService (pack sales)
 * and OrderService (ordinary POS checkout) need it, and OrderService reaching
 * for it via DI would mean an optional injection that silently no-ops when
 * unwired — the failure mode being fixed here is precisely "customers were never
 * created", so it must not be able to fail quietly again.
 *
 * Returns `inserted` so the caller can emit CustomerCreated only on genuine
 * creation; each caller owns its own event bus.
 */
export async function upsertCustomerRow(
  client: PoolClient,
  tenantId: string,
  name: string,
  phone: string,
  email?: string,
): Promise<{ id: string; inserted: boolean; phoneNormalized: string }> {
  const { normalized } = normalizePhone(phone);
  const phoneNormalized = normalized || phone.replace(/\D/g, '');
  const cleanEmail = email?.trim() || null;

  // COALESCE keeps an existing email when a later sale omits it.
  // `xmax = 0` is true only for a freshly INSERTed row, letting the caller emit
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
  return { id: row.id, inserted: row.inserted, phoneNormalized };
}

export interface PackOrderResult {
  id: string;
  orderNumber: string;
  total: number;
  customerId: string;
  licensePlate?: string;
  vehicleBrand?: string;
  vehicleModel?: string;
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
    const row = await upsertCustomerRow(client, tenantId, name, phone, email);
    if (row.inserted) {
      void this.eventBus?.emit({
        type: DomainEventType.CustomerCreated,
        tenantId, actor: 'pos',
        payload: { customerId: row.id, name, phone: row.phoneNormalized },
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
   * Create an order for a pack purchase (no line items) and log the initial
   * status. Returns the created order id/number/total plus customer id.
   * Runs inside the provided transaction client.
   *
   * By default the order is created pending ('ordered') and settled later by the
   * standard payment flow. Pass `paidNow: true` to create it already settled
   * ('paid', with payment_method/amount_received/paid_at) — used when the sale is
   * a completed cash transaction (e.g. shareable voucher books, where codes are
   * delivered at sell time). NOTE: `paidNow` writes the paid row but does NOT emit
   * OrderPaid — the caller must emit it AFTER COMMIT so the accounting poster (which
   * reads the committed order) does not race the transaction.
   */
  async createPackOrder(
    client: PoolClient,
    user: JWTPayload,
    params: {
      customerId: string | null;
      customerName: string;
      customerPhone: string;
      total: number;
      note: string;
      paidNow?: boolean;
      paymentMethod?: string;
      /** Vehicle captured at sale time (e.g. membership sign-up) — stored on
       *  the order so the plate-registration step can pre-fill from it. */
      licensePlate?: string;
      vehicleBrand?: string;
      vehicleModel?: string;
    },
  ): Promise<Omit<PackOrderResult, 'customerId'>> {
    const orderNumber = await this.generateOrderNumber(client, user.outlet_id!);
    const paidNow = params.paidNow === true;
    const status = paidNow ? 'paid' : 'ordered';
    const paymentMethod = paidNow ? (params.paymentMethod ?? 'cash') : null;
    const amountReceived = paidNow ? params.total : null;
    const licensePlate = params.licensePlate?.trim() || null;
    // Pack sales (membership / voucher packs) write plates too, so they need the
    // same canonical form as ordinary checkout — otherwise plate search finds a
    // customer's wash orders but not the membership they bought (AIRIN-117).
    const plateNormalized = licensePlate ? (normalizePlate(licensePlate).normalized || null) : null;
    const vehicleBrand = params.vehicleBrand?.trim() || null;
    const vehicleModel = params.vehicleModel?.trim() || null;

    const res = await client.query<{
      id: string; order_number: string; total: string;
      license_plate: string | null; vehicle_brand: string | null; vehicle_model: string | null;
    }>(
      `INSERT INTO orders
        (tenant_id, outlet_id, operator_id, customer_id, order_number, status,
         customer_name, customer_phone, license_plate, plate_normalized, vehicle_brand, vehicle_model,
         subtotal, total, note, payment_method, amount_received, paid_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13, $14, $15, $16,
               CASE WHEN $17 THEN NOW() ELSE NULL END)
       RETURNING id, order_number, total, license_plate, vehicle_brand, vehicle_model`,
      [
        user.tenant_id,
        user.outlet_id,
        user.sub,
        params.customerId,
        orderNumber,
        status,
        params.customerName,
        params.customerPhone,
        licensePlate,
        plateNormalized,
        vehicleBrand,
        vehicleModel,
        params.total,
        params.note,
        paymentMethod,
        amountReceived,
        paidNow,
      ],
    );
    const order = res.rows[0]!;

    await client.query(
      `INSERT INTO order_status_logs (order_id, from_status, to_status, operator_id, created_at)
       VALUES ($1, 'ordered', $2, $3, NOW())`,
      [order.id, status, user.sub],
    );

    return {
      id: order.id,
      orderNumber: order.order_number,
      total: parseFloat(order.total),
      licensePlate: order.license_plate ?? undefined,
      vehicleBrand: order.vehicle_brand ?? undefined,
      vehicleModel: order.vehicle_model ?? undefined,
    };
  }

  /** Expose the pool for callers needing a transaction client. */
  get db(): Pool {
    return this.pool;
  }
}
