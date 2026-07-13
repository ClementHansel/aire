import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

export interface QueueEntry {
  id: string; plate: string | null; brand: string | null; model: string | null;
  customerName: string | null; customerPhone: string | null; businessUnit: string | null;
  note: string | null; status: string; position: number; createdAt: string;
  /** Linked order (once rung up), or null if the car hasn't been ordered yet. */
  orderId: string | null;
  /** Derived from the linked order: 'paid' once the order is settled, else 'unpaid'. */
  paymentStatus: 'paid' | 'unpaid';
}

export interface AddArrivalDto {
  outletId: string; plate?: string; brand?: string; model?: string;
  customerName?: string; customerPhone?: string; businessUnit?: 'AIRE' | 'LEAD'; note?: string;
}

/**
 * Resto-style arrival queue: cars are logged on arrival in order; product +
 * payment are completed later. Self-contained (no order required up front).
 */
@Injectable()
export class VehicleQueueService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async list(tenantId: string, outletId: string, includeDone = false): Promise<QueueEntry[]> {
    const statusFilter = includeDone ? '' : `AND vq.status IN ('waiting','serving')`;
    const res = await this.pool.query(
      `SELECT vq.*,
              CASE WHEN o.status IN ('paid','confirmed','completed') THEN 'paid'
                   ELSE 'unpaid' END AS payment_status
       FROM vehicle_queue vq
       LEFT JOIN orders o ON o.id = vq.order_id
       WHERE vq.tenant_id = $1 AND vq.outlet_id = $2 ${statusFilter}
       ORDER BY (vq.status = 'done') ASC, vq.position ASC, vq.created_at ASC LIMIT 200`,
      [tenantId, outletId],
    );
    return res.rows.map(this.map);
  }

  async add(tenantId: string, dto: AddArrivalDto): Promise<QueueEntry> {
    if (!dto.outletId) throw new BadRequestException('outletId is required');
    const posRes = await this.pool.query<{ next: number }>(
      `SELECT COALESCE(MAX(position), 0) + 1 AS next FROM vehicle_queue
       WHERE outlet_id = $1 AND status IN ('waiting','serving')`,
      [dto.outletId],
    );
    const position = posRes.rows[0]?.next ?? 1;
    const res = await this.pool.query(
      `INSERT INTO vehicle_queue (tenant_id, outlet_id, plate, brand, model, customer_name, customer_phone, business_unit, note, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [tenantId, dto.outletId, dto.plate ?? null, dto.brand ?? null, dto.model ?? null,
        dto.customerName ?? null, dto.customerPhone ?? null, dto.businessUnit ?? null, dto.note ?? null, position],
    );
    return this.map(res.rows[0]);
  }

  async setStatus(tenantId: string, id: string, status: 'waiting' | 'serving' | 'done' | 'cancelled'): Promise<QueueEntry> {
    // A car can't be marked done until it has been paid for (payment ≠ service,
    // but "done" is the hand-back point, so it gates on a paid linked order).
    if (status === 'done') {
      const chk = await this.pool.query<{ order_status: string | null }>(
        `SELECT o.status AS order_status
         FROM vehicle_queue vq LEFT JOIN orders o ON o.id = vq.order_id
         WHERE vq.id = $1 AND vq.tenant_id = $2`,
        [id, tenantId],
      );
      const os = chk.rows[0]?.order_status;
      if (!os || !['paid', 'confirmed', 'completed'].includes(os)) {
        throw new BadRequestException('Collect payment before marking this car done.');
      }
    }
    const res = await this.pool.query(
      `UPDATE vehicle_queue SET status = $3, updated_at = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [id, tenantId, status],
    );
    if (res.rows.length === 0) throw new NotFoundException('Queue entry not found');
    return this.map(res.rows[0]);
  }

  private map = (r: any): QueueEntry => ({
    id: r.id, plate: r.plate ?? null, brand: r.brand ?? null, model: r.model ?? null,
    customerName: r.customer_name ?? null, customerPhone: r.customer_phone ?? null,
    businessUnit: r.business_unit ?? null, note: r.note ?? null, status: r.status,
    position: r.position ?? 0, createdAt: r.created_at,
    orderId: r.order_id ?? null,
    paymentStatus: r.payment_status === 'paid' ? 'paid' : 'unpaid',
  });
}
