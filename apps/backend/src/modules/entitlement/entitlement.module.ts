import { Module } from '@nestjs/common';
import { EntitlementService } from './entitlement.service';
import { DatabasePoolProvider } from '../auth/database.provider';

/**
 * Plan-entitlement engine. EventsModule is @Global so EventBus is available
 * without an explicit import. Imported by any feature module that must enforce a
 * plan cap at write time (outlets, staff seats, …).
 */
@Module({
  providers: [EntitlementService, DatabasePoolProvider],
  exports: [EntitlementService],
})
export class EntitlementModule {}
