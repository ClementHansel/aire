import { Inject, Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

export interface PortalOrder {
  orderNumber: string;
  date: string;
  total: number;
  status: string;
  services: string | null;
}
export interface PortalBranch { id: string; name: string }
export interface PortalQueueEntry { position: number; plate: string | null; vehicle: string | null; status: string; mine: boolean }

/**
 * Read models for the customer portal — visit history, branches, and the live
 * per-branch queue (sanitized: no other customers' names/phones).
 */
@Injectable()
export class PortalDataService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /**
   * Update the signed-in customer's own editable profile. Only the display name
   * is editable here — the phone number is the portal's login identity (OTP), so
   * it is deliberately not changeable from self-service.
   */
  async updateProfile(tenantId: string, customerId: string, dto: { name?: string }): Promise<{ id: string; name: string }> {
    const name = dto?.name?.trim();
    if (!name) throw new BadRequestException('name is required');
    const res = await this.pool.query<{ id: string; name: string }>(
      `UPDATE customers SET name = $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3 RETURNING id, name`,
      [name, customerId, tenantId],
    );
    if (res.rows.length === 0) throw new NotFoundException('Customer not found');
    return res.rows[0]!;
  }

  /** Resolve the membership a self-service vehicle should attach to: the
   *  customer's active membership, else their most recent one. Null if none. */
  private async resolveMembershipForVehicle(tenantId: string, customerId: string): Promise<string | null> {
    const r = await this.pool.query<{ id: string }>(
      `SELECT id FROM memberships
       WHERE tenant_id = $1 AND customer_id = $2
       ORDER BY (status = 'active') DESC, created_at DESC LIMIT 1`,
      [tenantId, customerId],
    );
    return r.rows[0]?.id ?? null;
  }

  /** Register a vehicle/plate on the customer's membership (portal self-service). */
  async addVehicle(
    tenantId: string, customerId: string, dto: { plate?: string; brand?: string; model?: string },
  ): Promise<{ plate: string; brand: string | null; model: string | null }> {
    const plate = dto?.plate?.trim();
    if (!plate) throw new BadRequestException('plate is required');
    const membershipId = await this.resolveMembershipForVehicle(tenantId, customerId);
    if (!membershipId) throw new BadRequestException('You need an active membership to register a vehicle.');
    const normalized = plate.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    // Dedupe within the membership.
    const dup = await this.pool.query(
      `SELECT 1 FROM membership_plates WHERE membership_id = $1 AND plate_normalized = $2`,
      [membershipId, normalized],
    );
    if (dup.rows.length > 0) throw new BadRequestException('That plate is already registered.');
    const res = await this.pool.query<{ plate: string; brand: string | null; model: string | null }>(
      `INSERT INTO membership_plates (membership_id, plate, plate_normalized, brand, model)
       VALUES ($1, $2, $3, $4, $5) RETURNING plate, brand, model`,
      [membershipId, plate.toUpperCase(), normalized, dto.brand?.trim() || null, dto.model?.trim() || null],
    );
    return res.rows[0]!;
  }

  /** Remove a vehicle/plate that belongs to one of the customer's memberships. */
  async deleteVehicle(tenantId: string, customerId: string, plate: string): Promise<{ deleted: boolean }> {
    const normalized = (plate ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (!normalized) throw new BadRequestException('plate is required');
    const res = await this.pool.query(
      `DELETE FROM membership_plates mp
       USING memberships m
       WHERE mp.membership_id = m.id
         AND m.tenant_id = $1 AND m.customer_id = $2
         AND mp.plate_normalized = $3`,
      [tenantId, customerId, normalized],
    );
    if (res.rowCount === 0) throw new NotFoundException('Vehicle not found');
    return { deleted: true };
  }

  /** The customer's own order/visit history (newest first). */
  async orders(tenantId: string, customerId: string): Promise<PortalOrder[]> {
    const res = await this.pool.query(
      `SELECT o.order_number, o.created_at, o.total, o.status,
              (SELECT string_agg(s.name, ', ')
                 FROM order_items oi JOIN services s ON s.id = oi.service_id
                WHERE oi.order_id = o.id) AS services
         FROM orders o
        WHERE o.tenant_id = $1 AND o.customer_id = $2
        ORDER BY o.created_at DESC
        LIMIT 50`,
      [tenantId, customerId],
    );
    return res.rows.map((r) => ({
      orderNumber: r.order_number,
      date: r.created_at,
      total: Number(r.total),
      status: r.status,
      services: r.services ?? null,
    }));
  }

  /** Active branches for the tenant (for the queue/booking dropdowns). */
  async branches(tenantId: string): Promise<PortalBranch[]> {
    const res = await this.pool.query(
      `SELECT id, name FROM outlets WHERE tenant_id = $1 AND is_active = true ORDER BY name`,
      [tenantId],
    );
    return res.rows.map((r) => ({ id: r.id, name: r.name }));
  }

  /** Live queue for a branch — position/plate/vehicle/status only; `mine` flags
   *  the signed-in customer's own cars (matched by their registered plates). */
  async queue(tenantId: string, outletId: string, customerId: string): Promise<PortalQueueEntry[]> {
    const [q, plates] = await Promise.all([
      this.pool.query(
        `SELECT position, plate, brand, model, status
           FROM vehicle_queue
          WHERE tenant_id = $1 AND outlet_id = $2 AND status IN ('waiting','serving')
          ORDER BY position ASC, created_at ASC
          LIMIT 100`,
        [tenantId, outletId],
      ),
      this.pool.query<{ plate_normalized: string }>(
        `SELECT DISTINCT mp.plate_normalized
           FROM membership_plates mp JOIN memberships m ON m.id = mp.membership_id
          WHERE m.tenant_id = $1 AND m.customer_id = $2`,
        [tenantId, customerId],
      ),
    ]);
    const mine = new Set(plates.rows.map((p) => p.plate_normalized));
    const norm = (s: string | null) => (s ?? '').replace(/\s|-/g, '').toUpperCase();
    return q.rows.map((r) => ({
      position: r.position ?? 0,
      plate: r.plate ?? null,
      vehicle: [r.brand, r.model].filter(Boolean).join(' ') || null,
      status: r.status,
      mine: mine.has(norm(r.plate)),
    }));
  }
}
