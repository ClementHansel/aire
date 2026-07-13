import { Module } from '@nestjs/common';
import { FeedbackController, PublicFeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { WhatsappModule } from '../whatsapp';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  imports: [WhatsappModule],
  controllers: [FeedbackController, PublicFeedbackController],
  providers: [FeedbackService, DatabasePoolProvider],
  exports: [FeedbackService],
})
export class FeedbackModule {}
