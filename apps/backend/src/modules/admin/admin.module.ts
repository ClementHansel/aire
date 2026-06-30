import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminMetricsService } from './admin-metrics.service';
import { DatabasePoolProvider } from '../auth/database.provider';
import { AuthModule } from '../auth';
import { AuditModule } from '../audit';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [AdminController],
  providers: [AdminService, AdminMetricsService, DatabasePoolProvider],
  exports: [AdminService],
})
export class AdminModule {}
