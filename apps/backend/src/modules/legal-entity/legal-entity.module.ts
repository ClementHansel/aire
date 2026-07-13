import { Module } from '@nestjs/common';
import { LegalEntityController } from './legal-entity.controller';
import { LegalEntityService } from './legal-entity.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [LegalEntityController],
  providers: [LegalEntityService, DatabasePoolProvider],
  exports: [LegalEntityService],
})
export class LegalEntityModule {}
