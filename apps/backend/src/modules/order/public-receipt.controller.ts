import { Controller, Get, Inject, NotFoundException, Param } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

/**
 * Public, no-auth order receipt/invoice — reached from the link sent to the
 * customer's WhatsApp after payment (see PaymentNotifyService). The unguessable
 * `public_token` (migration 075) is the only credential, mirroring
 * PublicBookingController's no-auth token pattern.
 */
@Controller('api/public/receipt')
export class PublicReceiptController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get(':token')
  async get(@Param('token') token: string) {
    const ord = await this.pool.query<{
      order_number: string; created_at: string; total: string; subtotal: string;
      payment_method: string | null; customer_name: string; tenant_name: string; outlet_name: string | null;
    }>(
      `SELECT o.order_number, o.created_at, o.total::text, o.subtotal::text, o.payment_method,
              o.customer_name, t.name AS tenant_name, ou.name AS outlet_name
       FROM orders o
       JOIN tenants t ON t.id = o.tenant_id
       LEFT JOIN outlets ou ON ou.id = o.outlet_id
       WHERE o.public_token = $1`,
      [token],
    );
    const o = ord.rows[0];
    if (!o) throw new NotFoundException('Receipt not found');

    const items = await this.pool.query<{ service_name: string; quantity: number; unit_price: string; subtotal: string }>(
      `SELECT s.name AS service_name, oi.quantity, oi.unit_price::text, oi.subtotal::text
       FROM order_items oi JOIN services s ON s.id = oi.service_id
       JOIN orders o ON o.id = oi.order_id
       WHERE o.public_token = $1
       ORDER BY oi.sort_order ASC`,
      [token],
    );

    return {
      orderNumber: o.order_number,
      createdAt: o.created_at,
      branchName: o.outlet_name ?? null,
      tenantName: o.tenant_name,
      customerName: o.customer_name,
      paymentMethod: o.payment_method ?? null,
      subtotal: Number(o.subtotal),
      total: Number(o.total),
      items: items.rows.map((i) => ({
        serviceName: i.service_name,
        quantity: i.quantity,
        unitPrice: Number(i.unit_price),
        subtotal: Number(i.subtotal),
      })),
    };
  }
}
