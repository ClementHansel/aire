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
import { VoucherTicketModule } from '../voucher-ticket';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  // VoucherTicketModule provides issueBonusBook, which pack SALES now issue onto
  // so a bought pack is visible in Issued Vouchers (AIRIN-145) — the same model
  // campaign bonuses moved to in migration 086. No cycle: VoucherTicketModule
  // depends only on OrderModule/NotificationModule, never on VoucherModule.
  imports: [OrderModule, NotificationModule, VoucherTicketModule],
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
