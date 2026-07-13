import { Injectable, Inject, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

/** base-36 uppercase, zero-padded to `width`. */
function toBase36(n: number, width: number): string {
  return n.toString(36).toUpperCase().padStart(width, '0');
}
/** Decode a base-36 code (case-insensitive); 0 for null/blank. */
function fromBase36(s: string | null | undefined): number {
  if (!s) return 0;
  const v = parseInt(s.trim(), 36);
  return Number.isFinite(v) ? v : 0;
}

/**
 * Allocates the 12-char membership number: TTTTTT(tenant, global) + BB(branch,
 * per tenant) + CCCC(customer, per branch), all base-36 uppercase. Codes are
 * assigned lazily and reused (a customer keeps its number across renewals).
 * Fixed-width zero-padded base-36 sorts lexically == numerically, so "next" is
 * MAX(code)+1 via ORDER BY code DESC. Unique constraints guard concurrent races.
 */
@Injectable()
export class MembershipIdentityService {
  private readonly logger = new Logger(MembershipIdentityService.name);

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  private async ensureTenantCode(tenantId: string): Promise<string> {
    const cur = await this.pool.query<{ tenant_code: string | null }>(
      `SELECT tenant_code FROM tenants WHERE id = $1`, [tenantId],
    );
    if (cur.rows[0]?.tenant_code) return cur.rows[0].tenant_code.trim();
    for (let i = 0; i < 6; i++) {
      const mx = await this.pool.query<{ code: string }>(
        `SELECT tenant_code AS code FROM tenants WHERE tenant_code IS NOT NULL ORDER BY tenant_code DESC LIMIT 1`,
      );
      const code = toBase36(fromBase36(mx.rows[0]?.code) + 1, 6);
      const upd = await this.pool.query(
        `UPDATE tenants SET tenant_code = $2 WHERE id = $1 AND tenant_code IS NULL`, [tenantId, code],
      ).catch(() => ({ rowCount: 0 }));
      if ((upd.rowCount ?? 0) > 0) return code;
      const re = await this.pool.query<{ tenant_code: string | null }>(`SELECT tenant_code FROM tenants WHERE id = $1`, [tenantId]);
      if (re.rows[0]?.tenant_code) return re.rows[0].tenant_code.trim();
    }
    throw new Error('Could not allocate tenant code');
  }

  private async ensureBranchCode(tenantId: string, outletId: string): Promise<string> {
    const cur = await this.pool.query<{ branch_code: string | null }>(
      `SELECT branch_code FROM outlets WHERE id = $1 AND tenant_id = $2`, [outletId, tenantId],
    );
    if (cur.rows[0]?.branch_code) return cur.rows[0].branch_code.trim();
    for (let i = 0; i < 6; i++) {
      const mx = await this.pool.query<{ code: string }>(
        `SELECT branch_code AS code FROM outlets WHERE tenant_id = $1 AND branch_code IS NOT NULL ORDER BY branch_code DESC LIMIT 1`,
        [tenantId],
      );
      const code = toBase36(fromBase36(mx.rows[0]?.code) + 1, 2);
      const upd = await this.pool.query(
        `UPDATE outlets SET branch_code = $3 WHERE id = $1 AND tenant_id = $2 AND branch_code IS NULL`,
        [outletId, tenantId, code],
      ).catch(() => ({ rowCount: 0 }));
      if ((upd.rowCount ?? 0) > 0) return code;
      const re = await this.pool.query<{ branch_code: string | null }>(`SELECT branch_code FROM outlets WHERE id = $1`, [outletId]);
      if (re.rows[0]?.branch_code) return re.rows[0].branch_code.trim();
    }
    throw new Error('Could not allocate branch code');
  }

  private async allocateCustomerCode(tenantId: string, outletId: string, customerId: string): Promise<string> {
    const cur = await this.pool.query<{ customer_code: string | null }>(
      `SELECT customer_code FROM customers WHERE id = $1 AND tenant_id = $2`, [customerId, tenantId],
    );
    if (cur.rows[0]?.customer_code) return cur.rows[0].customer_code.trim();
    for (let i = 0; i < 8; i++) {
      const mx = await this.pool.query<{ code: string }>(
        `SELECT customer_code AS code FROM customers
         WHERE tenant_id = $1 AND registered_outlet_id = $2 AND customer_code IS NOT NULL
         ORDER BY customer_code DESC LIMIT 1`,
        [tenantId, outletId],
      );
      const code = toBase36(fromBase36(mx.rows[0]?.code) + 1, 4);
      try {
        await this.pool.query(
          `UPDATE customers SET registered_outlet_id = $2, customer_code = $3 WHERE id = $1 AND tenant_id = $4`,
          [customerId, outletId, code, tenantId],
        );
        return code;
      } catch {
        /* unique (tenant, outlet, code) collision — retry with a fresh max */
      }
    }
    throw new Error('Could not allocate customer code');
  }

  /**
   * Ensure the customer has a membership number (idempotent); returns it.
   * Called when a membership is issued/activated/renewed.
   */
  async ensureMembershipNumber(tenantId: string, customerId: string, outletId: string): Promise<string> {
    const cur = await this.pool.query<{ membership_number: string | null }>(
      `SELECT membership_number FROM customers WHERE id = $1 AND tenant_id = $2`, [customerId, tenantId],
    );
    if (cur.rows[0]?.membership_number) return cur.rows[0].membership_number.trim();

    const tenantCode = await this.ensureTenantCode(tenantId);
    const branchCode = await this.ensureBranchCode(tenantId, outletId);
    const customerCode = await this.allocateCustomerCode(tenantId, outletId, customerId);
    const number = `${tenantCode}${branchCode}${customerCode}`;
    await this.pool.query(
      `UPDATE customers SET membership_number = $3 WHERE id = $1 AND tenant_id = $2 AND membership_number IS NULL`,
      [customerId, tenantId, number],
    );
    this.logger.log(`Issued membership number ${number} to customer ${customerId}`);
    return number;
  }

  /**
   * One-time backfill: assign membership numbers to existing customers who have a
   * membership but no number yet (pre-identity members). Idempotent — customers
   * that already have a number are skipped. Outlet is resolved from the customer's
   * registered outlet, else their earliest membership's home outlet, else the
   * tenant's first outlet.
   */
  async backfillNumbers(tenantId: string): Promise<{ assigned: number; failed: number }> {
    const rows = await this.pool.query<{ customer_id: string; outlet_id: string | null }>(
      `SELECT DISTINCT ON (c.id) c.id AS customer_id,
              COALESCE(c.registered_outlet_id, m.home_outlet_id,
                (SELECT o.id FROM outlets o WHERE o.tenant_id = c.tenant_id ORDER BY o.created_at LIMIT 1)) AS outlet_id
         FROM customers c
         JOIN memberships m ON m.customer_id = c.id
        WHERE c.tenant_id = $1 AND c.membership_number IS NULL
        ORDER BY c.id, m.created_at`,
      [tenantId],
    );
    let assigned = 0;
    let failed = 0;
    for (const r of rows.rows) {
      if (!r.outlet_id) { failed++; continue; }
      try {
        await this.ensureMembershipNumber(tenantId, r.customer_id, r.outlet_id);
        assigned++;
      } catch (e) {
        failed++;
        this.logger.warn(`Backfill failed for customer ${r.customer_id}: ${e instanceof Error ? e.message : e}`);
      }
    }
    this.logger.log(`Backfill for tenant ${tenantId}: ${assigned} assigned, ${failed} failed`);
    return { assigned, failed };
  }
}
