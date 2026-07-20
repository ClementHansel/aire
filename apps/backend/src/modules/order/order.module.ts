import { Module } from '@nestjs/common';
import { OrderController } from './order.controller';
import { OrderListService } from './order-list.service';
import { OrderService } from './order.service';
import { PosCheckoutService } from './pos-checkout.service';
import { PublicReceiptController } from './public-receipt.controller';
import { DatabasePoolProvider } from '../auth/database.provider';
import { OnboardingCompleteGuard } from '../../common/guards';

@Module({
  controllers: [OrderController, PublicReceiptController],
  providers: [OrderListService, OrderService, PosCheckoutService, DatabasePoolProvider, OnboardingCompleteGuard],
  exports: [OrderListService, OrderService, PosCheckoutService],
})
export class OrderModule {}
