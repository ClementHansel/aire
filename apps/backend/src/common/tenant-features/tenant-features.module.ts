import { Global, Module } from '@nestjs/common';
import { TenantFeaturesService } from './tenant-features.service';
import { DatabasePoolProvider } from '../../modules/auth/database.provider';

/**
 * Global provider for TenantFeaturesService so any module can ask what shape of
 * business a tenant runs without per-module wiring (mirrors ScopeModule).
 */
@Global()
@Module({
  providers: [TenantFeaturesService, DatabasePoolProvider],
  exports: [TenantFeaturesService],
})
export class TenantFeaturesModule {}
