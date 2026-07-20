import { Module } from '@nestjs/common';
import { WhatsappController, WhatsappWebhookController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { CustomerContextService } from './customer-context.service';
import { CustomerAgentService } from './customer-agent.service';
import { PendingBookingService } from './pending-booking.service';
import { AgentRuntimeService } from './agent-runtime.service';
import { VoucherNotifyService } from './voucher-notify.service';
import { PaymentNotifyService } from './payment-notify.service';
import { DatabasePoolProvider } from '../auth/database.provider';
import { NotificationModule } from '../notification';
import { SettingsModule } from '../settings/settings.module';
import { AgentModule } from '../agent';
import { BookingModule } from '../booking';
import { AuditModule } from '../audit';

@Module({
  imports: [NotificationModule, SettingsModule, AgentModule, BookingModule, AuditModule],
  controllers: [WhatsappWebhookController, WhatsappController],
  providers: [
    WhatsappService, CustomerContextService, CustomerAgentService, PendingBookingService, AgentRuntimeService,
    VoucherNotifyService, PaymentNotifyService, DatabasePoolProvider,
  ],
  exports: [WhatsappService, CustomerContextService, CustomerAgentService, PendingBookingService],
})
export class WhatsappModule {}

export { WhatsappService } from './whatsapp.service';
export { CustomerContextService } from './customer-context.service';
export { CustomerAgentService } from './customer-agent.service';
