import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [InventoryController],
  providers: [InventoryService, DatabasePoolProvider],
  exports: [InventoryService],
})
export class InventoryModule {}
