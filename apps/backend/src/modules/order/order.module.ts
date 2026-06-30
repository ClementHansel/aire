import { Module } from '@nestjs/common';
import { OrderController } from './order.controller';
import { OrderListService } from './order-list.service';
import { OrderService } from './order.service';
import { PosCheckoutService } from './pos-checkout.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [OrderController],
  providers: [OrderListService, OrderService, PosCheckoutService, DatabasePoolProvider],
  exports: [OrderListService, OrderService, PosCheckoutService],
})
export class OrderModule {}
