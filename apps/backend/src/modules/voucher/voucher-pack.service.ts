import { Injectable, Inject, Optional, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { JWTPayload } from '@aire/shared';
import { DATABASE_POOL } from '../auth/database.provider';
import { PosCheckoutService, resolveServiceBusinessUnit } from '../order/pos-checkout.service';
import { NotificationService } from '../notification/notification.service';
import { VoucherTicketService } from '../voucher-ticket';
import { VoucherTemplateService } from './voucher-template.service';
import { SellVoucherPackResult, IssueVoucherPackResult } from './voucher.interfaces';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';

/**
 * Sells voucher packs through the POS.
 *
 * Flow:
 *   1. sellPack  → creates customer + pending order for the pack's sale price
 *   2. POS settles the order via the standard payment flow
 *   3. issuePack → on confirmed payment, issues a voucher BOOK of N plaintext
 *      tickets against that order and WhatsApps the codes to the customer.
 *
 * Step 3 used to mint voucher_packs/voucher_codes, which stored only SHA-256
 * hashes — so a bought pack could never be rendered in the dashboard's Issued
 * Vouchers tab and its codes were unrecoverable if WhatsApp delivery failed
 * (AIRIN-145). It now issues onto voucher_books/voucher_tickets, finishing the
 * convergence migration 086 began for campaign bonuses. The hashed tables are
 * retained read-only so packs sold before this change still validate/redeem.
 *
 * Requirements: 18.1, 18.2, 18.3, 18.4, 18.5
 */
@Injectable()
export class VoucherPackService {
  private readonly logger = new Logger(VoucherPackService.name);

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly checkout: PosCheckoutService,
    private readonly templates: VoucherTemplateService,
    private readonly notifications: NotificationService,
    private readonly tickets: VoucherTicketService,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  /** Reserve a voucher pack sale: create the customer + pending order. */
  async sellPack(
    user: JWTPayload,
    templateId: string,
    customer: { name: string; phone: string },
  ): Promise<SellVoucherPackResult> {
    if (!user.outlet_id) {
      throw new BadRequestException('Cashier must be assigned to an outlet to sell packs');
    }
    const template = await this.templates.getTemplate(user.tenant_id, templateId);
    if (!template.is_active) throw new BadRequestException('Voucher template is not active');

    // A voucher template carries no business_unit of its own — derive it from
    // the service(s) it's scoped to (service_ids), so the sale's revenue lands
    // in the right AIRE/LEAD bucket instead of defaulting to AIRE by accident.
    // A fixed/percentage template with no service_ids falls back to AIRE (see
    // resolveServiceBusinessUnit).
    const businessUnit = await resolveServiceBusinessUnit(this.pool, template.service_ids ?? []);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const customerId = await this.checkout.upsertCustomer(
        client,
        user.tenant_id,
        customer.name.trim(),
        customer.phone.trim(),
      );
      const order = await this.checkout.createPackOrder(client, user, {
        customerId,
        customerName: customer.name.trim(),
        customerPhone: customer.phone.trim(),
        total: parseFloat(template.sale_price),
        note: `Voucher Pack: ${template.name}`,
        businessUnit,
      });
      await client.query('COMMIT');
      // Emitted at sell time (mirrors MembershipSold) so the AI feed / monitoring
      // and customer-tagging see the pack sale immediately — VoucherPackIssued only
      // fires later, after payment, when codes are generated.
      void this.eventBus?.emit({
        type: DomainEventType.VoucherPackSold,
        tenantId: user.tenant_id,
        outletId: user.outlet_id,
        actor: user.sub,
        payload: {
          orderId: order.id,
          templateId: template.id,
          customerId,
          packSize: template.max_uses,
          salePrice: parseFloat(template.sale_price),
        },
      });
      return {
        order,
        templateId: template.id,
        templateName: template.name,
        packSize: template.max_uses,
        customerId,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Issue codes for a paid voucher-pack order. Idempotent per order.
   * Generates the pack, stores hashes, and delivers plaintext codes via WhatsApp.
   */
  async issuePack(user: JWTPayload, orderId: string, templateId: string): Promise<IssueVoucherPackResult> {
    // Verify the order is paid and belongs to the tenant.
    const orderRes = await this.pool.query(
      `SELECT id, status, customer_id, customer_name, customer_phone, outlet_id
       FROM orders WHERE id = $1 AND tenant_id = $2`,
      [orderId, user.tenant_id],
    );
    const order = orderRes.rows[0];
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'paid') {
      throw new BadRequestException('Voucher codes are issued only after payment is confirmed');
    }

    // Idempotency: do not double-issue for the same order. Keyed on
    // (order_id, source='sale') — NOT order_id alone, because one order can
    // legitimately own two books: the pack the customer bought and the campaign
    // bonus that purchase triggered (which lands with source='bonus').
    const existing = await this.pool.query(
      `SELECT id FROM voucher_books WHERE order_id = $1 AND source = 'sale'`,
      [orderId],
    );
    if (existing.rows.length > 0) {
      throw new BadRequestException('Voucher pack already issued for this order');
    }

    const template = await this.templates.getTemplate(user.tenant_id, templateId);
    const expiryDate = this.computeExpiry(template.validity_days, template.expiry_date);

    if (!order.outlet_id) {
      // voucher_books.outlet_id is NOT NULL, and a branchless code could not carry
      // the BRANCH-MMYYYY-NNNNNN prefix that makes a code traceable on sight.
      throw new BadRequestException('Order has no branch to issue the voucher pack under');
    }

    // A pack is issued as a BOOK of plaintext tickets, not as hashed pack codes
    // (AIRIN-145). The hashed voucher_packs/voucher_codes model could never be
    // rendered by the dashboard — you cannot show a code you only stored a hash
    // of — so a bought pack was invisible in Issued Vouchers while a campaign
    // bonus (already converged onto books in migration 086) showed up fine.
    // Book codes are BRANCH-MMYYYY-NNNNNN, so the branch prefix Samuel expected
    // comes from the shared counter rather than from our own codePrefix().
    //
    // Benefit mapping mirrors CampaignGrantService.tryGrant: a service_pack
    // grants its first service; fixed/percentage carry their value.
    const benefitType = template.type === 'service_pack' ? 'service' : template.type;
    const benefitServiceId = template.type === 'service_pack' ? (template.service_ids?.[0] ?? null) : null;
    const benefitValue = template.type === 'service_pack' ? 0 : parseFloat(template.value);

    const client = await this.pool.connect();
    let packId: string;
    let codes: string[];
    try {
      await client.query('BEGIN');
      const issued = await this.tickets.issueBonusBook(client, user.tenant_id, {
        outletId: order.outlet_id,
        quantity: template.max_uses,
        benefitType,
        benefitServiceId,
        benefitValue,
        expiryDate,
        buyerName: order.customer_name,
        buyerPhone: order.customer_phone,
        orderId,
        templateId: template.id,
        source: 'sale',
      });
      packId = issued.bookId;
      codes = issued.codes;
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Tag the fee order 'buy_voucher_pack' for reporting. Idempotent via
    // ON CONFLICT; non-fatal if it fails.
    try {
      await this.pool.query(
        `INSERT INTO order_tags (order_id, tag) VALUES ($1, 'buy_voucher_pack') ON CONFLICT (order_id, tag) DO NOTHING`,
        [orderId],
      );
    } catch { /* tagging is best-effort */ }

    // Deliver plaintext codes to the customer's WhatsApp (best-effort).
    let whatsappDelivered = false;
    try {
      const result = await this.notifications.sendWhatsApp({
        to: order.customer_phone,
        templateName: 'voucher_delivery',
        params: {
          customerName: order.customer_name ?? '',
          codes: codes.join(', '),
          expiryDate: expiryDate ?? 'no expiry',
        },
        tenantId: user.tenant_id,
      });
      whatsappDelivered = result.success;
      if (!result.success) {
        this.logger.warn(`Voucher codes generated but WhatsApp delivery failed for order ${orderId}: ${result.error}`);
      }
    } catch (err) {
      this.logger.warn(`WhatsApp delivery threw for order ${orderId}: ${err instanceof Error ? err.message : err}`);
    }

    void this.eventBus?.emit({
      type: DomainEventType.VoucherPackIssued,
      tenantId: user.tenant_id,
      outletId: user.outlet_id,
      actor: user.sub,
      payload: { packId, orderId, templateId: template.id, codes: codes.length, whatsappDelivered },
    });

    return {
      packId,
      // Books have no parent/wrapper code — every ticket stands alone.
      parentCode: null,
      childCodes: codes,
      expiryDate,
      whatsappDelivered,
    };
  }

  // codePrefix()/tenantPrefix() were removed with the hashed-pack model: book
  // codes get their BRANCH-MMYYYY-NNNNNN prefix from the shared voucher_counters
  // sequence in VoucherTicketService, so there is no second prefix scheme left to
  // drift out of sync with the tickets (which was the first half of AIRIN-145).

  private computeExpiry(validityDays: number | null, templateExpiry: string | null): string | null {
    if (validityDays && validityDays > 0) {
      const d = new Date();
      d.setDate(d.getDate() + validityDays);
      return d.toISOString().slice(0, 10);
    }
    return templateExpiry;
  }
}
