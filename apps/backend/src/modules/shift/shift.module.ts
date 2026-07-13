import { Module } from '@nestjs/common';
import { ShiftController } from './shift.controller';
import { ShiftService } from './shift.service';
import { DatabasePoolProvider } from '../auth/database.provider';
import { OnboardingCompleteGuard } from '../../common/guards';

@Module({
  controllers: [ShiftController],
  providers: [ShiftService, DatabasePoolProvider, OnboardingCompleteGuard],
  exports: [ShiftService],
})
export class ShiftModule {}
