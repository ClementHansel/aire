import { Module } from '@nestjs/common';
import { PaymentMethodController } from './payment-method.controller';
import { PaymentMethodService } from './payment-method.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [PaymentMethodController],
  providers: [PaymentMethodService, DatabasePoolProvider],
  exports: [PaymentMethodService],
})
export class PaymentMethodModule {}

export { PaymentMethodService } from './payment-method.service';
