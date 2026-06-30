import { Module } from '@nestjs/common';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [HrController, PayrollController],
  providers: [HrService, PayrollService, DatabasePoolProvider],
  exports: [HrService, PayrollService],
})
export class HrModule {}
