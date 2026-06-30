import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [SalesController],
  providers: [SalesService, DatabasePoolProvider],
  exports: [SalesService],
})
export class SalesModule {}
