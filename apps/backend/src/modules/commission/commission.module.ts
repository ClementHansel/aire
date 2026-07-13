import { Module } from '@nestjs/common';
import { CommissionController } from './commission.controller';
import { CommissionService } from './commission.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [CommissionController],
  providers: [CommissionService, DatabasePoolProvider],
  exports: [CommissionService],
})
export class CommissionModule {}
