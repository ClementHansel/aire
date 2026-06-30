import { Module } from '@nestjs/common';
import {
  VoucherPackController,
  VoucherTemplateController,
  VoucherController,
} from './voucher.controller';
import { VoucherTemplateService } from './voucher-template.service';
import { VoucherPackService } from './voucher-pack.service';
import { VoucherRedemptionService } from './voucher-redemption.service';
import { OrderModule } from '../order/order.module';
import { NotificationModule } from '../notification/notification.module';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  imports: [OrderModule, NotificationModule],
  controllers: [VoucherPackController, VoucherTemplateController, VoucherController],
  providers: [
    VoucherTemplateService,
    VoucherPackService,
    VoucherRedemptionService,
    DatabasePoolProvider,
  ],
  exports: [VoucherTemplateService, VoucherPackService, VoucherRedemptionService],
})
export class VoucherModule {}
