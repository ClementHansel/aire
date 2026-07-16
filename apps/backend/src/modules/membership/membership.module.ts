import { Module } from '@nestjs/common';
import { MembershipPlanController } from './membership-plan.controller';
import { MembershipSellController } from './membership-sell.controller';
import { MembershipAdminController } from './membership-admin.controller';
import { MemberLookupController } from './member-lookup.controller';
import { MembershipPlanService } from './membership-plan.service';
import { MembershipPlateService } from './membership-plate.service';
import { MembershipRenewalService } from './membership-renewal.service';
import { MembershipSellService } from './membership-sell.service';
import { MembershipAdminService } from './membership-admin.service';
import { MemberLookupService } from './member-lookup.service';
import { MembershipLifecycleService } from './membership-lifecycle.service';
import { MembershipIdentityService } from './membership-identity.service';
import { OrderModule } from '../order/order.module';
import { NotificationModule } from '../notification/notification.module';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  imports: [OrderModule, NotificationModule],
  controllers: [MembershipPlanController, MembershipSellController, MembershipAdminController, MemberLookupController],
  providers: [MembershipPlanService, MembershipPlateService, MembershipRenewalService, MembershipSellService, MembershipAdminService, MemberLookupService, MembershipLifecycleService, MembershipIdentityService, DatabasePoolProvider],
  exports: [MembershipPlanService, MembershipPlateService, MembershipRenewalService, MembershipSellService, MemberLookupService, MembershipLifecycleService, MembershipIdentityService],
})
export class MembershipModule {}
