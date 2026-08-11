import { Module, forwardRef } from '@nestjs/common';
import { WhatsappController, WhatsappWebhookController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { CustomerContextService } from './customer-context.service';
import { CustomerAgentService } from './customer-agent.service';
import { PendingBookingService } from './pending-booking.service';
import { AgentRuntimeService } from './agent-runtime.service';
import { VoucherNotifyService } from './voucher-notify.service';
import { VoucherRedeemNotifyService } from './voucher-redeem-notify.service';
import { PaymentNotifyService } from './payment-notify.service';
import { WaWhitelistService } from './wa-whitelist.service';
import { DatabasePoolProvider } from '../auth/database.provider';
import { SettingsModule } from '../settings/settings.module';
import { AgentModule } from '../agent';
import { BookingModule } from '../booking';
import { AuditModule } from '../audit';

@Module({
  // NotificationModule is deliberately absent: the dependency now runs the other
  // way (NotificationService sends THROUGH WhatsappService). WhatsappModule
  // still reaches it transitively via AgentModule, which is why the other side
  // uses forwardRef.
  //
  // AgentModule is forwardRef'd because there IS a module cycle here —
  // AgentModule → NotificationModule → (forwardRef) WhatsappModule → AgentModule.
  // BOTH sides of a cycle need forwardRef: with only one side wrapped, whether
  // the plain import resolves depends on which module the scanner happens to
  // reach first, so an unrelated new edge elsewhere in the graph can turn a
  // working boot into "the module at index [1] is undefined" (it did: adding
  // AdminModule → AgentModule for the platform AI console).
  imports: [SettingsModule, forwardRef(() => AgentModule), BookingModule, AuditModule],
  controllers: [WhatsappWebhookController, WhatsappController],
  providers: [
    WhatsappService, CustomerContextService, CustomerAgentService, PendingBookingService, AgentRuntimeService,
    VoucherNotifyService, VoucherRedeemNotifyService, PaymentNotifyService, WaWhitelistService, DatabasePoolProvider,
  ],
  // PaymentNotifyService is exported now that the receipt message is sent on the
  // cashier's command rather than by an event subscription (AIRIN-168).
  exports: [WhatsappService, CustomerContextService, CustomerAgentService, PendingBookingService, PaymentNotifyService, WaWhitelistService],
})
export class WhatsappModule {}

export { WhatsappService } from './whatsapp.service';
export { PaymentNotifyService } from './payment-notify.service';
export { CustomerContextService } from './customer-context.service';
export { CustomerAgentService } from './customer-agent.service';
export { WaWhitelistService } from './wa-whitelist.service';
