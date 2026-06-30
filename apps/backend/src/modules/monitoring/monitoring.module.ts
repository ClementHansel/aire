import { Global, Module } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import { DatabasePoolProvider } from '../auth/database.provider';

/**
 * Global Monitoring module — records and aggregates agent invocations.
 */
@Global()
@Module({
  providers: [MonitoringService, DatabasePoolProvider],
  exports: [MonitoringService],
})
export class MonitoringModule {}
