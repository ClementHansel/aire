import { Module } from '@nestjs/common';
import { FinanceSetupController } from './finance-setup.controller';
import { FinanceSetupService } from './finance-setup.service';
import { DatabasePoolProvider } from '../auth/database.provider';
import { AccountingModule } from '../accounting/accounting.module';
import { HrModule } from '../hr/hr.module';

/**
 * Zero-config Finance/HR setup + automation. Depends on AccountingModule
 * (ledger + poster) and HrModule (payroll) to orchestrate one-click provisioning
 * and pay-day automation.
 */
@Module({
  imports: [AccountingModule, HrModule],
  controllers: [FinanceSetupController],
  providers: [FinanceSetupService, DatabasePoolProvider],
  exports: [FinanceSetupService],
})
export class FinanceSetupModule {}
