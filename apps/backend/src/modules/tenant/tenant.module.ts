import { Module } from '@nestjs/common';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [TenantController],
  providers: [TenantService, DatabasePoolProvider],
  exports: [TenantService],
})
export class TenantModule {}
