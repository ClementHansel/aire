import { Module } from '@nestjs/common';
import { ProcurementController } from './procurement.controller';
import { ProcurementService } from './procurement.service';
import { InventoryModule } from '../inventory/inventory.module';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  imports: [InventoryModule],
  controllers: [ProcurementController],
  providers: [ProcurementService, DatabasePoolProvider],
  exports: [ProcurementService],
})
export class ProcurementModule {}
