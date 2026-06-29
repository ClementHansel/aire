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

/**
 * Raw customer row from the database.
 */
interface CustomerRow {
  id: string;
  name: string;
  phone: string;
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
  expires_at: string;
  is_used: boolean;
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

    // Find the customer via: membership_plates → memberships → customers
    const result = await this.pool.query<{ customer_id: string }>(
      `SELECT DISTINCT c.id AS customer_id
       FROM membership_plates mp
       JOIN memberships m ON mp.membership_id = m.id
       JOIN customers c ON m.customer_id = c.id
       WHERE mp.plate_normalized = $1
         AND m.tenant_id = $2
         AND m.status = 'active'
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
      `SELECT id, name, phone FROM customers WHERE id = $1 AND tenant_id = $2`,
      [customerId, tenantId],
    );
    const customer = customerResult.rows[0]!;

    // 2. Get all active memberships with plan details
    const membershipsResult = await this.pool.query<MembershipJoinRow>(
      `SELECT m.id, mp.name AS plan_name, m.status,
              m.start_date::text, m.end_date::text,
              m.uses_count, m.max_uses, m.daily_limit,
              mp.free_service_ids, mp.discounted_services
       FROM memberships m
       JOIN membership_plans mp ON m.plan_id = mp.id
       WHERE m.customer_id = $1 AND m.tenant_id = $2 AND m.status = 'active'
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

      return {
        id: row.id,
        planName: row.plan_name,
        status: row.status as MembershipStatus,
        startDate: row.start_date,
        endDate: row.end_date,
        usesCount: row.uses_count,
        maxUses: row.max_uses,
        dailyLimit: row.daily_limit,
        plates,
        freeServices: row.free_service_ids ?? [],
        discountedServices: row.discounted_services ?? [],
        dailyUsageToday,
      };
    });

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

    // 7. Get campaign-granted vouchers for this customer
    const vouchersResult = await this.pool.query<VoucherRow>(
      `SELECT vc.id, vp.parent_code_prefix AS code_display,
              vt.type, vt.value::text,
              vt.expiry_date::text AS expires_at,
              (vc.status = 'redeemed') AS is_used
       FROM campaign_grants cg
       JOIN voucher_packs vp ON cg.voucher_pack_id = vp.id
       JOIN voucher_codes vc ON vc.pack_id = vp.id
       JOIN voucher_templates vt ON vp.template_id = vt.id
       WHERE cg.customer_id = $1
         AND vp.tenant_id = $2
         AND vc.status IN ('active', 'redeemed')
       ORDER BY vc.created_at DESC`,
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
        plates: customerPlates,
      },
      memberships,
      vouchers: vouchers.length > 0 ? vouchers : undefined,
    };
  }
}
