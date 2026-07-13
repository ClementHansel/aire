import { Module } from '@nestjs/common';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { PaymentWebhookController, WebhookConfigResolver } from './payment-webhook.controller';
import { PaymentController } from './payment.controller';
import { PaymentConfigController } from './payment-config.controller';
import { PaymentService } from './payment.service';
import { DatabasePoolProvider } from '../auth/database.provider';
import { OnboardingCompleteGuard } from '../../common/guards';

@Module({
  controllers: [PaymentWebhookController, PaymentController, PaymentConfigController],
  providers: [PaymentProviderRegistry, WebhookConfigResolver, PaymentService, DatabasePoolProvider, OnboardingCompleteGuard],
  exports: [PaymentProviderRegistry, PaymentService],
})
export class PaymentModule {}
