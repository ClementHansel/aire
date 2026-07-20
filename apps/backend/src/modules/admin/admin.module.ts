import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { PlatformFeedController } from './platform-feed.controller';
import { AdminService } from './admin.service';
import { AdminMetricsService } from './admin-metrics.service';
import { DockerService } from './docker.service';
import { PlatformPlanService } from './platform-plan.service';
import { PlatformInvoiceService } from './platform-invoice.service';
import { PlatformUserService } from './platform-user.service';
import { PlatformAnnouncementService } from './platform-announcement.service';
import { TenantLifecycleService } from './tenant-lifecycle.service';
import { PlatformBillingPaymentService } from './platform-billing-payment.service';
import { TenantBillingService } from './tenant-billing.service';
import { TenantBillingController, PlatformPaymentWebhookController } from './tenant-billing.controller';
import { PlatformOpsService } from './platform-ops.service';
import { PlatformTaxService } from './platform-tax.service';
import { DatabasePoolProvider } from '../auth/database.provider';
import { AuthModule } from '../auth';
import { AuditModule } from '../audit';
import { LegalEntityModule } from '../legal-entity';
import { OutletModule } from '../outlet/outlet.module';
import { EntitlementModule } from '../entitlement';
import { PaymentModule } from '../payment/payment.module';
import { AgentConfigModule } from '../agent-config';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [AuthModule, AuditModule, LegalEntityModule, OutletModule, EntitlementModule, PaymentModule, AgentConfigModule, SettingsModule],
  controllers: [AdminController, PlatformFeedController, TenantBillingController, PlatformPaymentWebhookController],
  providers: [
    AdminService,
    AdminMetricsService,
    DockerService,
    PlatformPlanService,
    PlatformInvoiceService,
    PlatformUserService,
    PlatformAnnouncementService,
    TenantLifecycleService,
    PlatformBillingPaymentService,
    TenantBillingService,
    PlatformOpsService,
    PlatformTaxService,
    DatabasePoolProvider,
  ],
  exports: [AdminService],
})
export class AdminModule {}
