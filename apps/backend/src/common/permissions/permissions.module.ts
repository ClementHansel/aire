import { Global, Module } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { PermissionsGuard } from './permissions.guard';
import { DatabasePoolProvider } from '../../modules/auth/database.provider';

/**
 * Global RBAC layer. Provides PermissionsService (effective-permission resolver)
 * and PermissionsGuard so any controller can use @RequirePermission() +
 * @UseGuards(..., PermissionsGuard) without per-module wiring.
 */
@Global()
@Module({
  providers: [PermissionsService, PermissionsGuard, DatabasePoolProvider],
  exports: [PermissionsService, PermissionsGuard],
})
export class PermissionsModule {}
