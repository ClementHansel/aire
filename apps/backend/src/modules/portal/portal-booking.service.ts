import { Inject, Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { normalizePlate } from '@aire/shared';
import { DATABASE_POOL } from '../auth/database.provider';
import { WhatsappService } from '../whatsapp';

const APP_URL = process.env.APP_PUBLIC_URL || 'https://app.useairin.id';

export interface CreatePortalBookingDto {
  outletId: string;
  serviceId?: string;
  scheduledAt: string;
  plate?: string;
  brand?: string;
  model?: string;
  notes?: string;
}

/**
 * Portal bookings with a per-branch WhatsApp confirm gate. A booking is created
 * `pending`, and a confirm/reject link is sent to the branch's WhatsApp (outlet
 * phone = cashier). Only when the cashier confirms is a queue entry created and
 * the customer notified. Falls back to the dashboard Bookings page (which can
 * also confirm) if the branch has no WhatsApp number.
 */
@Injectable()
export class PortalBookingService {
  private readonly logger = new Logger(PortalBookingService.name);

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly whatsapp: WhatsappService,
  ) {}

  async list(tenantId: string, customerId: string) {
    const r = await this.pool.query(
      `SELECT b.id, b.service_name, b.scheduled_at, b.status, b.license_plate, o.name AS outlet_name
         FROM bookings b LEFT JOIN outlets o ON o.id = b.outlet_id
        WHERE b.tenant_id = $1 AND b.customer_id = $2
        ORDER BY b.scheduled_at DESC LIMIT 50`,
      [tenantId, customerId],
    );
    return r.rows.map((b) => ({
      id: b.id, serviceName: b.service_name, scheduledAt: b.scheduled_at instanceof Date ? b.scheduled_at.toISOString() : b.scheduled_at,
      status: b.status, plate: b.license_plate, outletName: b.outlet_name,
    }));
  }

  async create(tenantId: string, customerId: string, dto: CreatePortalBookingDto) {
    if (!dto.outletId || !dto.scheduledAt) throw new BadRequestException('Branch and date/time are required');
    const cust = await this.pool.query<{ name: string; phone: string }>(
      `SELECT name, phone FROM customers WHERE id = $1 AND tenant_id = $2`, [customerId, tenantId],
    );
    if (cust.rows.length === 0) throw new NotFoundException('Customer not found');
    const outlet = await this.pool.query<{ name: string; phone: string | null }>(
      `SELECT name, phone FROM outlets WHERE id = $1 AND tenant_id = $2`, [dto.outletId, tenantId],
    );
    if (outlet.rows.length === 0) throw new BadRequestException('Unknown branch');
    let serviceName: string | null = null;
    if (dto.serviceId) {
      const s = await this.pool.query<{ name: string }>(`SELECT name FROM services WHERE id = $1 AND tenant_id = $2`, [dto.serviceId, tenantId]);
      serviceName = s.rows[0]?.name ?? null;
    }

    const token = randomBytes(18).toString('hex');
    // Canonical plate on write, matching the POS and membership paths — a booking
    // made from the portal as "B 1234 ABC" must resolve to the same vehicle the
    // cashier later looks up as "B1234ABC" (AIRIN-117).
    const plate = dto.plate ? (normalizePlate(dto.plate).normalized || null) : null;
    const ins = await this.pool.query<{ id: string }>(
      `INSERT INTO bookings
        (tenant_id, outlet_id, customer_id, customer_name, customer_phone, license_plate, service_id, service_name, scheduled_at, notes, status, confirmation_token, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,'portal') RETURNING id`,
      [tenantId, dto.outletId, customerId, cust.rows[0]!.name, cust.rows[0]!.phone, plate,
        dto.serviceId ?? null, serviceName, dto.scheduledAt, dto.notes ?? null, token],
    );

    // Notify the branch cashier on WhatsApp with confirm/reject links.
    const when = new Date(dto.scheduledAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
    const cashierPhone = outlet.rows[0]!.phone;
    if (cashierPhone) {
      const link = `${APP_URL}/confirm-booking/${token}`;
      const msg = [
        `📅 *Booking baru* — ${outlet.rows[0]!.name}`,
        // Canonical plate, so the cashier sees the same spelling that was stored.
        `${cust.rows[0]!.name}${plate ? ` · ${plate}` : ''}`,
        serviceName ? `Layanan: ${serviceName}` : null,
        `Waktu: ${when}`,
        ``,
        `Konfirmasi / tolak: ${link}`,
      ].filter(Boolean).join('\n');
      const sent = await this.whatsapp.sendText(tenantId, cashierPhone, msg);
      if (!sent) this.logger.warn(`Booking confirm WA not sent for tenant ${tenantId} (WhatsApp disconnected) — confirm via dashboard`);
    } else {
      this.logger.warn(`Branch ${dto.outletId} has no WhatsApp number — booking must be confirmed from the dashboard`);
    }
    return { id: ins.rows[0]!.id, status: 'pending' };
  }

  /** Public confirm-page detail (by token). */
  async getByToken(token: string) {
    const r = await this.pool.query(
      `SELECT b.id, b.customer_name, b.license_plate, b.service_name, b.scheduled_at, b.status, o.name AS outlet_name
         FROM bookings b LEFT JOIN outlets o ON o.id = b.outlet_id
        WHERE b.confirmation_token = $1 LIMIT 1`,
      [token],
    );
    if (r.rows.length === 0) throw new NotFoundException('Booking not found');
    const b = r.rows[0];
    return {
      customerName: b.customer_name, plate: b.license_plate, serviceName: b.service_name,
      scheduledAt: b.scheduled_at instanceof Date ? b.scheduled_at.toISOString() : b.scheduled_at,
      status: b.status, outletName: b.outlet_name,
    };
  }

  /** Cashier confirms → create the queue entry + notify the customer. Idempotent. */
  async confirm(token: string): Promise<{ ok: true; status: string }> {
    const r = await this.pool.query(
      `SELECT id, tenant_id, outlet_id, customer_name, customer_phone, license_plate, service_name, status, queue_entry_id
         FROM bookings WHERE confirmation_token = $1 LIMIT 1`,
      [token],
    );
    if (r.rows.length === 0) throw new NotFoundException('Booking not found');
    const b = r.rows[0];
    if (b.status === 'confirmed' && b.queue_entry_id) return { ok: true, status: 'confirmed' };
    if (b.status === 'rejected') throw new BadRequestException('This booking was already rejected.');

    const pos = await this.pool.query<{ next: number }>(
      `SELECT COALESCE(MAX(position),0)+1 AS next FROM vehicle_queue WHERE outlet_id = $1 AND status IN ('waiting','serving')`,
      [b.outlet_id],
    );
    const q = await this.pool.query<{ id: string }>(
      `INSERT INTO vehicle_queue (tenant_id, outlet_id, plate, customer_name, customer_phone, business_unit, note, position)
       VALUES ($1,$2,$3,$4,$5,'AIRE',$6,$7) RETURNING id`,
      [b.tenant_id, b.outlet_id, b.license_plate ?? null,
        b.customer_name ?? null, b.customer_phone ?? null, b.service_name ? `Booking: ${b.service_name}` : 'Booking', pos.rows[0]?.next ?? 1],
    );
    await this.pool.query(
      `UPDATE bookings SET status = 'confirmed', queue_entry_id = $2, updated_at = NOW() WHERE id = $1`,
      [b.id, q.rows[0]!.id],
    );
    if (b.customer_phone) {
      await this.whatsapp.sendText(b.tenant_id, b.customer_phone, `✅ Booking Anda dikonfirmasi. Mobil Anda telah masuk antrian. Sampai jumpa!`).catch(() => undefined);
    }
    return { ok: true, status: 'confirmed' };
  }

  /** Cashier rejects → notify the customer. */
  async reject(token: string): Promise<{ ok: true; status: string }> {
    const r = await this.pool.query<{ id: string; tenant_id: string; customer_phone: string | null; status: string }>(
      `SELECT id, tenant_id, customer_phone, status FROM bookings WHERE confirmation_token = $1 LIMIT 1`,
      [token],
    );
    if (r.rows.length === 0) throw new NotFoundException('Booking not found');
    const b = r.rows[0]!;
    if (b.status === 'confirmed') throw new BadRequestException('This booking was already confirmed.');
    await this.pool.query(`UPDATE bookings SET status = 'rejected', updated_at = NOW() WHERE id = $1`, [b.id]);
    if (b.customer_phone) {
      await this.whatsapp.sendText(b.tenant_id, b.customer_phone, `Maaf, booking Anda belum dapat dikonfirmasi. Silakan hubungi kami atau coba waktu lain.`).catch(() => undefined);
    }
    return { ok: true, status: 'rejected' };
  }
}
