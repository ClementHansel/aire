import { Injectable, Inject, Optional, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { checkGrantEligibility, generateVoucherPack, CampaignData } from '@aire/shared';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';
import { VoucherTemplateService } from '../voucher/voucher-template.service';
import { NotificationService } from '../notification/notification.service';
import { CampaignRow } from './campaign.interfaces';

/**
 * CampaignGrantService — fires "buy membership plan X -> N bonus voucher
 * codes" campaigns.
 *
 * Subscribes to MembershipActivated rather than being called inline from
 * MembershipSellService, mirroring VoucherNotifyService's rationale: the
 * membership module stays free of a dependency on the voucher/campaign
 * modules, and a failure here can never roll back the activation.
 *
 * Idempotency: one grant per (campaign, order) — the membership's order_id is
 * used as the natural dedupe key, since a membership activation always maps
 * to exactly one fee order and MembershipActivated is only ever emitted once
 * per activation call.
 *
 * Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6
 */
@Injectable()
export class CampaignGrantService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CampaignGrantService.name);
  private unsubscribes: Array<() => void> = [];

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly templates: VoucherTemplateService,
    private readonly notifications: NotificationService,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  onModuleInit(): void {
    if (this.eventBus) {
      this.unsubscribes.push(
        this.eventBus.on(DomainEventType.MembershipActivated, (e) =>
          this.safe(() =>
            this.onMembershipActivated(e.tenantId!, e.payload as { membershipId: string; planId: string; customerId: string }),
          )),
      );
      this.logger.log('Campaign grant firing subscribed (membership.activated)');
    }
  }

  onModuleDestroy(): void {
    this.unsubscribes.forEach((u) => u());
    this.unsubscribes = [];
  }

  private async safe(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.logger.error(`Campaign grant firing failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  private async onMembershipActivated(
    tenantId: string,
    payload: { membershipId: string; planId: string; customerId: string },
  ): Promise<void> {
    // Fetch the membership's fee order (dedupe key) + delivery details.
    const memRes = await this.pool.query<{
      order_id: string | null;
      outlet_id: string | null;
      customer_name: string | null;
      customer_phone: string | null;
    }>(
      `SELECT m.order_id, o.outlet_id, o.customer_name, o.customer_phone
       FROM memberships m
       LEFT JOIN orders o ON o.id = m.order_id
       WHERE m.id = $1 AND m.tenant_id = $2`,
      [payload.membershipId, tenantId],
    );
    const membership = memRes.rows[0];
    if (!membership?.order_id) return; // nothing to key idempotency on — skip

    const campaignsRes = await this.pool.query<CampaignRow>(
      `SELECT * FROM campaigns WHERE tenant_id = $1 AND plan_id = $2`,
      [tenantId, payload.planId],
    );
    if (campaignsRes.rows.length === 0) return;

    const today = new Date().toISOString().slice(0, 10);

    for (const campaign of campaignsRes.rows) {
      await this.tryGrant(tenantId, campaign, membership.order_id, payload.customerId, {
        outletId: membership.outlet_id,
        customerName: membership.customer_name,
        customerPhone: membership.customer_phone,
      }, today);
    }
  }

  private async tryGrant(
    tenantId: string,
    campaign: CampaignRow,
    orderId: string,
    customerId: string,
    delivery: { outletId: string | null; customerName: string | null; customerPhone: string | null },
    today: string,
  ): Promise<void> {
    // Idempotency: never double-grant the same campaign for the same fee order.
    const already = await this.pool.query(
      'SELECT id FROM campaign_grants WHERE campaign_id = $1 AND order_id = $2',
      [campaign.id, orderId],
    );
    if (already.rows.length > 0) return;

    const customerGrantCountRes = await this.pool.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM campaign_grants WHERE campaign_id = $1 AND customer_id = $2',
      [campaign.id, customerId],
    );
    const customerGrantCount = parseInt(customerGrantCountRes.rows[0]!.count, 10);

    const eligibility = checkGrantEligibility(this.toCampaignData(campaign), customerGrantCount, today);
    if (!eligibility.eligible) {
      this.logger.debug(`Campaign ${campaign.id} not eligible for customer ${customerId}: ${eligibility.reason}`);
      return;
    }

    const template = await this.templates.getTemplate(tenantId, campaign.bonus_template_id);
    const prefix = await this.tenantPrefix(tenantId);
    const pack = generateVoucherPack({ tenantPrefix: prefix, packSize: template.max_uses });
    const expiryDate = this.computeExpiry(template.validity_days, template.expiry_date);

    // NOTE: membership activation always uses today as start_date (no future-
    // dating is supported by ActivateMembershipDto), so the bonus pack's
    // validity window starting "now" always matches the membership start —
    // there is no future-dated case to special-case here yet. If future-dated
    // activation is added, voucher_packs has no start_date/usable_from column;
    // that would need a schema change (out of scope for this pass).
    const client = await this.pool.connect();
    let packId: string;
    try {
      await client.query('BEGIN');
      const packRes = await client.query<{ id: string }>(
        `INSERT INTO voucher_packs
          (tenant_id, template_id, customer_id, parent_code_hash, parent_code_prefix,
           total_uses, uses_count, status, order_id, expiry_date)
         VALUES ($1,$2,$3,$4,$5,$6,0,'active',$7,$8)
         RETURNING id`,
        [tenantId, template.id, customerId, pack.parentCodeHash, pack.parentCode, template.max_uses, orderId, expiryDate],
      );
      packId = packRes.rows[0]!.id;

      for (let i = 0; i < pack.childCodeHashes.length; i++) {
        await client.query(
          `INSERT INTO voucher_codes (pack_id, code_hash, code_index, status)
           VALUES ($1, $2, $3, 'active')`,
          [packId, pack.childCodeHashes[i], i],
        );
      }

      await client.query(
        `INSERT INTO campaign_grants (campaign_id, customer_id, voucher_pack_id, order_id)
         VALUES ($1, $2, $3, $4)`,
        [campaign.id, customerId, packId, orderId],
      );
      await client.query(
        `UPDATE campaigns SET grants_count = grants_count + 1, updated_at = NOW() WHERE id = $1`,
        [campaign.id],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Deliver the bonus codes via WhatsApp (best-effort — never blocks the grant).
    let whatsappDelivered = false;
    if (delivery.customerPhone) {
      try {
        const result = await this.notifications.sendWhatsApp({
          to: delivery.customerPhone,
          templateName: 'campaign_bonus',
          params: {
            customerName: delivery.customerName ?? '',
            campaignName: campaign.name,
            codes: pack.childCodes.join(', '),
            expiryDate: expiryDate ?? 'no expiry',
          },
          tenantId,
        });
        whatsappDelivered = result.success;
        if (!result.success) {
          this.logger.warn(`Campaign bonus codes generated but WhatsApp delivery failed (campaign ${campaign.id}): ${result.error}`);
        }
      } catch (err) {
        this.logger.warn(`WhatsApp delivery threw for campaign ${campaign.id}: ${err instanceof Error ? err.message : err}`);
      }
    }

    void this.eventBus?.emit({
      type: DomainEventType.CampaignBonusGranted,
      tenantId,
      outletId: delivery.outletId,
      actor: 'system',
      payload: { campaignId: campaign.id, customerId, orderId, packId, codes: pack.childCodes.length, whatsappDelivered },
    });
  }

  private toCampaignData(row: CampaignRow): CampaignData {
    return {
      id: row.id,
      planId: row.plan_id,
      startDate: row.start_date,
      endDate: row.end_date,
      cap: row.cap,
      perCustomerLimit: row.per_customer_limit,
      grantsCount: row.grants_count,
      status: row.status,
    };
  }

  /** Tenant-prefix for codes (uppercased slug, fallback AIRE). Mirrors VoucherPackService. */
  private async tenantPrefix(tenantId: string): Promise<string> {
    const res = await this.pool.query<{ slug: string }>('SELECT slug FROM tenants WHERE id = $1', [tenantId]);
    const slug = res.rows[0]?.slug ?? 'aire';
    const cleaned = slug.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8);
    return cleaned || 'AIRE';
  }

  private computeExpiry(validityDays: number | null, templateExpiry: string | null): string | null {
    if (validityDays && validityDays > 0) {
      const d = new Date();
      d.setDate(d.getDate() + validityDays);
      return d.toISOString().slice(0, 10);
    }
    return templateExpiry;
  }
}
