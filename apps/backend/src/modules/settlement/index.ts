import { Module } from '@nestjs/common';
import { SettlementController } from './settlement.controller';
import { SettlementService } from './settlement.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [SettlementController],
  providers: [SettlementService, DatabasePoolProvider],
  exports: [SettlementService],
})
export class SettlementModule {}

export { SettlementService } from './settlement.service';
