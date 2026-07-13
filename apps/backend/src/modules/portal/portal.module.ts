import { Module } from '@nestjs/common';
import { PortalController, PublicBookingController } from './portal.controller';
import { PortalAuthService } from './portal-auth.service';
import { PortalDataService } from './portal-data.service';
import { PortalRenewService } from './portal-renew.service';
import { PortalBookingService } from './portal-booking.service';
import { PortalGuard } from './portal.guard';
import { DatabasePoolProvider } from '../auth/database.provider';
import { AuthModule } from '../auth';
import { MembershipModule } from '../membership/membership.module';
import { OrderModule } from '../order';
import { WhatsappModule } from '../whatsapp';
import { PaymentModule } from '../payment/payment.module';

/**
 * Customer portal — WhatsApp-OTP login + customer-scoped reads/actions (profile,
 * history, live queue, online renewal via QRIS, and bookings with a per-branch
 * WhatsApp cashier-confirm gate before entering the queue).
 */
@Module({
  imports: [AuthModule, MembershipModule, OrderModule, WhatsappModule, PaymentModule],
  controllers: [PortalController, PublicBookingController],
  providers: [
    PortalAuthService,
    PortalDataService,
    PortalRenewService,
    PortalBookingService,
    PortalGuard,
    DatabasePoolProvider,
  ],
})
export class PortalModule {}
