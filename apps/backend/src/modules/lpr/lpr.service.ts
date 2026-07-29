import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { RealtimeGateway } from '../realtime';
import {
  PlateDetectionInput,
  PlateDetection,
  PlateDetectionMatch,
  LPR_SUGGESTION_TTL_SECONDS,
  LPR_MIN_CONFIDENCE,
  normalizePlate,
} from '@aire/shared';

/** Body for POST /api/lpr/detections/:id/confirm. */
export interface ConfirmDetectionBody {
  orderId?: string;
  /** Cashier-corrected plate, when the OCR reading was wrong. Defaults to the stored `plate`. */
  plate?: string;
}

/** Raw row shape from the joined select (see {@link LprService.SELECT_WITH_MATCH}). */
interface DetectionRow {
  id: string;
  tenant_id: string;
  outlet_id: string;
  camera_id: string;
  plate: string;
  plate_normalized: string;
  confidence: string;
  captured_at: Date | string;
  crop_image_url: string | null;
  source: string | null;
  confirmed_plate: string | null;
  order_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  membership_id: string | null;
  membership_status: string | null;
  plan_name: string | null;
  vehicle_brand: string | null;
  vehicle_model: string | null;
}

/**
 * LprService — ingest, list, and confirm LPR/ANPR plate detections (AIRIN-59).
 *
 * Matching (`plate_normalized` → `membership_plates.plate_normalized` →
 * membership → customer) is done with a LATERAL join scoped through
 * `memberships.tenant_id`, NOT a bare join on `membership_plates` — that table
 * carries no tenant_id of its own, so joining it directly on plate_normalized
 * alone would leak another tenant's vehicle brand/model for a coincidentally
 * identical plate. Tenant scoping happens inside the LATERAL subquery, before
 * any column of the match is read.
 *
 * `match` is derived at read time (never persisted), so a membership created
 * after a detection still resolves, and an expired membership shows its
 * current status rather than whatever it was at capture time.
 */
@Injectable()
export class LprService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  /**
   * Store a detection reported by the branch bridge, then match + emit.
   * tenantId/outletId come from the resolved bridge context (LprBridgeGuard),
   * never from the request body.
   */
  async ingest(
    tenantId: string,
    outletId: string,
    input: PlateDetectionInput,
  ): Promise<PlateDetection> {
    const { normalized, valid } = normalizePlate(input.plate ?? '');
    if (!valid) {
      throw new BadRequestException('plate normalizes to empty');
    }

    const confidence = input.confidence ?? 1;
    const capturedAt = input.capturedAt ?? new Date().toISOString();

    const res = await this.pool.query<{ id: string }>(
      `INSERT INTO lpr_detections
         (tenant_id, outlet_id, camera_id, plate, plate_normalized, confidence,
          captured_at, crop_image_url, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        tenantId,
        outletId,
        input.cameraId,
        input.plate,
        normalized,
        confidence,
        capturedAt,
        input.cropImageUrl ?? null,
        input.source ?? null,
      ],
    );

    const insertedId = res.rows[0]?.id;
    /* istanbul ignore next -- RETURNING id always yields exactly one row on a successful insert */
    if (!insertedId) throw new NotFoundException('Detection not found after insert');
    const detection = await this.findById(tenantId, insertedId);
    // findById cannot return null here — we just inserted the row.
    if (!detection) throw new NotFoundException('Detection not found after insert');

    // Low-confidence readings are still stored (useful for tuning) but not
    // pushed as a one-tap suggestion — offering an unreliable read risks
    // attaching the wrong vehicle to an order.
    if (detection.confidence >= LPR_MIN_CONFIDENCE) {
      this.realtimeGateway.emitPlateDetected(outletId, { detection });
    }

    return detection;
  }

  /**
   * Recent, still-offerable detections for the POS: newest first, within the
   * suggestion TTL, excluding already-confirmed rows. `outletIds` follows
   * ScopeService's null/[]/[ids] contract (null = every branch, [] = none).
   */
  async listRecent(tenantId: string, outletIds: string[] | null): Promise<PlateDetection[]> {
    const res = await this.pool.query<DetectionRow>(
      `${LprService.SELECT_WITH_MATCH}
       WHERE d.tenant_id = $1
         AND d.confirmed_plate IS NULL
         AND d.captured_at >= NOW() - make_interval(secs => $2)
         AND ($3::uuid[] IS NULL OR d.outlet_id = ANY($3::uuid[]))
       ORDER BY d.captured_at DESC`,
      [tenantId, LPR_SUGGESTION_TTL_SECONDS, outletIds],
    );
    return res.rows.map((r) => this.mapRow(r));
  }

  /**
   * Mark a detection consumed: stamp confirmed_plate (defaulting to the
   * stored plate) + order_id, so it drops out of {@link listRecent} and is
   * offered exactly once.
   */
  async confirm(
    tenantId: string,
    outletIds: string[] | null,
    id: string,
    body: ConfirmDetectionBody,
  ): Promise<PlateDetection> {
    const existing = await this.findById(tenantId, id);
    if (!existing) throw new NotFoundException('Detection not found');
    if (outletIds !== null && !outletIds.includes(existing.outletId)) {
      // Same 404 as "not found" — do not reveal that a detection exists in a
      // branch this caller cannot see.
      throw new NotFoundException('Detection not found');
    }

    await this.pool.query(
      `UPDATE lpr_detections
       SET confirmed_plate = $3, order_id = $4
       WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId, body.plate ?? existing.plate, body.orderId ?? null],
    );

    const updated = await this.findById(tenantId, id);
    if (!updated) throw new NotFoundException('Detection not found');
    return updated;
  }

  private async findById(tenantId: string, id: string): Promise<PlateDetection | null> {
    const res = await this.pool.query<DetectionRow>(
      `${LprService.SELECT_WITH_MATCH} WHERE d.id = $1 AND d.tenant_id = $2`,
      [id, tenantId],
    );
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  private mapRow(r: DetectionRow): PlateDetection {
    const match: PlateDetectionMatch | null = r.customer_id
      ? {
          customerId: r.customer_id,
          customerName: r.customer_name ?? '',
          customerPhone: r.customer_phone ?? '',
          membershipId: r.membership_id,
          membershipStatus: r.membership_status,
          planName: r.plan_name,
          vehicleBrand: r.vehicle_brand,
          vehicleModel: r.vehicle_model,
        }
      : null;

    return {
      id: r.id,
      outletId: r.outlet_id,
      cameraId: r.camera_id,
      plate: r.plate,
      plateNormalized: r.plate_normalized,
      confidence: Number(r.confidence),
      capturedAt: new Date(r.captured_at).toISOString(),
      cropImageUrl: r.crop_image_url ?? null,
      source: r.source ?? null,
      match,
      confirmedPlate: r.confirmed_plate ?? null,
      orderId: r.order_id ?? null,
    };
  }

  /**
   * Shared SELECT: a detection joined to its best membership-plate match.
   * The LATERAL subquery is the tenant boundary — membership_plates has no
   * tenant_id column, so it must reach the tenant through `memberships`
   * *before* any of its columns (brand/model) are allowed to leave the
   * subquery. When a plate is (rarely) registered on more than one membership,
   * prefer an active one, then the most recently created.
   */
  private static readonly SELECT_WITH_MATCH = `
    SELECT
      d.id, d.tenant_id, d.outlet_id, d.camera_id, d.plate, d.plate_normalized,
      d.confidence, d.captured_at, d.crop_image_url, d.source,
      d.confirmed_plate, d.order_id,
      c.id AS customer_id, c.name AS customer_name, c.phone AS customer_phone,
      m.id AS membership_id, m.status AS membership_status, mpl.name AS plan_name,
      match.brand AS vehicle_brand, match.model AS vehicle_model
    FROM lpr_detections d
    LEFT JOIN LATERAL (
      SELECT mp.membership_id, mp.brand, mp.model
      FROM membership_plates mp
      JOIN memberships mm ON mm.id = mp.membership_id AND mm.tenant_id = d.tenant_id
      WHERE mp.plate_normalized = d.plate_normalized
      ORDER BY (mm.status = 'active') DESC, mm.created_at DESC
      LIMIT 1
    ) match ON true
    LEFT JOIN memberships m ON m.id = match.membership_id
    LEFT JOIN membership_plans mpl ON mpl.id = m.plan_id
    LEFT JOIN customers c ON c.id = m.customer_id
  `;
}
