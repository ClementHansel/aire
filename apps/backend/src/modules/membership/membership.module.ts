import { Module } from '@nestjs/common';
import { MembershipPlanController } from './membership-plan.controller';
import { MembershipSellController } from './membership-sell.controller';
import { MembershipAdminController } from './membership-admin.controller';
import { MembershipPlanService } from './membership-plan.service';
import { MembershipPlateService } from './membership-plate.service';
import { MembershipRenewalService } from './membership-renewal.service';
import { MembershipSellService } from './membership-sell.service';
import { MembershipAdminService } from './membership-admin.service';
import { OrderModule } from '../order/order.module';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  imports: [OrderModule],
  controllers: [MembershipPlanController, MembershipSellController, MembershipAdminController],
  providers: [MembershipPlanService, MembershipPlateService, MembershipRenewalService, MembershipSellService, MembershipAdminService, DatabasePoolProvider],
  exports: [MembershipPlanService, MembershipPlateService, MembershipRenewalService, MembershipSellService],
})
export class MembershipModule {}
