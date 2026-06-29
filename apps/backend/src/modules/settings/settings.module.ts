import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { DatabasePoolProvider } from '../auth/database.provider';
import { AuditModule } from '../audit/audit.module';

/**
 * Settings Module.
 *
 * Provides per-tenant automation settings management with JSON Schema
 * validation, AES-256-GCM encryption for sensitive fields, and audit logging.
 *
 * Requirements: 1.1, 12.1
 */
@Module({
  imports: [AuditModule],
  controllers: [SettingsController],
  providers: [SettingsService, DatabasePoolProvider],
  exports: [SettingsService],
})
export class SettingsModule {}
