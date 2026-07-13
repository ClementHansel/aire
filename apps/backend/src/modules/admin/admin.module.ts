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
import { DatabasePoolProvider } from '../auth/database.provider';
import { AuthModule } from '../auth';
import { AuditModule } from '../audit';
import { LegalEntityModule } from '../legal-entity';
import { OutletModule } from '../outlet/outlet.module';

@Module({
  imports: [AuthModule, AuditModule, LegalEntityModule, OutletModule],
  controllers: [AdminController, PlatformFeedController],
  providers: [
    AdminService,
    AdminMetricsService,
    DockerService,
    PlatformPlanService,
    PlatformInvoiceService,
    PlatformUserService,
    PlatformAnnouncementService,
    DatabasePoolProvider,
  ],
  exports: [AdminService],
})
export class AdminModule {}
