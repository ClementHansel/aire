import { Module } from '@nestjs/common';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [HrController],
  providers: [HrService, DatabasePoolProvider],
  exports: [HrService],
})
export class HrModule {}
