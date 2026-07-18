import { Injectable, Inject, Optional, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';

export type BookingStatus = 'booked' | 'confirmed' | 'done' | 'cancelled';
const STATUSES: BookingStatus[] = ['booked', 'confirmed', 'done', 'cancelled'];

export interface BookingRecord {
  id: string;
  outletId: string | null;
  outletName: string | null;
  customerName: string;
  customerPhone: string | null;
  licensePlate: string | null;
  serviceId: string | null;
  serviceName: string | null;
  scheduledAt: string;
  status: BookingStatus;
  notes: string | null;
  createdAt: string;
}

export interface CreateBookingDto {
  outletId?: string | null;
  customerName: string;
  customerPhone?: string | null;
  licensePlate?: string | null;
  serviceId?: string | null;
  serviceName?: string | null;
  scheduledAt: string;
  notes?: string | null;
}

export interface UpdateBookingDto extends Partial<CreateBookingDto> {
  status?: BookingStatus;
}

const COLS = `b.id, b.outlet_id, b.customer_name, b.customer_phone, b.license_plate,
  b.service_id, b.service_name, b.scheduled_at, b.status, b.notes, b.created_at, o.name AS outlet_name`;

@Injectable()
export class BookingService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  private map(r: any): BookingRecord {
    return {
      id: r.id,
      outletId: r.outlet_id,
      outletName: r.outlet_name ?? null,
      customerName: r.customer_name,
      customerPhone: r.customer_phone,
      licensePlate: r.license_plate,
      serviceId: r.service_id,
      serviceName: r.service_name,
      scheduledAt: r.scheduled_at instanceof Date ? r.scheduled_at.toISOString() : r.scheduled_at,
      status: r.status,
      notes: r.notes,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    };
  }

  async list(tenantId: string, status?: string, outletIds?: string[] | null): Promise<BookingRecord[]> {
    const params: unknown[] = [tenantId];
    let where = 'b.tenant_id = $1';
    if (status && STATUSES.includes(status as BookingStatus)) {
      params.push(status);
      where += ` AND b.status = $${params.length}`;
    }
    if (outletIds != null) {
      params.push(outletIds);
      where += ` AND b.outlet_id = ANY($${params.length}::uuid[])`;
    }
    const res = await this.pool.query(
      `SELECT ${COLS} FROM bookings b
       LEFT JOIN outlets o ON o.id = b.outlet_id
       WHERE ${where}
       ORDER BY b.scheduled_at DESC`,
      params,
    );
    return res.rows.map((r) => this.map(r));
  }

  async create(tenantId: string, dto: CreateBookingDto): Promise<BookingRecord> {
    if (!dto.customerName?.trim()) throw new BadRequestException('customerName is required');
    if (!dto.scheduledAt) throw new BadRequestException('scheduledAt is required');
    const res = await this.pool.query(
      `INSERT INTO bookings
        (tenant_id, outlet_id, customer_name, customer_phone, license_plate, service_id, service_name, scheduled_at, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        tenantId,
        dto.outletId ?? null,
        dto.customerName.trim(),
        dto.customerPhone ?? null,
        dto.licensePlate ?? null,
        dto.serviceId ?? null,
        dto.serviceName ?? null,
        dto.scheduledAt,
        dto.notes ?? null,
      ],
    );
    const booking = await this.getOne(tenantId, res.rows[0].id);
    void this.eventBus?.emit({
      type: DomainEventType.BookingCreated,
      tenantId, outletId: booking.outletId, actor: 'staff',
      payload: { bookingId: booking.id, customerName: booking.customerName, serviceId: booking.serviceId, scheduledAt: booking.scheduledAt },
    });
    return booking;
  }

  async getOne(tenantId: string, id: string): Promise<BookingRecord> {
    const res = await this.pool.query(
      `SELECT ${COLS} FROM bookings b LEFT JOIN outlets o ON o.id = b.outlet_id
       WHERE b.id = $1 AND b.tenant_id = $2`,
      [id, tenantId],
    );
    if (res.rows.length === 0) throw new NotFoundException('Booking not found');
    return this.map(res.rows[0]);
  }

  async update(tenantId: string, id: string, dto: UpdateBookingDto): Promise<BookingRecord> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    const push = (col: string, v: unknown) => { sets.push(`${col} = $${i++}`); vals.push(v); };
    if (dto.outletId !== undefined) push('outlet_id', dto.outletId);
    if (dto.customerName !== undefined) push('customer_name', dto.customerName);
    if (dto.customerPhone !== undefined) push('customer_phone', dto.customerPhone);
    if (dto.licensePlate !== undefined) push('license_plate', dto.licensePlate);
    if (dto.serviceId !== undefined) push('service_id', dto.serviceId);
    if (dto.serviceName !== undefined) push('service_name', dto.serviceName);
    if (dto.scheduledAt !== undefined) push('scheduled_at', dto.scheduledAt);
    if (dto.notes !== undefined) push('notes', dto.notes);
    if (dto.status !== undefined) {
      if (!STATUSES.includes(dto.status)) throw new BadRequestException('Invalid status');
      push('status', dto.status);
    }
    if (sets.length === 0) return this.getOne(tenantId, id);
    vals.push(id, tenantId);
    const res = await this.pool.query(
      `UPDATE bookings SET ${sets.join(', ')} WHERE id = $${i++} AND tenant_id = $${i}`,
      vals,
    );
    if (res.rowCount === 0) throw new NotFoundException('Booking not found');
    const booking = await this.getOne(tenantId, id);
    // A status move to 'cancelled' is a distinct lifecycle signal; everything
    // else is a generic update.
    void this.eventBus?.emit({
      type: dto.status === 'cancelled' ? DomainEventType.BookingCancelled : DomainEventType.BookingUpdated,
      tenantId, outletId: booking.outletId, actor: 'staff',
      payload: { bookingId: booking.id, status: booking.status },
    });
    return booking;
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const res = await this.pool.query(`DELETE FROM bookings WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    if (res.rowCount === 0) throw new NotFoundException('Booking not found');
    void this.eventBus?.emit({
      type: DomainEventType.BookingCancelled,
      tenantId, actor: 'staff',
      payload: { bookingId: id, deleted: true },
    });
  }
}
