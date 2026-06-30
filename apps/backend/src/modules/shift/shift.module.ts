import { Module } from '@nestjs/common';
import { ShiftController } from './shift.controller';
import { ShiftService } from './shift.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [ShiftController],
  providers: [ShiftService, DatabasePoolProvider],
  exports: [ShiftService],
})
export class ShiftModule {}
