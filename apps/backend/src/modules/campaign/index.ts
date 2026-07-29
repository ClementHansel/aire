import { Module } from '@nestjs/common';
import { CampaignController } from './campaign.controller';
import { CampaignService } from './campaign.service';
import { CampaignGrantService } from './campaign-grant.service';
import { VoucherModule } from '../voucher';
import { VoucherTicketModule } from '../voucher-ticket';
import { NotificationModule } from '../notification/notification.module';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  // VoucherTicketModule provides VoucherTicketService.issueBonusBook, the
  // model campaign grants issue onto (AIRIN-138) — no cycle: VoucherTicketModule
  // only depends on OrderModule/NotificationModule, never on CampaignModule.
  imports: [VoucherModule, VoucherTicketModule, NotificationModule],
  controllers: [CampaignController],
  providers: [CampaignService, CampaignGrantService, DatabasePoolProvider],
  exports: [CampaignService],
})
export class CampaignModule {}

export { CampaignService } from './campaign.service';
export { CampaignGrantService } from './campaign-grant.service';
