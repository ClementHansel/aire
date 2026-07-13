import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * Global so any module (branding, membership-card, future photo uploads) can
 * inject StorageService without re-importing.
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
