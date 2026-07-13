import { Module } from '@nestjs/common';
import { BroadcastController } from './broadcast.controller';
import { BroadcastService } from './broadcast.service';
import { WhatsappModule } from '../whatsapp';
import { DatabasePoolProvider } from '../auth/database.provider';

/**
 * WhatsApp marketing broadcast / campaign blast. Depends on WhatsappModule for
 * the throttled send seam (which honours WAHA_MOCK for dry-runs).
 */
@Module({
  imports: [WhatsappModule],
  controllers: [BroadcastController],
  providers: [BroadcastService, DatabasePoolProvider],
  exports: [BroadcastService],
})
export class BroadcastModule {}
