import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { PlatformPlanService, PlatformPlan } from './platform-plan.service';
import { PlatformInvoiceService, PlatformInvoice } from './platform-invoice.service';
import { PlatformBillingPaymentService, InvoiceCheckout } from './platform-billing-payment.service';
import { TenantLifecycleService } from './tenant-lifecycle.service';
import { EntitlementService, EntitlementSnapshot } from '../entitlement';

export interface BillingSummary {
  tenant: { id: string; name: string; status: string; statusReason: string | null };
  plan: PlatformPlan | null;
  planCode: string | null;
  entitlements: EntitlementSnapshot;
  currentPeriod: string;
  outstandingCount: number;
  sandbox: boolean;
}

/**
 * Tenant-facing self-serve billing. Everything here is scoped to the CALLER's own
 * tenant (the controller passes user.tenant_id) — a tenant can see its plan, usage,
 * invoices, pay them, and change plan, without any super-admin involvement.
 * Reuses the same platform services the admin console uses.
 */
@Injectable()
export class TenantBillingService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly plans: PlatformPlanService,
    private readonly invoices: PlatformInvoiceService,
    private readonly billingPayment: PlatformBillingPaymentService,
    private readonly lifecycle: TenantLifecycleService,
    private readonly entitlements: EntitlementService,
  ) {}

  private currentPeriod(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  async summary(tenantId: string): Promise<BillingSummary> {
    const t = await this.pool.query<{ id: string; name: string; status: string; plan: string | null; status_reason: string | null }>(
      `SELECT id, name, status, plan, status_reason FROM tenants WHERE id = $1`,
      [tenantId],
    );
    const tenant = t.rows[0];
    if (!tenant) throw new NotFoundException('Tenant not found');

    const [allPlans, entitlements, invoiceList] = await Promise.all([
      this.plans.list(),
      this.entitlements.snapshot(tenantId),
      this.invoices.list({ tenantId }),
    ]);
    const plan = allPlans.find((p) => p.code === tenant.plan) ?? null;
    const outstandingCount = invoiceList.filter((i) => i.status === 'sent' || i.status === 'overdue').length;

    return {
      tenant: { id: tenant.id, name: tenant.name, status: tenant.status, statusReason: tenant.status_reason },
      plan,
      planCode: tenant.plan,
      entitlements,
      currentPeriod: this.currentPeriod(),
      outstandingCount,
      sandbox: this.billingPayment.isSandbox(),
    };
  }

  listInvoices(tenantId: string): Promise<PlatformInvoice[]> {
    return this.invoices.list({ tenantId });
  }

  /** Active plans the tenant can pick from (upgrade/downgrade catalog). */
  availablePlans(): Promise<PlatformPlan[]> {
    return this.plans.list(false);
  }

  /** Create a gateway checkout for one of the tenant's OWN invoices. */
  payInvoice(tenantId: string, invoiceId: string): Promise<InvoiceCheckout> {
    return this.billingPayment.createInvoiceCheckout(invoiceId, tenantId);
  }

  /**
   * Self-serve plan change. Upgrades are immediate. A downgrade is blocked when the
   * tenant's live usage would exceed the target plan's caps — the entitlement
   * engine's rule applied up front, so the tenant gets a clear "remove X first"
   * message instead of a broken half-migrated state.
   */
  async changePlan(tenantId: string, targetCode: string, actorUserId: string): Promise<BillingSummary> {
    const plans = await this.plans.list();
    const target = plans.find((p) => p.code === targetCode && p.isActive);
    if (!target) throw new BadRequestException('Unknown or inactive plan');

    const cur = await this.pool.query<{ plan: string | null }>(`SELECT plan FROM tenants WHERE id = $1`, [tenantId]);
    if (cur.rows.length === 0) throw new NotFoundException('Tenant not found');
    const from = cur.rows[0]!.plan;
    if (from === targetCode) return this.summary(tenantId);

    // Downgrade guard: usage must fit the target plan's caps.
    const snapshot = await this.entitlements.snapshot(tenantId);
    const offenders: string[] = [];
    for (const [key, limit] of Object.entries(target.limits ?? {})) {
      if (typeof limit === 'number' && limit > 0) {
        const usage = snapshot.resources.find((r) => r.key === key);
        if (usage && usage.used > limit) {
          offenders.push(`${usage.used} ${usage.label.toLowerCase()} (${target.name} allows ${limit})`);
        }
      }
    }
    if (offenders.length > 0) {
      throw new BadRequestException(
        `Cannot switch to ${target.name}: you have ${offenders.join('; ')}. Remove the excess first.`,
      );
    }

    await this.pool.query(`UPDATE tenants SET plan = $1, updated_at = NOW() WHERE id = $2`, [targetCode, tenantId]);
    this.entitlements.invalidate(tenantId);
    await this.lifecycle.recordPlanChange(tenantId, from, targetCode, actorUserId);
    return this.summary(tenantId);
  }
}
