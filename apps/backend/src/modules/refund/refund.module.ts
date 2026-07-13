import { Module } from '@nestjs/common';
import { RefundController } from './refund.controller';
import { RefundService } from './refund.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [RefundController],
  providers: [RefundService, DatabasePoolProvider],
  exports: [RefundService],
})
export class RefundModule {}
