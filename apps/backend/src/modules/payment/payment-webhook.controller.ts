import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  Injectable,
  Inject,
  Logger,
} from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { PaymentProviderRegistry, TenantPaymentConfig } from './payment-provider.registry';
import { PaymentService } from './payment.service';

/** Payload fields (across Xendit / Midtrans / Stripe) that may carry a reference. */
const REFERENCE_FIELDS = [
  'reference_id', // Xendit — the order id we set at charge time
  'external_id', // Xendit (alt)
  'order_id', // Midtrans — the merchant order id
  'client_reference_id', // Stripe
  'id', // gateway transaction id
  'qr_id', // Xendit QR id
  'transaction_id', // Midtrans/Stripe gateway id
  'payment_reference',
];

/**
 * Resolves the OWNING tenant's payment configuration for an inbound webhook, so
 * each tenant's callbacks are verified against THAT tenant's own webhook secret
 * (not a single shared env secret). Multi-tenant safe.
 *
 * The payload is untrusted, but it is safe to use it to decide WHICH tenant's
 * secret to verify against: the caller still validates the signature with the
 * resolved secret, so a forged payload that names another tenant's order fails
 * signature validation. We map the payload back to a tenant via the order it
 * references — the merchant reference we set at charge time (orders.id) or the
 * gateway transaction id we stored (orders.payment_reference). No match → null →
 * the webhook is rejected (fail closed).
 */
@Injectable()
export class WebhookConfigResolver {
  private readonly logger = new Logger(WebhookConfigResolver.name);

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly paymentService: PaymentService,
  ) {}

  async resolveConfig(
    providerName: string,
    payload: unknown,
  ): Promise<TenantPaymentConfig | null> {
    const refs = this.extractReferences(payload);
    if (refs.length === 0) {
      this.logger.warn(`Webhook (${providerName}): no order reference found in payload`);
      return null;
    }
    const tenantId = await this.findTenantByOrderRef(refs);
    if (!tenantId) {
      this.logger.warn(`Webhook (${providerName}): no order matched references ${refs.join(', ')}`);
      return null;
    }
    // The tenant's own provider + secret (env fallback / sandbox default applies).
    return this.paymentService.getTenantPaymentConfig(tenantId);
  }

  /** Collect candidate reference strings from the payload + its nested data/object. */
  private extractReferences(payload: unknown): string[] {
    const out = new Set<string>();
    const consider = (v: unknown) => {
      if (typeof v === 'string' && v.trim()) out.add(v.trim());
    };
    const scan = (obj: unknown) => {
      if (!obj || typeof obj !== 'object') return;
      const o = obj as Record<string, unknown>;
      for (const f of REFERENCE_FIELDS) consider(o[f]);
      const md = o.metadata as Record<string, unknown> | undefined; // Stripe metadata.order_id
      if (md && typeof md === 'object') {
        consider(md.order_id);
        consider(md.orderId);
      }
    };
    const body = (payload ?? {}) as Record<string, unknown>;
    scan(body); // top level
    scan(body.data); // Xendit { data: {...} }
    scan((body.data as Record<string, unknown> | undefined)?.object); // Stripe { data: { object: {...} } }
    return [...out];
  }

  /** First tenant owning an order that matches any candidate reference. */
  private async findTenantByOrderRef(refs: string[]): Promise<string | null> {
    const res = await this.pool.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM orders
        WHERE id::text = ANY($1::text[]) OR payment_reference = ANY($1::text[])
        LIMIT 1`,
      [refs],
    );
    return res.rows[0]?.tenant_id ?? null;
  }
}

/**
 * Webhook controller for handling payment provider callbacks.
 * Each provider has a dedicated endpoint with provider-specific signature validation.
 */
@Controller('api/payments/webhook')
export class PaymentWebhookController {
  private readonly logger = new Logger(PaymentWebhookController.name);

  constructor(
    private readonly providerRegistry: PaymentProviderRegistry,
    private readonly configResolver: WebhookConfigResolver,
    private readonly paymentService: PaymentService,
  ) {}

  @Post('xendit')
  @HttpCode(HttpStatus.OK)
  async handleXenditWebhook(
    @Body() payload: unknown,
    @Headers('x-callback-token') signature: string,
  ) {
    return this.processWebhook('xendit', payload, signature);
  }

  @Post('midtrans')
  @HttpCode(HttpStatus.OK)
  async handleMidtransWebhook(
    @Body() payload: unknown,
    @Headers('x-signature-key') signature: string,
  ) {
    return this.processWebhook('midtrans', payload, signature);
  }

  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  async handleStripeWebhook(
    @Body() payload: unknown,
    @Headers('stripe-signature') signature: string,
  ) {
    return this.processWebhook('stripe', payload, signature);
  }

  private async processWebhook(
    providerName: string,
    payload: unknown,
    signature: string,
  ) {
    if (!signature) {
      this.logger.warn(
        `Webhook rejected: missing signature for provider ${providerName}`,
      );
      throw new UnauthorizedException('Missing webhook signature');
    }

    const config = await this.configResolver.resolveConfig(providerName, payload);
    if (!config) {
      this.logger.warn(
        `Webhook rejected: unable to resolve config for provider ${providerName}`,
      );
      throw new UnauthorizedException('Unable to resolve provider configuration');
    }

    const provider = this.providerRegistry.getProviderByName(providerName, config);
    const result = await provider.handleWebhook(payload, signature);

    if (!result.valid) {
      this.logger.warn(
        `Webhook signature validation failed for provider ${providerName}: ${result.errorMessage}`,
      );
      throw new UnauthorizedException('Invalid webhook signature');
    }

    this.logger.log(
      `Webhook processed successfully: provider=${providerName}, txn=${result.transactionId}, status=${result.status}`,
    );

    // Mark the order paid when the gateway confirms a completed payment.
    if (result.status === 'completed' && result.transactionId) {
      await this.paymentService.confirmPaymentByReference(result.transactionId);
    }

    return {
      received: true,
      transactionId: result.transactionId,
      status: result.status,
    };
  }
}
