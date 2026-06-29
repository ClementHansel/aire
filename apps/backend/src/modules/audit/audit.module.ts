import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [AuditController],
  providers: [AuditService, DatabasePoolProvider],
  exports: [AuditService],
})
export class AuditModule {}
