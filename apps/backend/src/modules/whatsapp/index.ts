import { Module } from '@nestjs/common';
import { WhatsappController, WhatsappWebhookController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { CustomerContextService } from './customer-context.service';
import { AgentRuntimeService } from './agent-runtime.service';
import { DatabasePoolProvider } from '../auth/database.provider';
import { NotificationModule } from '../notification';
import { SettingsModule } from '../settings/settings.module';
import { AgentModule } from '../agent';

@Module({
  imports: [NotificationModule, SettingsModule, AgentModule],
  controllers: [WhatsappWebhookController, WhatsappController],
  providers: [WhatsappService, CustomerContextService, AgentRuntimeService, DatabasePoolProvider],
  exports: [WhatsappService],
})
export class WhatsappModule {}

export { WhatsappService } from './whatsapp.service';
