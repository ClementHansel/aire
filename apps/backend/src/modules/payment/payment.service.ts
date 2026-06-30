import { Injectable, Inject, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { ConfigService } from '@nestjs/config';
import { DATABASE_POOL } from '../auth/database.provider';
import { PaymentProviderRegistry, TenantPaymentConfig, isSandboxKey } from './payment-provider.registry';

export interface QrisChargeResult {
  orderId: string;
  orderNumber: string;
  transactionId: string;
  qrString: string;
  amount: number;
  expiresAt: string;
}

/**
 * PaymentService — initiates gateway charges (QRIS dynamic) and confirms
 * payments from webhook callbacks by updating the order.
 *
 * Tenant payment configuration is read from tenants.settings->'payment'
 * with environment-variable fallback.
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly registry: PaymentProviderRegistry,
    private readonly config: ConfigService,
  ) {}

  /**
   * Resolve the tenant's payment provider configuration.
   * Reads tenants.settings->'payment', falling back to env vars.
   */
  async getTenantPaymentConfig(tenantId: string): Promise<TenantPaymentConfig> {
    const res = await this.pool.query<{ settings: Record<string, any> }>(
      'SELECT settings FROM tenants WHERE id = $1',
      [tenantId],
    );
    const settings = res.rows[0]?.settings ?? {};
    const p = settings.payment ?? {};
    const provider = (p.provider || this.config.get('PAYMENT_PROVIDER') || 'xendit') as TenantPaymentConfig['provider'];
    return {
      provider,
      apiKey: p.apiKey || this.config.get(`${provider.toUpperCase()}_API_KEY`) || '',
      webhookSecret: p.webhookSecret || this.config.get(`${provider.toUpperCase()}_WEBHOOK_SECRET`) || '',
    };
  }

  /**
   * Create a dynamic QRIS charge for an order.
   * Stores the gateway transaction id on the order's payment_reference and
   * leaves the order in 'ordered' status until the webhook confirms payment.
   */
  async createQrisCharge(tenantId: string, orderId: string): Promise<QrisChargeResult> {
    const orderRes = await this.pool.query(
      'SELECT id, order_number, total, status FROM orders WHERE id = $1 AND tenant_id = $2',
      [orderId, tenantId],
    );
    const order = orderRes.rows[0];
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'ordered') {
      throw new BadRequestException(`Order cannot be charged from status "${order.status}"`);
    }

    const cfg = await this.getTenantPaymentConfig(tenantId);
    if (!cfg.apiKey) {
      throw new BadRequestException('Payment provider is not configured. Add gateway API keys in settings.');
    }

    const provider = this.registry.getProvider(tenantId, cfg);
    const amount = parseFloat(order.total);
    const result = await provider.createPayment({
      orderId: order.id,
      amount,
      method: 'qris_dynamic' as never,
    });

    if (!result.success) {
      throw new BadRequestException(result.errorMessage || 'Failed to create QRIS charge');
    }

    await this.pool.query(
      `UPDATE orders SET payment_method = 'qris_dynamic', payment_reference = $1, updated_at = NOW() WHERE id = $2`,
      [result.transactionId, orderId],
    );

    // Sandbox stand-in: no live gateway will send a webhook, so simulate the
    // customer scanning and paying by confirming the order through the exact
    // same DB path a real webhook uses, after a realistic delay. All state is
    // real; only the gateway round-trip is simulated.
    if (isSandboxKey(cfg.apiKey)) {
      const delayMs = parseInt(this.config.get('PAYMENT_SANDBOX_CONFIRM_DELAY_MS') ?? '6000', 10) || 6000;
      this.logger.log(`Sandbox: order ${orderId} will auto-confirm in ${delayMs}ms`);
      setTimeout(() => {
        this.confirmPaymentByReference(order.id).catch((err) =>
          this.logger.error(`Sandbox auto-confirm failed for order ${order.id}: ${err?.message ?? err}`),
        );
      }, delayMs);
    }

    return {
      orderId: order.id,
      orderNumber: order.order_number,
      transactionId: result.transactionId,
      qrString: result.qrCodeUrl ?? '',
      amount,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  /**
   * Mark an order paid from a webhook callback.
   * The reference is the order id (passed as reference_id at charge time).
   */
  async confirmPaymentByReference(reference: string): Promise<boolean> {
    // Match either the order id (reference_id) or the stored gateway transaction id.
    const res = await this.pool.query(
      `UPDATE orders
       SET status = 'paid', paid_at = NOW(), updated_at = NOW()
       WHERE (id::text = $1 OR payment_reference = $1) AND status = 'ordered'
       RETURNING id`,
      [reference],
    );
    const updated = (res.rowCount ?? 0) > 0;
    if (updated) this.logger.log(`Order ${reference} marked paid via webhook`);
    else this.logger.warn(`Webhook: no pending order matched reference ${reference}`);
    return updated;
  }
}
