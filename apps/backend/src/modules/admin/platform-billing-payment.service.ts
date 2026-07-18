import { Injectable, Inject, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { ConfigService } from '@nestjs/config';
import { DATABASE_POOL } from '../auth/database.provider';
import { PaymentProviderRegistry, TenantPaymentConfig, isSandboxKey } from '../payment/payment-provider.registry';
import { PlatformInvoiceService } from './platform-invoice.service';

/** Registry cache key for the platform's own (Airin's) gateway account. */
const PLATFORM_KEY = 'platform';

export interface InvoiceCheckout {
  invoiceId: string;
  amount: number;
  currency: string;
  provider: string;
  reference: string;
  /** QR string / hosted checkout URL to render for the payer. */
  checkoutUrl: string;
  expiresAt: string;
  sandbox: boolean;
}

/**
 * Platform subscription billing via the SAME payment-gateway abstraction the POS
 * uses (PaymentProviderRegistry + providers), but with the PLATFORM's own gateway
 * credentials rather than a tenant's. This is the collection side of billing: a
 * tenant pays their subscription invoice, a webhook (or the sandbox auto-confirm)
 * marks it paid, and PlatformInvoiceService.updateStatus then restores any
 * billing-suspended tenant.
 *
 * Until the payment vendor is approved, PLATFORM_PAYMENT_API_KEY is unset and the
 * registry hands back the SandboxProvider (real DB flow, simulated gateway
 * round-trip). Set the three PLATFORM_PAYMENT_* env vars to a live secret to go
 * live with zero code changes.
 */
@Injectable()
export class PlatformBillingPaymentService {
  private readonly logger = new Logger(PlatformBillingPaymentService.name);

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly registry: PaymentProviderRegistry,
    private readonly invoices: PlatformInvoiceService,
    private readonly config: ConfigService,
  ) {}

  /**
   * The platform's own gateway config. Defaults to the sandbox stand-in ('mock')
   * so subscription payment works end-to-end before the vendor key is provisioned.
   */
  platformConfig(): TenantPaymentConfig {
    const provider = (this.config.get<string>('PLATFORM_PAYMENT_PROVIDER') || 'xendit') as TenantPaymentConfig['provider'];
    return {
      provider,
      apiKey: this.config.get<string>('PLATFORM_PAYMENT_API_KEY') || 'mock',
      webhookSecret: this.config.get<string>('PLATFORM_PAYMENT_WEBHOOK_SECRET') || '',
    };
  }

  isSandbox(): boolean {
    return isSandboxKey(this.platformConfig().apiKey);
  }

  /**
   * Create (or reuse) a gateway checkout for an invoice. Optionally pins the
   * invoice to a tenant (self-serve callers pass their own tenantId so they can
   * only pay their own invoices). In sandbox mode the invoice auto-confirms after
   * a short delay, exactly as the POS QRIS flow does.
   */
  async createInvoiceCheckout(invoiceId: string, tenantId?: string): Promise<InvoiceCheckout> {
    const res = await this.pool.query<{ id: string; tenant_id: string; amount: string; tax_amount: string | null; currency: string; status: string }>(
      `SELECT id, tenant_id, amount, tax_amount, currency, status FROM platform_invoices WHERE id = $1`,
      [invoiceId],
    );
    const inv = res.rows[0];
    if (!inv) throw new NotFoundException('Invoice not found');
    if (tenantId && inv.tenant_id !== tenantId) throw new NotFoundException('Invoice not found');
    if (!['draft', 'sent', 'overdue'].includes(inv.status)) {
      throw new BadRequestException(`Invoice cannot be paid from status "${inv.status}"`);
    }
    // Charge the tax-inclusive total (DPP + PPN).
    const amount = parseFloat(inv.amount) + (inv.tax_amount != null ? parseFloat(inv.tax_amount) : 0);
    if (!(amount > 0)) throw new BadRequestException('Invoice amount is zero — nothing to pay');

    const cfg = this.platformConfig();
    const sandbox = isSandboxKey(cfg.apiKey);
    const provider = this.registry.getProvider(PLATFORM_KEY, cfg);
    const result = await provider.createPayment({ orderId: inv.id, amount, method: 'qris_dynamic' as never });
    if (!result.success) throw new BadRequestException(result.errorMessage || 'Failed to create checkout');

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await this.pool.query(
      `UPDATE platform_invoices
          SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END,
              issued_at = COALESCE(issued_at, NOW()),
              payment_provider = $2, payment_reference = $3,
              checkout_url = $4, checkout_expires_at = $5, updated_at = NOW()
        WHERE id = $1`,
      [inv.id, provider.providerName, result.transactionId, result.qrCodeUrl ?? '', expiresAt],
    );

    if (sandbox) {
      const delayMs = parseInt(this.config.get<string>('PAYMENT_SANDBOX_CONFIRM_DELAY_MS') ?? '6000', 10) || 6000;
      this.logger.log(`Sandbox: platform invoice ${inv.id} will auto-confirm in ${delayMs}ms`);
      setTimeout(() => {
        this.confirmInvoiceByReference(result.transactionId).catch((err) =>
          this.logger.error(`Sandbox invoice auto-confirm failed for ${inv.id}: ${err?.message ?? err}`),
        );
      }, delayMs);
    }

    return {
      invoiceId: inv.id,
      amount,
      currency: inv.currency,
      provider: provider.providerName,
      reference: result.transactionId,
      checkoutUrl: result.qrCodeUrl ?? '',
      expiresAt,
      sandbox,
    };
  }

  /**
   * Mark an invoice paid from a gateway callback (or the sandbox auto-confirm).
   * Idempotent via the status guard: a repeated webhook matches 0 rows. Delegates
   * to PlatformInvoiceService.updateStatus so paid_at is stamped AND any
   * billing-suspended tenant is auto-restored.
   */
  async confirmInvoiceByReference(reference: string): Promise<boolean> {
    const res = await this.pool.query<{ id: string }>(
      `SELECT id FROM platform_invoices
        WHERE payment_reference = $1 AND status IN ('sent','overdue') LIMIT 1`,
      [reference],
    );
    const id = res.rows[0]?.id;
    if (!id) {
      this.logger.warn(`Platform webhook: no payable invoice matched reference ${reference}`);
      return false;
    }
    await this.invoices.updateStatus(id, 'paid');
    this.logger.log(`Platform invoice ${id} marked paid via ${reference}`);
    return true;
  }
}
