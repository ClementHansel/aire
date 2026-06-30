import { Module } from '@nestjs/common';
import { OrderController } from './order.controller';
import { OrderListService } from './order-list.service';
import { OrderService } from './order.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [OrderController],
  providers: [OrderListService, OrderService, DatabasePoolProvider],
  exports: [OrderListService, OrderService],
})
export class OrderModule {}
