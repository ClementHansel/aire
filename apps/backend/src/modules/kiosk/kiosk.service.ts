import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

/**
 * Queue status returned for a customer checking their order via kiosk.
 */
export interface KioskQueueStatus {
  orderNumber: string;
  orderId: string;
  customerName: string;
  position: number;
  totalWaiting: number;
  estimatedWaitMinutes: number;
  status: 'waiting' | 'in_progress' | 'completed' | 'not_found';
  bayName?: string;
}

/** Average service time per vehicle in minutes (used for wait time estimation) */
const AVG_SERVICE_TIME_MINUTES = 15;

/** Public menu item for the customer-facing eMenu. */
export interface MenuItem {
  id: string;
  name: string;
  category: string;
  businessUnit: string;
  price: number;
  isMainService: boolean;
  /** False when the product's recipe can't be fulfilled from current stock
   *  (customer/kiosk channels block these; the POS is not gated). */
  available: boolean;
}

/** Public eMenu payload. */
export interface PublicMenu {
  tenantName: string;
  /** Wash/detail/add-on services (everything except retail products). */
  services: MenuItem[];
  /** Retail products (category='product') — sold from their own kiosk tab. */
  products: MenuItem[];
  plans: { name: string; durationMonths: number; price: number }[];
}

/**
 * Kiosk service providing self-service queue operations.
 *
 * - Queue status check by order number
 * - Join queue for a paid order
 *
 * Requirements: 27.1, 27.2, 27.3
 */
@Injectable()
export class KioskService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /**
   * Public customer-facing menu (eMenu): active services grouped by business
   * unit + active membership plans. Optionally scoped to a single outlet.
   * No authentication — published for QR/link sharing.
   */
  async getMenu(tenantId: string, outletId?: string): Promise<PublicMenu> {
    if (!tenantId || tenantId.trim() === '') {
      throw new BadRequestException('tenantId is required');
    }

    const tenant = await this.pool.query(`SELECT name FROM tenants WHERE id = $1`, [tenantId]);

    const serviceParams: unknown[] = [tenantId];
    let outletClause = '';
    if (outletId && outletId.trim() !== '') {
      serviceParams.push(outletId);
      outletClause = ` AND (outlet_id = $2 OR (outlet_id IS NULL AND (outlet_ids IS NULL OR outlet_ids = '{}')) OR $2 = ANY(outlet_ids))`;
    }

    const services = await this.pool.query(
      `SELECT id, name, category, business_unit, price, is_main_service
       FROM services
       WHERE tenant_id = $1 AND is_active = true${outletClause}
       ORDER BY business_unit, category, sort_order, name`,
      serviceParams,
    );

    const plans = await this.pool.query(
      `SELECT name, duration_months, price
       FROM membership_plans
       WHERE tenant_id = $1 AND is_active = true
       ORDER BY price`,
      [tenantId],
    );

    const outOfStock = await this.getOutOfStockServiceIds(tenantId);

    const items: MenuItem[] = services.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      businessUnit: r.business_unit,
      price: parseFloat(r.price),
      isMainService: r.is_main_service,
      available: !outOfStock.has(r.id),
    }));

    return {
      tenantName: tenant.rows[0]?.name ?? 'AIRE',
      // Split so the kiosk can sell products from a dedicated tab, like the POS.
      services: items.filter((i) => i.category !== 'product'),
      products: items.filter((i) => i.category === 'product'),
      plans: plans.rows.map((r: any) => ({
        name: r.name,
        durationMonths: r.duration_months,
        price: parseFloat(r.price),
      })),
    };
  }

  /**
   * Service ids whose recipe can't be fulfilled from current stock (need for one
   * unit exceeds available stock, unit-converted). Used to block ordering on the
   * customer/kiosk channels. Services with no recipe are always available.
   */
  async getOutOfStockServiceIds(tenantId: string): Promise<Set<string>> {
    const r = await this.pool.query<{ service_id: string }>(
      `SELECT DISTINCT rc.service_id
       FROM service_recipe_components rc
       JOIN inventory_items ii ON ii.id = rc.inventory_item_id
       LEFT JOIN uom_conversions uc
         ON uc.inventory_item_id = ii.id AND uc.from_unit = rc.unit AND uc.to_unit = ii.unit
       WHERE rc.tenant_id = $1
         AND (rc.quantity * COALESCE(CASE WHEN rc.unit = ii.unit THEN 1 ELSE uc.factor END, 1)) > ii.quantity`,
      [tenantId],
    );
    return new Set(r.rows.map((x) => x.service_id));
  }

  /**
   * Look up queue status by order number.
   * Returns position, estimated wait time, and current status.
   *
   * Requirement 27.3: Display queue position and estimated wait time after order.
   */
  async getQueueStatus(orderNumber: string): Promise<KioskQueueStatus> {
    if (!orderNumber || orderNumber.trim() === '') {
      throw new BadRequestException('Order number is required');
    }

    // Find the order and its live vehicle_queue entry (the resto-style arrival
    // board that POS + kiosk both write). status: waiting|serving|done|cancelled.
    const orderResult = await this.pool.query(
      `SELECT o.id, o.order_number, o.customer_name, o.outlet_id,
              vq.id AS queue_entry_id, vq.position, vq.status AS queue_status
       FROM orders o
       LEFT JOIN vehicle_queue vq ON vq.order_id = o.id
       WHERE o.order_number = $1
       ORDER BY vq.created_at DESC
       LIMIT 1`,
      [orderNumber.trim()],
    );

    if (orderResult.rows.length === 0) {
      return {
        orderNumber,
        orderId: '',
        customerName: '',
        position: 0,
        totalWaiting: 0,
        estimatedWaitMinutes: 0,
        status: 'not_found',
      };
    }

    const row = orderResult.rows[0];

    // If no queue entry exists
    if (!row.queue_entry_id) {
      return {
        orderNumber: row.order_number,
        orderId: row.id,
        customerName: row.customer_name,
        position: 0,
        totalWaiting: 0,
        estimatedWaitMinutes: 0,
        status: 'not_found',
      };
    }

    // Map vehicle_queue status to the kiosk contract (waiting/in_progress/completed).
    const raw = row.queue_status as string;
    const queueStatus: 'waiting' | 'in_progress' | 'completed' =
      raw === 'serving' ? 'in_progress' : raw === 'done' ? 'completed' : 'waiting';
    if (raw === 'cancelled') {
      return {
        orderNumber: row.order_number,
        orderId: row.id,
        customerName: row.customer_name,
        position: 0,
        totalWaiting: 0,
        estimatedWaitMinutes: 0,
        status: 'not_found',
      };
    }

    // Entries ahead in the same outlet (vehicle_queue has no priority — FIFO by position).
    const aheadResult = await this.pool.query(
      `SELECT COUNT(*) as count FROM vehicle_queue
       WHERE status = 'waiting' AND outlet_id = $1 AND position < $2`,
      [row.outlet_id, row.position],
    );

    const entriesAhead = parseInt(aheadResult.rows[0].count, 10);

    // Count total waiting
    const totalResult = await this.pool.query(
      `SELECT COUNT(*) as count FROM vehicle_queue
       WHERE status = 'waiting' AND outlet_id = $1`,
      [row.outlet_id],
    );

    const totalWaiting = parseInt(totalResult.rows[0].count, 10);

    // Estimate wait time based on position ahead
    const estimatedWaitMinutes = queueStatus === 'waiting'
      ? entriesAhead * AVG_SERVICE_TIME_MINUTES
      : 0;

    return {
      orderNumber: row.order_number,
      orderId: row.id,
      customerName: row.customer_name,
      position: queueStatus === 'waiting' ? entriesAhead + 1 : 0,
      totalWaiting,
      estimatedWaitMinutes,
      status: queueStatus,
    };
  }

}
