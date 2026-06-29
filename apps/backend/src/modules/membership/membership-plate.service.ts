import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import {
  ERR_MEMBERSHIP_NOT_FOUND,
  ERR_MEMBERSHIP_MAX_PLATES_EXCEEDED,
  normalizePlate,
} from '@aire/shared';
import { MembershipPlate, MembershipPlateRow } from './interfaces';

@Injectable()
export class MembershipPlateService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /**
   * Add a plate to a membership, enforcing max_plates limit.
   * Normalizes the plate value before storage and creates an audit log entry.
   */
  async addPlate(
    membershipId: string,
    plate: string,
    brand?: string,
    model?: string,
    operatorId?: string,
  ): Promise<MembershipPlate> {
    const maxPlates = await this.getMaxPlatesForMembership(membershipId);
    const currentCount = await this.getPlateCount(membershipId);

    if (currentCount >= maxPlates) {
      throw new BadRequestException(ERR_MEMBERSHIP_MAX_PLATES_EXCEEDED);
    }

    const { normalized } = normalizePlate(plate);
    if (!normalized) {
      throw new BadRequestException('Invalid plate value');
    }

    const result = await this.pool.query<MembershipPlateRow>(
      `INSERT INTO membership_plates (membership_id, plate, plate_normalized, brand, model)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [membershipId, plate, normalized, brand ?? null, model ?? null],
    );

    const newPlate = this.mapRowToEntity(result.rows[0]!);

    await this.createAuditLog(
      membershipId,
      operatorId ?? null,
      'plate_added',
      null,
      { plate: newPlate.plate, plateNormalized: newPlate.plateNormalized, brand, model },
    );

    return newPlate;
  }

  /**
   * Update an existing plate. Normalizes the new plate value and creates an audit log entry.
   */
  async updatePlate(
    plateId: string,
    plate: string,
    brand?: string,
    model?: string,
    operatorId?: string,
  ): Promise<MembershipPlate> {
    // Fetch existing plate for before-value in audit log
    const existing = await this.getPlateById(plateId);

    const { normalized } = normalizePlate(plate);
    if (!normalized) {
      throw new BadRequestException('Invalid plate value');
    }

    const result = await this.pool.query<MembershipPlateRow>(
      `UPDATE membership_plates
       SET plate = $1, plate_normalized = $2, brand = $3, model = $4
       WHERE id = $5
       RETURNING *`,
      [plate, normalized, brand ?? null, model ?? null, plateId],
    );

    if (result.rows.length === 0) {
      throw new NotFoundException('Plate not found');
    }

    const updatedPlate = this.mapRowToEntity(result.rows[0]!);

    await this.createAuditLog(
      existing.membershipId,
      operatorId ?? null,
      'plate_updated',
      { plate: existing.plate, plateNormalized: existing.plateNormalized, brand: existing.brand, model: existing.model },
      { plate: updatedPlate.plate, plateNormalized: updatedPlate.plateNormalized, brand: updatedPlate.brand, model: updatedPlate.model },
    );

    return updatedPlate;
  }

  /**
   * Remove a plate from a membership. Creates an audit log entry.
   */
  async removePlate(plateId: string, operatorId?: string): Promise<void> {
    const existing = await this.getPlateById(plateId);

    const result = await this.pool.query(
      'DELETE FROM membership_plates WHERE id = $1',
      [plateId],
    );

    if (result.rowCount === 0) {
      throw new NotFoundException('Plate not found');
    }

    await this.createAuditLog(
      existing.membershipId,
      operatorId ?? null,
      'plate_removed',
      { plate: existing.plate, plateNormalized: existing.plateNormalized, brand: existing.brand, model: existing.model },
      null,
    );
  }

  /**
   * List all plates for a membership.
   */
  async getPlates(membershipId: string): Promise<MembershipPlate[]> {
    const result = await this.pool.query<MembershipPlateRow>(
      'SELECT * FROM membership_plates WHERE membership_id = $1 ORDER BY created_at ASC',
      [membershipId],
    );

    return result.rows.map((row) => this.mapRowToEntity(row));
  }

  /**
   * Release (delete) all plates for a membership. Used on cancellation/expiry.
   * Creates an audit log entry for the bulk release.
   */
  async releasePlates(membershipId: string): Promise<void> {
    // Fetch current plates for audit before deleting
    const plates = await this.getPlates(membershipId);

    if (plates.length === 0) {
      return;
    }

    await this.pool.query(
      'DELETE FROM membership_plates WHERE membership_id = $1',
      [membershipId],
    );

    await this.createAuditLog(
      membershipId,
      null,
      'plates_released',
      { plates: plates.map((p) => ({ plate: p.plate, plateNormalized: p.plateNormalized, brand: p.brand, model: p.model })) },
      null,
    );
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────

  private async getPlateById(plateId: string): Promise<MembershipPlate> {
    const result = await this.pool.query<MembershipPlateRow>(
      'SELECT * FROM membership_plates WHERE id = $1',
      [plateId],
    );

    if (result.rows.length === 0) {
      throw new NotFoundException('Plate not found');
    }

    return this.mapRowToEntity(result.rows[0]!);
  }

  private async getMaxPlatesForMembership(membershipId: string): Promise<number> {
    const result = await this.pool.query<{ max_plates: number }>(
      `SELECT mp.max_plates
       FROM memberships m
       JOIN membership_plans mp ON mp.id = m.plan_id
       WHERE m.id = $1`,
      [membershipId],
    );

    if (result.rows.length === 0) {
      throw new NotFoundException(ERR_MEMBERSHIP_NOT_FOUND);
    }

    return result.rows[0]!.max_plates;
  }

  private async getPlateCount(membershipId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      'SELECT COUNT(*)::text as count FROM membership_plates WHERE membership_id = $1',
      [membershipId],
    );

    return parseInt(result.rows[0]!.count, 10);
  }

  private async createAuditLog(
    membershipId: string,
    operatorId: string | null,
    operation: string,
    beforeValue: unknown,
    afterValue: unknown,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_logs (tenant_id, user_id, operation, entity_type, entity_id, before_value, after_value)
       SELECT m.tenant_id, $2, $3, $4, $5, $6, $7
       FROM memberships m WHERE m.id = $1`,
      [
        membershipId,
        operatorId,
        operation,
        'membership_plate',
        membershipId,
        beforeValue ? JSON.stringify(beforeValue) : null,
        afterValue ? JSON.stringify(afterValue) : null,
      ],
    );
  }

  private mapRowToEntity(row: MembershipPlateRow): MembershipPlate {
    return {
      id: row.id,
      membershipId: row.membership_id,
      plate: row.plate,
      plateNormalized: row.plate_normalized,
      brand: row.brand,
      model: row.model,
      createdAt: row.created_at,
    };
  }
}
