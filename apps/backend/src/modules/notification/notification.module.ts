import { Module, forwardRef } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { SettingsModule } from '../settings/settings.module';
import { WhatsappModule } from '../whatsapp';

@Module({
  // forwardRef: NotificationService now delivers through WhatsappService (the
  // platform's real WAHA/kirimdev line) instead of the never-configured Meta
  // Business API. WhatsappModule still reaches this module transitively through
  // AgentModule, so the reference is genuinely mutual.
  imports: [SettingsModule, forwardRef(() => WhatsappModule)],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
