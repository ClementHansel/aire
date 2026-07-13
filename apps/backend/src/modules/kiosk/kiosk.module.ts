import { Module } from '@nestjs/common';
import { KioskController } from './kiosk.controller';
import { KioskDeviceController } from './kiosk-device.controller';
import { KioskService } from './kiosk.service';
import { KioskOrderService } from './kiosk-order.service';
import { KioskDeviceService } from './kiosk-device.service';
import { KioskTokenGuard } from './kiosk-token.guard';
import { OrderModule } from '../order/order.module';
import { PaymentModule } from '../payment/payment.module';
import { MembershipModule } from '../membership/membership.module';
import { ShiftModule } from '../shift/shift.module';
import { VehicleCatalogModule } from '../vehicle-catalog/vehicle-catalog.module';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  imports: [OrderModule, PaymentModule, MembershipModule, ShiftModule, VehicleCatalogModule],
  controllers: [KioskController, KioskDeviceController],
  providers: [
    KioskService,
    KioskOrderService,
    KioskDeviceService,
    KioskTokenGuard,
    DatabasePoolProvider,
  ],
  exports: [KioskService],
})
export class KioskModule {}
