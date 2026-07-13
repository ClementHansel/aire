import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { AccountingPoster } from './accounting-poster.service';
import { DatabasePoolProvider } from '../auth/database.provider';

/**
 * Double-entry bookkeeping. AccountingService owns the ledger; AccountingPoster
 * subscribes to money events (order.paid, expense, payroll.finalized) on init and
 * auto-posts balanced journal entries.
 */
@Module({
  controllers: [AccountingController],
  providers: [AccountingService, AccountingPoster, DatabasePoolProvider],
  exports: [AccountingService, AccountingPoster],
})
export class AccountingModule {}
