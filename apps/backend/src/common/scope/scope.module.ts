import { Global, Module } from '@nestjs/common';
import { ScopeService } from './scope.service';
import { DatabasePoolProvider } from '../../modules/auth/database.provider';

/**
 * Global provider for ScopeService so any controller can resolve a user's
 * allowed branch set without per-module wiring.
 */
@Global()
@Module({
  providers: [ScopeService, DatabasePoolProvider],
  exports: [ScopeService],
})
export class ScopeModule {}
