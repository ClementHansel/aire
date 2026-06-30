import { Module } from '@nestjs/common';
import { VehicleQueueController } from './vehicle-queue.controller';
import { VehicleQueueService } from './vehicle-queue.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [VehicleQueueController],
  providers: [VehicleQueueService, DatabasePoolProvider],
  exports: [VehicleQueueService],
})
export class VehicleQueueModule {}

export { VehicleQueueService } from './vehicle-queue.service';
