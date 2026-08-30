import { Module } from '@nestjs/common';
import { CategoryController, BrandController, ServiceTypeController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [CategoryController, BrandController, ServiceTypeController],
  providers: [CatalogService, DatabasePoolProvider],
  exports: [CatalogService],
})
export class CatalogModule {}

export { CatalogService } from './catalog.service';
