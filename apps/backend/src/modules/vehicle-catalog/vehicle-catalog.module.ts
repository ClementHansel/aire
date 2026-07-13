import { Module } from '@nestjs/common';
import { VehicleCatalogController } from './vehicle-catalog.controller';
import { VehicleCatalogService } from './vehicle-catalog.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [VehicleCatalogController],
  providers: [VehicleCatalogService, DatabasePoolProvider],
  exports: [VehicleCatalogService],
})
export class VehicleCatalogModule {}
