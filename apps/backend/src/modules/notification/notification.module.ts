import { Module, forwardRef } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationTemplateController } from './notification-template.controller';
import { SettingsModule } from '../settings/settings.module';
import { DatabasePoolProvider } from '../auth/database.provider';
import { WhatsappModule } from '../whatsapp';

@Module({
  // forwardRef: NotificationService now delivers through WhatsappService (the
  // platform's real WAHA/kirimdev line) instead of the never-configured Meta
  // Business API. WhatsappModule still reaches this module transitively through
  // AgentModule, so the reference is genuinely mutual.
  // The renderer comes from the global NotificationRendererModule — every
  // sending module needs it, including WhatsappModule, which this module cannot
  // export to without a cycle.
  imports: [SettingsModule, forwardRef(() => WhatsappModule)],
  controllers: [NotificationTemplateController],
  // DatabasePoolProvider: the controller is guarded by RlsContextGuard, which is
  // instantiated in THIS module's injector and needs DATABASE_POOL there. Without
  // it Nest fails to boot ("can't resolve dependencies of the RlsContextGuard").
  providers: [NotificationService, DatabasePoolProvider],
  exports: [NotificationService],
})
export class NotificationModule {}
