import { Inject, Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Pool } from 'pg';
import type { JWTPayload } from '@aire/shared';
import { DATABASE_POOL } from '../auth/database.provider';
import { MembershipRenewalService } from '../membership/membership-renewal.service';
import { MembershipPlanService } from '../membership/membership-plan.service';
import { MembershipSellService } from '../membership/membership-sell.service';
import { PosCheckoutService, resolveServiceBusinessUnit } from '../order/pos-checkout.service';
import { PaymentService } from '../payment/payment.service';

/**
 * Customer-initiated membership renewal (online QRIS). Reuses the staff renewal
 * flow (fee order → pending renewal → apply on paid) by synthesizing a per-tenant
 * system operator (same no-login user the kiosk uses) so the order has a valid
 * created_by + outlet.
 */
@Injectable()
export class PortalRenewService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly renewal: MembershipRenewalService,
    private readonly plans: MembershipPlanService,
    private readonly sell: MembershipSellService,
    private readonly checkout: PosCheckoutService,
    private readonly payment: PaymentService,
  ) {}

  listPlans(tenantId: string) {
    return this.plans.listPlans(tenantId);
  }

  private async ensureSystemUser(tenantId: string): Promise<string> {
    const email = `kiosk+${tenantId}@kiosk.local`;
    const existing = await this.pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [email]);
    if (existing.rows[0]) return existing.rows[0].id;
    const inserted = await this.pool.query<{ id: string }>(
      `INSERT INTO users (tenant_id, outlet_id, email, password_hash, name, role, is_active)
       VALUES ($1, NULL, $2, '!kiosk-no-login', 'Portal', 'cashier', true)
       ON CONFLICT (email) DO UPDATE SET updated_at = NOW() RETURNING id`,
      [tenantId, email],
    );
    return inserted.rows[0]!.id;
  }

  /** Resolve the outlet the renewal order books into. */
  private async resolveOutlet(tenantId: string, membershipId: string, customerId: string): Promise<string | null> {
    const r = await this.pool.query<{ outlet_id: string | null }>(
      `SELECT COALESCE(m.home_outlet_id, c.registered_outlet_id,
                (SELECT id FROM outlets o WHERE o.tenant_id = $1 ORDER BY created_at LIMIT 1)) AS outlet_id
         FROM memberships m JOIN customers c ON c.id = m.customer_id
        WHERE m.id = $2 AND m.tenant_id = $1`,
      [tenantId, membershipId, customerId],
    );
    return r.rows[0]?.outlet_id ?? null;
  }

  /** Start a renewal: creates the fee order + a QRIS charge to pay online. */
  async renew(tenantId: string, customerId: string, membershipId: string, planId: string) {
    const owns = await this.pool.query(
      `SELECT 1 FROM memberships WHERE id = $1 AND tenant_id = $2 AND customer_id = $3`,
      [membershipId, tenantId, customerId],
    );
    if (owns.rows.length === 0) throw new ForbiddenException('That membership is not yours.');

    const outletId = await this.resolveOutlet(tenantId, membershipId, customerId);
    if (!outletId) throw new BadRequestException('No branch available to process the renewal.');
    const operatorId = await this.ensureSystemUser(tenantId);
    const user: JWTPayload = { sub: operatorId, tenant_id: tenantId, outlet_id: outletId, role: 'cashier', iat: 0, exp: 0 };

    const { order } = await this.renewal.renewByMembershipId(user, membershipId, planId);
    const charge = await this.payment.createQrisCharge(tenantId, order.id);
    return { orderId: order.id, total: order.total, qrString: charge.qrString };
  }

  /** Resolve the branch a first-membership purchase books into (registered branch, else first outlet). */
  private async resolveOutletForCustomer(tenantId: string, customerId: string): Promise<string | null> {
    const r = await this.pool.query<{ outlet_id: string | null }>(
      `SELECT COALESCE(c.registered_outlet_id,
                (SELECT id FROM outlets o WHERE o.tenant_id = $1 ORDER BY created_at LIMIT 1)) AS outlet_id
         FROM customers c WHERE c.id = $2 AND c.tenant_id = $1`,
      [tenantId, customerId],
    );
    return r.rows[0]?.outlet_id ?? null;
  }

  /**
   * Buy a FIRST membership online (for a signed-in customer with none). Mirrors
   * the POS Sell Pack flow: create fee order → pending membership → QRIS charge.
   * The membership is activated (with the customer's plates) only after payment,
   * via activateBought().
   */
  async buy(tenantId: string, customerId: string, planId: string) {
    const plan = await this.plans.getPlan(planId);
    const outletId = await this.resolveOutletForCustomer(tenantId, customerId);
    if (!outletId) throw new BadRequestException('No branch available to process the purchase.');
    const cust = await this.pool.query<{ name: string; phone: string }>(
      `SELECT name, phone FROM customers WHERE id = $1 AND tenant_id = $2`,
      [customerId, tenantId],
    );
    if (!cust.rows[0]) throw new BadRequestException('Customer not found.');

    const operatorId = await this.ensureSystemUser(tenantId);
    const user: JWTPayload = { sub: operatorId, tenant_id: tenantId, outlet_id: outletId, role: 'cashier', iat: 0, exp: 0 };

    const client = await this.checkout.db.connect();
    let order: { id: string; orderNumber: string; total: number };
    try {
      await client.query('BEGIN');
      // Same business-unit derivation as the POS sale/renewal paths — a
      // self-serve portal renewal of a LEAD plan is LEAD revenue, not AIRE.
      const businessUnit = await resolveServiceBusinessUnit(client, [
        ...(plan.freeServiceIds ?? []),
        ...plan.discountedServices.map((d) => d.serviceId),
      ]);
      order = await this.checkout.createPackOrder(client, user, {
        customerId,
        customerName: cust.rows[0].name,
        customerPhone: cust.rows[0].phone,
        total: plan.price,
        note: `Membership: ${plan.name}`,
        businessUnit,
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const membership = await this.sell.sellMembership({ planId, customerId, orderId: order.id, tenantId });
    const charge = await this.payment.createQrisCharge(tenantId, order.id);
    return { orderId: order.id, membershipId: membership.id, total: order.total, qrString: charge.qrString, maxPlates: plan.maxPlates };
  }

  /** Activate a bought membership once its order is paid (ownership-checked, idempotent). */
  async activateBought(
    tenantId: string, customerId: string, membershipId: string,
    plates: { plate: string; brand?: string; model?: string }[],
  ) {
    const m = await this.pool.query<{ status: string; order_status: string | null }>(
      `SELECT m.status, o.status AS order_status
         FROM memberships m LEFT JOIN orders o ON o.id = m.order_id
        WHERE m.id = $1 AND m.tenant_id = $2 AND m.customer_id = $3`,
      [membershipId, tenantId, customerId],
    );
    const row = m.rows[0];
    if (!row) throw new ForbiddenException('That membership is not yours.');
    if (!row.order_status || !['paid', 'confirmed', 'completed'].includes(row.order_status)) {
      throw new BadRequestException('Payment is not completed yet.');
    }
    if (!Array.isArray(plates) || plates.length === 0) {
      throw new BadRequestException('At least one vehicle plate is required to activate the membership.');
    }
    // Payment now activates the membership on its own, so by the time the
    // customer submits this form it is usually ALREADY active. Returning early on
    // that (as this used to) would silently discard the plates they just typed —
    // so run the registration either way. activateMembership is idempotent: it
    // adds only new plates and leaves an already-started term alone.
    const alreadyActive = row.status === 'active';
    await this.sell.activateMembership(membershipId, { plates });
    return { alreadyActive };
  }

  /** Poll a first-membership purchase order. */
  async buyStatus(tenantId: string, orderId: string): Promise<{ status: string; paid: boolean }> {
    const r = await this.pool.query<{ status: string }>(
      `SELECT status FROM orders WHERE id = $1 AND tenant_id = $2`,
      [orderId, tenantId],
    );
    const status = r.rows[0]?.status ?? 'unknown';
    return { status, paid: ['paid', 'confirmed', 'completed'].includes(status) };
  }

  /** Poll the renewal fee order; apply the renewal once paid (idempotent). */
  async status(tenantId: string, orderId: string): Promise<{ status: string; applied: boolean }> {
    const r = await this.pool.query<{ status: string }>(
      `SELECT status FROM orders WHERE id = $1 AND tenant_id = $2`,
      [orderId, tenantId],
    );
    const status = r.rows[0]?.status ?? 'unknown';
    let applied = false;
    if (['paid', 'confirmed', 'completed'].includes(status)) {
      try {
        await this.renewal.applyRenewal(tenantId, orderId);
        applied = true;
      } catch {
        applied = false; // e.g. not yet applied / race — poll again
      }
    }
    return { status, applied };
  }
}
