import { Injectable, Inject, Optional, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { normalizePlate } from '@aire/shared';
import { DATABASE_POOL } from '../auth/database.provider';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { NotificationRendererService, renderNotification } from '../notification/notification-renderer.service';

export interface QueueEntry {
  id: string; plate: string | null; brand: string | null; model: string | null;
  customerName: string | null; customerPhone: string | null; businessUnit: string | null;
  note: string | null; status: string; position: number; createdAt: string;
  /** Linked order (once rung up), or null if the car hasn't been ordered yet. */
  orderId: string | null;
  /** Derived from the linked order: 'paid' once the order is settled, else 'unpaid'. */
  paymentStatus: 'paid' | 'unpaid';
  /** When service began. Set on arrival — logging a car IS starting it (AIRIN-170). */
  startedAt: string | null;
  /** When it left the board, by hand or by the midnight sweep. */
  closedAt: string | null;
  /** Why it left without being served, when that is what happened (AIRIN-171). */
  closeReason: string | null;
  autoClosed: boolean;
  /**
   * The single stage the board shows, derived rather than stored: a cashier does
   * not care whether a row says 'waiting' or 'serving' — only whether the car
   * still owes money, is paid and awaiting handover, or is finished (AIRIN-170).
   */
  stage: 'waiting_payment' | 'paid' | 'done' | 'cancelled';
  /** Seconds from arrival to payment, once paid — the number the board is for. */
  serviceSeconds: number | null;
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
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() private readonly realtime?: RealtimeGateway,
    @Optional() private readonly whatsapp?: WhatsappService,
    @Optional() @Inject(NotificationRendererService) private readonly renderer?: NotificationRendererService,
  ) {}

  private readonly logger = new Logger(VehicleQueueService.name);

  /**
   * Push the current live queue for an outlet to the board / POS clients over
   * Socket.IO. Best-effort — a failed push must never break the mutation. Kept
   * a socket-only push (not a domain event) because queue churn is high-frequency
   * and low business value; the `queue:updated` room event is the right channel.
   */
  private async pushQueue(tenantId: string, outletId: string): Promise<void> {
    if (!this.realtime || !outletId) return;
    try {
      const entries = await this.list(tenantId, outletId);
      this.realtime.emitQueueUpdated(outletId, {
        queue: entries.map((e) => ({
          id: e.id,
          position: e.position,
          orderId: e.orderId ?? '',
          customerName: e.customerName ?? '',
          status: e.status,
        })),
      });
    } catch {
      /* telemetry push, never part of the transaction */
    }
  }

  async list(tenantId: string, outletId: string, includeDone = false): Promise<QueueEntry[]> {
    const statusFilter = includeDone ? '' : `AND vq.status IN ('waiting','serving')`;
    const res = await this.pool.query(
      `SELECT vq.*,
              CASE WHEN o.status IN ('paid','confirmed','completed') THEN 'paid'
                   ELSE 'unpaid' END AS payment_status,
              o.paid_at
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
    // Canonical plate on write. A car queued as "B 1234 ABC" used to be stored
    // with its spaces, so the POS's member lookup — which normalises before
    // matching — could not resolve the queued car to its membership, and the same
    // vehicle appeared under two spellings across queue and orders (AIRIN-117).
    const plate = dto.plate ? (normalizePlate(dto.plate).normalized || null) : null;
    // Arrival IS the start of service: a car is logged the moment it is taken in,
    // so a separate "Start" tap only ever recorded when the cashier got round to
    // pressing it. The status goes straight to 'serving' and the clock starts
    // here, which is what makes the arrival→payment duration real (AIRIN-170).
    const res = await this.pool.query(
      `INSERT INTO vehicle_queue (tenant_id, outlet_id, plate, brand, model, customer_name, customer_phone, business_unit, note, position, status, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'serving',NOW()) RETURNING *`,
      [tenantId, dto.outletId, plate, dto.brand ?? null, dto.model ?? null,
        dto.customerName ?? null, dto.customerPhone ?? null, dto.businessUnit ?? null, dto.note ?? null, position],
    );
    const entry = this.map(res.rows[0]);
    void this.pushQueue(tenantId, dto.outletId);
    return entry;
  }

  async setStatus(
    tenantId: string,
    id: string,
    status: 'waiting' | 'serving' | 'done' | 'cancelled',
    reason?: string,
  ): Promise<QueueEntry> {
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
    // A car leaving the board without being served owes an explanation — the
    // reason is kept on the row so tomorrow's shift can answer "what happened to
    // that Avanza?" (AIRIN-171).
    const closing = status === 'done' || status === 'cancelled';
    const res = await this.pool.query(
      `UPDATE vehicle_queue
          SET status = $3,
              closed_at = CASE WHEN $4::boolean THEN NOW() ELSE closed_at END,
              close_reason = COALESCE($5, close_reason),
              updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [id, tenantId, status, closing, reason ?? null],
    );
    if (res.rows.length === 0) throw new NotFoundException('Queue entry not found');
    const entry = this.map(res.rows[0]);
    void this.pushQueue(tenantId, res.rows[0].outlet_id);
    // "Mobil kakak sudah selesai" — the catalogue has always defined this message
    // (queue_completion) but nothing ever fired it. Marking the car done IS the
    // trigger. Best-effort: the board must update whether or not WhatsApp is up.
    if (status === 'done') void this.notifyCompletion(tenantId, res.rows[0]);
    return entry;
  }

  /**
   * Tell the customer their car is ready. Never throws and never blocks the
   * status change — a WhatsApp outage must not stop a cashier handing a car back.
   */
  private async notifyCompletion(
    tenantId: string,
    row: { customer_phone: string | null; customer_name: string | null; plate: string | null; outlet_id: string },
  ): Promise<void> {
    if (!this.whatsapp || !row.customer_phone) return;
    try {
      const outlet = await this.pool.query<{ name: string }>(
        `SELECT name FROM outlets WHERE id = $1`,
        [row.outlet_id],
      );
      const text = await renderNotification(this.renderer, tenantId, 'queue_completion', {
        customerName: row.customer_name ?? '',
        plate: row.plate ?? '',
        outletName: outlet.rows[0]?.name ?? '',
      });
      if (text) await this.whatsapp.sendText(tenantId, row.customer_phone, text, row.outlet_id);
    } catch (e) {
      this.logger.warn(`Queue completion notice failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * Close out every car still on the board, everywhere. Run at midnight: the
   * queue is a record of ONE trading day, and yesterday's leftovers pushed
   * today's positions along and made the board unreadable.
   *
   * Nothing is deleted. An unserved car is closed with an explicit reason so the
   * row survives as an account of what happened, which is the whole point —
   * "queue yang tidak diproses tetap perlu dicatat ke database beserta alasan
   * pertanggungjawabannya" (AIRIN-171). Cars that WERE paid for close as 'done';
   * only the ones nobody rang up are marked unserved.
   */
  async closeOutOpenEntries(reason = 'Auto-closed at end of day — never processed'): Promise<number> {
    const res = await this.pool.query<{ outlet_id: string; tenant_id: string }>(
      `UPDATE vehicle_queue vq
          SET status = CASE WHEN vq.order_id IS NOT NULL
                              AND (SELECT o.status FROM orders o WHERE o.id = vq.order_id)
                                  IN ('paid','confirmed','completed')
                            THEN 'done' ELSE 'cancelled' END,
              closed_at = NOW(),
              auto_closed = true,
              close_reason = CASE WHEN vq.order_id IS NOT NULL
                                   AND (SELECT o.status FROM orders o WHERE o.id = vq.order_id)
                                       IN ('paid','confirmed','completed')
                                  THEN COALESCE(vq.close_reason, 'Auto-closed at end of day — paid')
                                  ELSE $1 END,
              updated_at = NOW()
        WHERE vq.status IN ('waiting','serving')
      RETURNING vq.tenant_id, vq.outlet_id`,
      [reason],
    );
    // Refresh every board that changed, so a POS left open overnight shows the
    // cleared queue without a reload.
    const seen = new Set<string>();
    for (const row of res.rows) {
      const key = `${row.tenant_id}:${row.outlet_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      void this.pushQueue(row.tenant_id, row.outlet_id);
    }
    return res.rowCount ?? 0;
  }

  /** The stage the board shows — see QueueEntry.stage. */
  private stageOf(r: any, paid: boolean): QueueEntry['stage'] {
    if (r.status === 'cancelled') return 'cancelled';
    if (r.status === 'done') return 'done';
    return paid ? 'paid' : 'waiting_payment';
  }

  private map = (r: any): QueueEntry => {
    const paid = r.payment_status === 'paid';
    const startedAt = r.started_at ?? r.created_at ?? null;
    // Arrival → payment is the interval the shop actually manages. It stays
    // recorded even though the board no longer shows a 'start' step (AIRIN-170).
    const paidAt = r.paid_at ?? null;
    const serviceSeconds = startedAt && paidAt
      ? Math.max(0, Math.round((new Date(paidAt).getTime() - new Date(startedAt).getTime()) / 1000))
      : null;
    return {
      id: r.id, plate: r.plate ?? null, brand: r.brand ?? null, model: r.model ?? null,
      customerName: r.customer_name ?? null, customerPhone: r.customer_phone ?? null,
      businessUnit: r.business_unit ?? null, note: r.note ?? null, status: r.status,
      position: r.position ?? 0, createdAt: r.created_at,
      orderId: r.order_id ?? null,
      paymentStatus: paid ? 'paid' : 'unpaid',
      startedAt,
      closedAt: r.closed_at ?? null,
      closeReason: r.close_reason ?? null,
      autoClosed: r.auto_closed === true,
      stage: this.stageOf(r, paid),
      serviceSeconds,
    };
  };
}
