import { Injectable, Inject, Optional, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { checkGrantEligibility, CampaignData } from '@aire/shared';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';
import { VoucherTemplateService } from '../voucher/voucher-template.service';
import { VoucherTicketService } from '../voucher-ticket/voucher-ticket.service';
import { CampaignRow } from './campaign.interfaces';

/**
 * CampaignGrantService — fires "buy X -> N bonus voucher codes" campaigns.
 * Two triggers are supported (AIRIN-102):
 *   - membership_plan: subscribes to MembershipActivated
 *   - voucher_pack:     subscribes to VoucherPackIssued
 *
 * Subscribes to events rather than being called inline from
 * MembershipSellService/VoucherPackService, mirroring VoucherNotifyService's
 * rationale: the membership/voucher-pack modules stay free of a dependency
 * on the campaign module, and a failure here can never roll back the
 * triggering purchase.
 *
 * Grants are issued onto voucher_books/voucher_tickets — the SAME
 * plaintext-code model the dashboard's Issued Vouchers tab reads and POS
 * resolveDigitalVouchers redeems (AIRIN-138). Grants used to write into
 * voucher_packs/voucher_codes (hashed, one-time-WhatsApp-only codes), which
 * the dashboard never queries — that split, not a firing bug, was why
 * campaign-granted vouchers never showed up as issued.
 *
 * Idempotency: one grant per (campaign, order) — the triggering order's id
 * is used as the natural dedupe key, since both a membership activation and
 * a voucher-pack issuance map to exactly one order, and each event is only
 * ever emitted once per activation/issuance call.
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
    private readonly tickets: VoucherTicketService,
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
      this.unsubscribes.push(
        this.eventBus.on(DomainEventType.VoucherPackIssued, (e) =>
          this.safe(() =>
            this.onVoucherPackIssued(e.tenantId!, (e.outletId as string | null) ?? null, e.payload as { packId: string; orderId: string; templateId: string }),
          )),
      );
      this.logger.log('Campaign grant firing subscribed (membership.activated, voucher.pack_issued)');
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
      `SELECT * FROM campaigns WHERE tenant_id = $1 AND trigger_type = 'membership_plan' AND plan_id = $2`,
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

  /**
   * AIRIN-102: a voucher-pack purchase (e.g. "10x wash") can also trigger a
   * campaign bonus (e.g. "3x spray wax free"). VoucherPackIssued fires once
   * the pack's codes are generated for a paid order — mirrors
   * onMembershipActivated's shape, just sourced from `orders` directly
   * instead of via a membership row (a pack sale has no membership).
   */
  private async onVoucherPackIssued(
    tenantId: string,
    outletId: string | null,
    payload: { packId: string; orderId: string; templateId: string },
  ): Promise<void> {
    const orderRes = await this.pool.query<{
      customer_id: string | null;
      customer_name: string | null;
      customer_phone: string | null;
      outlet_id: string | null;
    }>(
      `SELECT customer_id, customer_name, customer_phone, outlet_id FROM orders WHERE id = $1 AND tenant_id = $2`,
      [payload.orderId, tenantId],
    );
    const order = orderRes.rows[0];
    if (!order?.customer_id) return; // nothing to key the per-customer limit on — skip

    const campaignsRes = await this.pool.query<CampaignRow>(
      `SELECT * FROM campaigns WHERE tenant_id = $1 AND trigger_type = 'voucher_pack' AND trigger_template_id = $2`,
      [tenantId, payload.templateId],
    );
    if (campaignsRes.rows.length === 0) return;

    const today = new Date().toISOString().slice(0, 10);

    for (const campaign of campaignsRes.rows) {
      await this.tryGrant(tenantId, campaign, payload.orderId, order.customer_id, {
        outletId: outletId ?? order.outlet_id,
        customerName: order.customer_name,
        customerPhone: order.customer_phone,
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
    // Idempotency: never double-grant the same campaign for the same triggering order.
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

    if (!delivery.outletId) {
      // voucher_books.outlet_id is NOT NULL — without a branch to attribute
      // the bonus book to there is nothing safe to issue. Shouldn't happen
      // in practice (orders always carry an outlet), but never crash the
      // triggering purchase over it.
      this.logger.warn(`Campaign ${campaign.id} grant skipped: no outlet to issue the bonus book under (order ${orderId})`);
      return;
    }

    const template = await this.templates.getTemplate(tenantId, campaign.bonus_template_id);

    // NOTE: membership activation always uses today as start_date (no future-
    // dating is supported by ActivateMembershipDto), so the bonus book's
    // validity window starting "now" always matches the membership start —
    // there is no future-dated case to special-case here yet.
    const expiryDate = this.computeExpiry(template.validity_days, template.expiry_date);

    // voucher_books models ONE benefit (type/value/service) per book, unlike
    // voucher_templates.service_ids[] which can list several — the same
    // single-benefit shape the ad-hoc "Sell Voucher Pack" form already uses.
    // A bonus template is expected to describe one giveaway; when it's a
    // service_pack we take the first configured service.
    const benefitType = template.type === 'service_pack' ? 'service' : template.type;
    const benefitServiceId = template.type === 'service_pack' ? (template.service_ids?.[0] ?? null) : null;
    const benefitValue = template.type === 'service_pack' ? 0 : parseFloat(template.value);

    const client = await this.pool.connect();
    let bookId: string;
    let codes: string[];
    try {
      await client.query('BEGIN');

      const issued = await this.tickets.issueBonusBook(client, tenantId, {
        outletId: delivery.outletId,
        quantity: template.max_uses,
        benefitType,
        benefitServiceId,
        benefitValue,
        expiryDate,
        buyerName: delivery.customerName,
        buyerPhone: delivery.customerPhone,
        orderId,
        // Name the bonus in Issued Vouchers. Without this the row fell back to the
        // benefit service ("+ Spray Wax") with an empty Voucher column, while a
        // purchased pack showed its template name — found by live-testing 090.
        templateId: campaign.bonus_template_id,
        source: 'bonus',
      });
      bookId = issued.bookId;
      codes = issued.codes;

      await client.query(
        `INSERT INTO campaign_grants (campaign_id, customer_id, voucher_book_id, order_id)
         VALUES ($1, $2, $3, $4)`,
        [campaign.id, customerId, bookId, orderId],
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

    // Delivery of the bonus codes rides on this event: VoucherNotifyService
    // subscribes to CampaignBonusGranted and sends the name + code list over the
    // tenant's real WhatsApp line. It used to be attempted inline here through
    // NotificationService.sendWhatsApp, which posts a registered TEMPLATE to the
    // Meta WhatsApp Business API — never configured on this platform, so a
    // campaign bonus reached the customer's account but never their phone.
    const whatsappQueued = !!delivery.customerPhone;
    void this.eventBus?.emit({
      type: DomainEventType.CampaignBonusGranted,
      tenantId,
      outletId: delivery.outletId,
      actor: 'system',
      payload: { campaignId: campaign.id, customerId, orderId, bookId, codes: codes.length, whatsappQueued },
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

  private computeExpiry(validityDays: number | null, templateExpiry: string | null): string | null {
    if (validityDays && validityDays > 0) {
      const d = new Date();
      d.setDate(d.getDate() + validityDays);
      return d.toISOString().slice(0, 10);
    }
    return templateExpiry;
  }
}
