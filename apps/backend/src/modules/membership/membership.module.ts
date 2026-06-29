import { Module } from '@nestjs/common';
import { MembershipPlanController } from './membership-plan.controller';
import { MembershipPlanService } from './membership-plan.service';
import { MembershipPlateService } from './membership-plate.service';
import { MembershipRenewalService } from './membership-renewal.service';
import { MembershipSellService } from './membership-sell.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [MembershipPlanController],
  providers: [MembershipPlanService, MembershipPlateService, MembershipRenewalService, MembershipSellService, DatabasePoolProvider],
  exports: [MembershipPlanService, MembershipPlateService, MembershipRenewalService, MembershipSellService],
})
export class MembershipModule {}
