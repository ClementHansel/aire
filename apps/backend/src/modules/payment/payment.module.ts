import { Module } from '@nestjs/common';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { PaymentWebhookController, WebhookConfigResolver } from './payment-webhook.controller';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [PaymentWebhookController, PaymentController],
  providers: [PaymentProviderRegistry, WebhookConfigResolver, PaymentService, DatabasePoolProvider],
  exports: [PaymentProviderRegistry, PaymentService],
})
export class PaymentModule {}
