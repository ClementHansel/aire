import { Global, Module } from '@nestjs/common';
import { EventBusService } from './event-bus.service';
import { DatabasePoolProvider } from '../auth/database.provider';

/**
 * Global EventBus module. Provided once and available to every module so any
 * service can emit domain events without explicit imports.
 */
@Global()
@Module({
  providers: [EventBusService, DatabasePoolProvider],
  exports: [EventBusService],
})
export class EventsModule {}
