import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PaymentProviderRegistry, TenantPaymentConfig } from './payment-provider.registry';
import { PaymentService } from './payment.service';

/**
 * Resolves payment provider configuration for webhook processing.
 * In production, this would query the database for tenant payment settings
 * based on identifiers in the webhook payload.
 */
@Injectable()
export class WebhookConfigResolver {
  private readonly logger = new Logger(WebhookConfigResolver.name);

  /**
   * Resolve the tenant's payment configuration from webhook payload.
   * The payload typically contains a reference to the order/transaction
   * which can be mapped back to a tenant.
   */
  async resolveConfig(
    providerName: string,
    _payload: unknown,
  ): Promise<TenantPaymentConfig | null> {
    // Stub: In production, extract order/transaction reference from payload,
    // look up the associated tenant, and return their payment configuration.
    this.logger.debug(`Resolving config for provider ${providerName}`);
    return {
      provider: providerName as TenantPaymentConfig['provider'],
      apiKey: process.env[`${providerName.toUpperCase()}_API_KEY`] || '',
      webhookSecret: process.env[`${providerName.toUpperCase()}_WEBHOOK_SECRET`] || '',
    };
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
