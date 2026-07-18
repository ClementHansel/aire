import { Global, Module } from '@nestjs/common';
import { JobMonitorService } from './job-monitor.service';
import { DatabasePoolProvider } from '../auth/database.provider';

/**
 * Global job-heartbeat registry. @Global so any scheduled job can inject
 * JobMonitorService (@Optional) and report a heartbeat without its module needing
 * an explicit import — mirrors EventsModule.
 */
@Global()
@Module({
  providers: [JobMonitorService, DatabasePoolProvider],
  exports: [JobMonitorService],
})
export class JobMonitorModule {}
