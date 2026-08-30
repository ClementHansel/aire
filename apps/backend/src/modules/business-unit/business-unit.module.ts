import { Module } from '@nestjs/common';
import { BusinessUnitController } from './business-unit.controller';
import { BusinessUnitService } from './business-unit.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [BusinessUnitController],
  providers: [BusinessUnitService, DatabasePoolProvider],
  exports: [BusinessUnitService],
})
export class BusinessUnitModule {}
