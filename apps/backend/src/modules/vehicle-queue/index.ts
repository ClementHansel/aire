import { Module } from '@nestjs/common';
import { VehicleQueueController } from './vehicle-queue.controller';
import { VehicleQueueService } from './vehicle-queue.service';
import { QueueDailyCloseService } from './queue-daily-close.service';
import { DatabasePoolProvider } from '../auth/database.provider';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [RealtimeModule],
  controllers: [VehicleQueueController],
  providers: [VehicleQueueService, QueueDailyCloseService, DatabasePoolProvider],
  exports: [VehicleQueueService],
})
export class VehicleQueueModule {}

export { VehicleQueueService } from './vehicle-queue.service';
export { QueueDailyCloseService } from './queue-daily-close.service';
