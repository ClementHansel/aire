import { Module } from '@nestjs/common';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { PaymentWebhookController, WebhookConfigResolver } from './payment-webhook.controller';

@Module({
  controllers: [PaymentWebhookController],
  providers: [PaymentProviderRegistry, WebhookConfigResolver],
  exports: [PaymentProviderRegistry],
})
export class PaymentModule {}
