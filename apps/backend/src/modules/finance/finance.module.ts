import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [FinanceController],
  providers: [FinanceService, DatabasePoolProvider],
  exports: [FinanceService],
})
export class FinanceModule {}
