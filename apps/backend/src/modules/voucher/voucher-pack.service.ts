import { Injectable, Inject, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { JWTPayload, generateVoucherPack } from '@aire/shared';
import { DATABASE_POOL } from '../auth/database.provider';
import { PosCheckoutService } from '../order/pos-checkout.service';
import { NotificationService } from '../notification/notification.service';
import { VoucherTemplateService } from './voucher-template.service';
import { SellVoucherPackResult, IssueVoucherPackResult } from './voucher.interfaces';

/**
 * Sells voucher packs through the POS.
 *
 * Flow:
 *   1. sellPack  → creates customer + pending order for the pack's sale price
 *   2. POS settles the order via the standard payment flow
 *   3. issuePack → on confirmed payment, generates N child codes under a parent
 *      code, stores them hashed, and delivers the plaintext codes to the
 *      customer's WhatsApp number.
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
      });
      await client.query('COMMIT');
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
      `SELECT id, status, customer_id, customer_name, customer_phone
       FROM orders WHERE id = $1 AND tenant_id = $2`,
      [orderId, user.tenant_id],
    );
    const order = orderRes.rows[0];
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'paid') {
      throw new BadRequestException('Voucher codes are issued only after payment is confirmed');
    }

    // Idempotency: do not double-issue for the same order.
    const existing = await this.pool.query('SELECT id FROM voucher_packs WHERE order_id = $1', [orderId]);
    if (existing.rows.length > 0) {
      throw new BadRequestException('Voucher pack already issued for this order');
    }

    const template = await this.templates.getTemplate(user.tenant_id, templateId);
    const prefix = await this.tenantPrefix(user.tenant_id);
    const pack = generateVoucherPack({ tenantPrefix: prefix, packSize: template.max_uses });

    const expiryDate = this.computeExpiry(template.validity_days, template.expiry_date);

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
        [
          user.tenant_id,
          template.id,
          order.customer_id,
          pack.parentCodeHash,
          pack.parentCode,
          template.max_uses,
          orderId,
          expiryDate,
        ],
      );
      packId = packRes.rows[0]!.id;

      for (let i = 0; i < pack.childCodeHashes.length; i++) {
        await client.query(
          `INSERT INTO voucher_codes (pack_id, code_hash, code_index, status)
           VALUES ($1, $2, $3, 'active')`,
          [packId, pack.childCodeHashes[i], i],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Deliver plaintext codes to the customer's WhatsApp (best-effort).
    let whatsappDelivered = false;
    try {
      const result = await this.notifications.sendWhatsApp({
        to: order.customer_phone,
        templateName: 'voucher_delivery',
        params: {
          customerName: order.customer_name ?? '',
          codes: pack.childCodes.join(', '),
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

    return {
      packId,
      parentCode: pack.parentCode,
      childCodes: pack.childCodes,
      expiryDate,
      whatsappDelivered,
    };
  }

  /** Tenant-prefix for codes (uppercased slug, fallback AIRE). */
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
