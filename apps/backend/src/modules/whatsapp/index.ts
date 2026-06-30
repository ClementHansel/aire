import { Module } from '@nestjs/common';
import { WhatsappController, WhatsappWebhookController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { DatabasePoolProvider } from '../auth/database.provider';
import { NotificationModule } from '../notification';

@Module({
  imports: [NotificationModule],
  controllers: [WhatsappWebhookController, WhatsappController],
  providers: [WhatsappService, DatabasePoolProvider],
  exports: [WhatsappService],
})
export class WhatsappModule {}

export { WhatsappService } from './whatsapp.service';
