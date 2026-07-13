import { Module } from '@nestjs/common';
import { TenantModulesController } from './tenant-modules.controller';
import { DatabasePoolProvider } from '../auth/database.provider';
import { AuthModule } from '../auth';

/**
 * Tenant Modules Module.
 *
 * Exposes the per-tenant enabled-module map to authenticated users so the
 * dashboard can gate navigation. Toggling is handled by the Admin module.
 */
@Module({
  imports: [AuthModule],
  controllers: [TenantModulesController],
  providers: [DatabasePoolProvider],
})
export class TenantModulesModule {}
