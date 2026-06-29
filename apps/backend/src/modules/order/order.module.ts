import { Module } from '@nestjs/common';
import { OrderController } from './order.controller';
import { OrderListService } from './order-list.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [OrderController],
  providers: [OrderListService, DatabasePoolProvider],
  exports: [OrderListService],
})
export class OrderModule {}
