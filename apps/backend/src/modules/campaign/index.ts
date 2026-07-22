import { Module } from '@nestjs/common';
import { CampaignController } from './campaign.controller';
import { CampaignService } from './campaign.service';
import { CampaignGrantService } from './campaign-grant.service';
import { VoucherModule } from '../voucher';
import { NotificationModule } from '../notification/notification.module';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  imports: [VoucherModule, NotificationModule],
  controllers: [CampaignController],
  providers: [CampaignService, CampaignGrantService, DatabasePoolProvider],
  exports: [CampaignService],
})
export class CampaignModule {}

export { CampaignService } from './campaign.service';
export { CampaignGrantService } from './campaign-grant.service';
