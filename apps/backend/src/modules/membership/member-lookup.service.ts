import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import {
  normalizePhone,
  normalizePlate,
  MemberLookupResponse,
  PlateInfo,
  MembershipDetail,
  DiscountedServiceInfo,
  VoucherInfo,
  MembershipStatus,
} from '@aire/shared';
import { MembershipLifecycleService } from './membership-lifecycle.service';

/** Display order for memberships in a lookup — most actionable first. */
const STATUS_PRIORITY: Record<string, number> = {
  active: 0, grace: 1, revoked: 2, expired: 3, suspended: 4, pending: 5, cancelled: 6,
};

/**
 * Raw customer row from the database.
 */
interface CustomerRow {
  id: string;
  name: string;
  phone: string;
  membership_number?: string | null;
}

/**
 * Raw membership row joined with plan details.
 */
interface MembershipJoinRow {
  id: string;
  plan_name: string;
  status: string;
  start_date: string;
  end_date: string;
  uses_count: number;
  max_uses: number;
  daily_limit: number;
  max_plates: number;
  free_service_ids: string[] | null;
  discounted_services: DiscountedServiceInfo[] | null;
}

/**
 * Raw membership plate row.
 */
interface MembershipPlateRow {
  membership_id: string;
  plate: string;
  brand: string | null;
  model: string | null;
}

/**
 * Raw daily usage row.
 */
interface DailyUsageRow {
  membership_id: string;
  plate_normalized: string;
  usage_count: string; // COUNT returns string from pg
}

/**
 * Raw voucher row from campaign grants.
 */
interface VoucherRow {
  id: string;
  code_display: string;
  type: 'fixed' | 'percentage' | 'service_pack';
  value: string;
  expires_at: string | null;
  is_used: boolean;
  /** Only used for ordering across the two grant models. */
  created_at?: Date;
}

/**
 * Member lookup service for the AIRE Operations Platform.
 *
 * Provides cross-outlet (tenant-scoped) member lookup by:
 * - Normalized phone number
 * - Normalized license plate
 *
 * Assembles full MemberLookupResponse with all active memberships,
 * daily usage, registered plates, and campaign-granted vouchers.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5
 */
@Injectable()
export class MemberLookupService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /**
   * Lookup a member by phone number.
   * Normalizes the phone input and searches customers across all outlets within the tenant.
   *
   * @param tenantId - The tenant to search within
   * @param phone - Raw phone input (handles 0xxx, 62xxx, +62xxx variants)
   * @returns MemberLookupResponse if found, null otherwise
   */
  async lookupByPhone(
    tenantId: string,
    phone: string,
  ): Promise<MemberLookupResponse | null> {
    const { normalized, valid } = normalizePhone(phone);
    if (!valid) {
      return null;
    }

    const result = await this.pool.query<CustomerRow>(
      `SELECT id, name, phone
       FROM customers
       WHERE tenant_id = $1 AND phone_normalized = $2
       LIMIT 1`,
      [tenantId, normalized],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const customer = result.rows[0]!;
    return this.buildMemberResponse(customer.id, tenantId);
  }

  /**
   * Lookup a member by license plate.
   * Normalizes the plate input and searches membership_plates across all outlets within the tenant.
   * Follows the chain: plate → membership → customer.
   *
   * @param tenantId - The tenant to search within
   * @param plate - Raw plate input (e.g., "B 1234 ABC")
   * @returns MemberLookupResponse if found, null otherwise
   */
  async lookupByPlate(
    tenantId: string,
    plate: string,
  ): Promise<MemberLookupResponse | null> {
    const { normalized, valid } = normalizePlate(plate);
    if (!valid) {
      return null;
    }

    // Find the customer via: membership_plates → memberships → customers.
    // Any status — a grace/revoked member must still resolve so POS can advise
    // (renew / buy new). Prefer the most-actionable membership's customer.
    const result = await this.pool.query<{ customer_id: string }>(
      `SELECT c.id AS customer_id
       FROM membership_plates mp
       JOIN memberships m ON mp.membership_id = m.id
       JOIN customers c ON m.customer_id = c.id
       WHERE mp.plate_normalized = $1
         AND m.tenant_id = $2
       ORDER BY CASE m.status WHEN 'active' THEN 0 WHEN 'grace' THEN 1 ELSE 2 END,
                m.end_date DESC
       LIMIT 1`,
      [normalized, tenantId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const customerId = result.rows[0]!.customer_id;
    return this.buildMemberResponse(customerId, tenantId);
  }

  /**
   * Lookup a member by their 12-char membership number (scanned barcode/QR or typed).
   */
  async lookupByMembershipNumber(
    tenantId: string,
    membershipNumber: string,
  ): Promise<MemberLookupResponse | null> {
    const n = (membershipNumber ?? '').trim().toUpperCase();
    if (!n) return null;
    const result = await this.pool.query<{ id: string }>(
      `SELECT id FROM customers WHERE tenant_id = $1 AND membership_number = $2 LIMIT 1`,
      [tenantId, n],
    );
    if (result.rows.length === 0) return null;
    return this.buildMemberResponse(result.rows[0]!.id, tenantId);
  }

  /**
   * Build the full member response for a given customer.
   * Assembles all active memberships, their plates, daily usage, and vouchers.
   *
   * @param customerId - The customer ID
   * @param tenantId - The tenant ID (for scoping queries)
   * @returns Complete MemberLookupResponse
   */
  async buildMemberResponse(
    customerId: string,
    tenantId: string,
  ): Promise<MemberLookupResponse> {
    // 1. Get customer info
    const customerResult = await this.pool.query<CustomerRow>(
      `SELECT id, name, phone, membership_number FROM customers WHERE id = $1 AND tenant_id = $2`,
      [customerId, tenantId],
    );
    const customer = customerResult.rows[0]!;

    // 2. Get ALL memberships with plan details (not just active) so POS/kiosk can
    //    surface grace/revoked/suspended/cancelled and advise renew vs buy-new.
    //    The canonical status is derived per-row (a stale 'active' past its end date
    //    reads as grace/revoked); benefits remain guarded active-only in order.service.
    const membershipsResult = await this.pool.query<MembershipJoinRow>(
      `SELECT m.id, mp.name AS plan_name, m.status,
              m.start_date::text, m.end_date::text,
              m.uses_count, m.max_uses, m.daily_limit, mp.max_plates,
              mp.free_service_ids, mp.discounted_services
       FROM memberships m
       JOIN membership_plans mp ON m.plan_id = mp.id
       WHERE m.customer_id = $1 AND m.tenant_id = $2
       ORDER BY m.start_date DESC`,
      [customerId, tenantId],
    );

    const membershipIds = membershipsResult.rows.map((r) => r.id);

    // 3. Get all plates across all memberships for this customer
    let allPlates: MembershipPlateRow[] = [];
    if (membershipIds.length > 0) {
      const platesResult = await this.pool.query<MembershipPlateRow>(
        `SELECT membership_id, plate, brand, model
         FROM membership_plates
         WHERE membership_id = ANY($1)`,
        [membershipIds],
      );
      allPlates = platesResult.rows;
    }

    // 4. Get today's daily usage for all memberships (WIB = UTC+7)
    let dailyUsages: DailyUsageRow[] = [];
    if (membershipIds.length > 0) {
      const usageResult = await this.pool.query<DailyUsageRow>(
        `SELECT membership_id, plate_normalized, COUNT(*)::text AS usage_count
         FROM membership_usages
         WHERE membership_id = ANY($1)
           AND reversed = false
           AND (used_at AT TIME ZONE 'Asia/Jakarta')::date = (NOW() AT TIME ZONE 'Asia/Jakarta')::date
         GROUP BY membership_id, plate_normalized`,
        [membershipIds],
      );
      dailyUsages = usageResult.rows;
    }

    // 5. Assemble memberships with plates and daily usage
    const memberships: MembershipDetail[] = membershipsResult.rows.map((row) => {
      const plates: PlateInfo[] = allPlates
        .filter((p) => p.membership_id === row.id)
        .map((p) => ({
          plate: p.plate,
          brand: p.brand ?? undefined,
          model: p.model ?? undefined,
        }));

      const dailyUsageToday: Record<string, number> = {};
      dailyUsages
        .filter((u) => u.membership_id === row.id)
        .forEach((u) => {
          dailyUsageToday[u.plate_normalized] = parseInt(u.usage_count, 10);
        });

      // Canonical status: manual states (pending/cancelled/suspended) pass through;
      // active/grace/revoked/expired are recomputed from the end date so a stale row
      // never mislabels an expired membership as active.
      const derived = MembershipLifecycleService.derive(row.status, row.end_date);

      return {
        id: row.id,
        planName: row.plan_name,
        status: derived as MembershipStatus,
        startDate: row.start_date,
        endDate: row.end_date,
        usesCount: row.uses_count,
        maxUses: row.max_uses,
        dailyLimit: row.daily_limit,
        maxPlates: row.max_plates,
        plates,
        freeServices: row.free_service_ids ?? [],
        discountedServices: row.discounted_services ?? [],
        dailyUsageToday,
      };
    });

    // Most-actionable first (active → grace → revoked → …) so consumers can take
    // memberships[0] as the one to advise on.
    memberships.sort(
      (a, b) => (STATUS_PRIORITY[a.status] ?? 9) - (STATUS_PRIORITY[b.status] ?? 9),
    );

    // 6. Get all unique plates across all memberships for the customer-level plates field
    const customerPlates: PlateInfo[] = [];
    const seenPlates = new Set<string>();
    for (const p of allPlates) {
      if (!seenPlates.has(p.plate)) {
        seenPlates.add(p.plate);
        customerPlates.push({
          plate: p.plate,
          brand: p.brand ?? undefined,
          model: p.model ?? undefined,
        });
      }
    }

    // 6b. A customer who never bought a membership has no membership_plates rows
    // at all, so the POS could not autofill anything for a walk-in it had already
    // served many times — the cashier retyped the same car on every visit
    // (AIRIN-147). Their vehicles are recorded on their past orders, so fall back
    // to those, most recent first.
    //
    // Deliberately a FALLBACK, not a merge: for an actual member this list drives
    // which plate the order is priced against, and a car they once drove but never
    // registered is not covered by the plan. Only fill it when membership plates
    // are absent.
    if (customerPlates.length === 0) {
      const historyRes = await this.pool.query<{
        plate: string; brand: string | null; model: string | null;
      }>(
        `SELECT DISTINCT ON (COALESCE(plate_normalized, license_plate))
                COALESCE(plate_normalized, license_plate) AS plate,
                vehicle_brand AS brand, vehicle_model AS model
           FROM orders
          WHERE customer_id = $1 AND tenant_id = $2
            AND COALESCE(plate_normalized, license_plate) IS NOT NULL
            AND COALESCE(plate_normalized, license_plate) <> ''
            AND status <> 'cancelled'
          ORDER BY COALESCE(plate_normalized, license_plate), created_at DESC`,
        [customerId, tenantId],
      );
      for (const h of historyRes.rows) {
        if (seenPlates.has(h.plate)) continue;
        seenPlates.add(h.plate);
        customerPlates.push({
          plate: h.plate,
          brand: h.brand ?? undefined,
          model: h.model ?? undefined,
        });
      }
    }

    // 7. Get campaign-granted vouchers for this customer.
    //
    // UNION of both grant models. Migration 086 moved new grants from
    // voucher_packs (hashed) to voucher_books (plaintext), but this query still
    // only joined through cg.voucher_pack_id — which is NULL for every grant
    // issued since — so a member's bonus vouchers had silently stopped appearing
    // here even though Issued Vouchers showed them. The book arm reports the real
    // redeemable CODE; the legacy pack arm can only report its prefix, since the
    // codes behind it were never stored in plaintext.
    const vouchersResult = await this.pool.query<VoucherRow>(
      `SELECT vc.id, vp.parent_code_prefix AS code_display,
              vt.type, vt.value::text,
              vt.expiry_date::text AS expires_at,
              (vc.status = 'redeemed') AS is_used,
              vc.created_at
         FROM campaign_grants cg
         JOIN voucher_packs vp ON cg.voucher_pack_id = vp.id
         JOIN voucher_codes vc ON vc.pack_id = vp.id
         JOIN voucher_templates vt ON vp.template_id = vt.id
        WHERE cg.customer_id = $1
          AND vp.tenant_id = $2
          AND vc.status IN ('active', 'redeemed')
       UNION ALL
       SELECT t.id, t.code AS code_display,
              -- Read the benefit off the BOOK, not its template: books predating
              -- migration 090 have no template_id, and the book's own columns are
              -- always populated. 'service' is this model's spelling of a free
              -- service, which the voucher vocabulary calls 'service_pack'.
              CASE b.benefit_type WHEN 'service' THEN 'service_pack' ELSE b.benefit_type END AS type,
              b.benefit_value::text AS value,
              t.expiry_date::text AS expires_at,
              (t.status = 'redeemed') AS is_used,
              t.created_at
         FROM campaign_grants cg
         JOIN voucher_books b ON cg.voucher_book_id = b.id
         JOIN voucher_tickets t ON t.book_id = b.id
        WHERE cg.customer_id = $1
          AND b.tenant_id = $2
          AND t.status IN ('active', 'redeemed')
       ORDER BY created_at DESC`,
      [customerId, tenantId],
    );

    const vouchers: VoucherInfo[] = vouchersResult.rows.map((v) => ({
      id: v.id,
      code: v.code_display,
      type: v.type,
      value: parseFloat(v.value),
      expiresAt: v.expires_at ?? '',
      isUsed: v.is_used,
    }));

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        membershipNumber: customer.membership_number ?? undefined,
        plates: customerPlates,
      },
      memberships,
      vouchers: vouchers.length > 0 ? vouchers : undefined,
    };
  }
}
