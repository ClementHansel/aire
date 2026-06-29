import { Module } from '@nestjs/common';
import { BayController } from './bay.controller';
import { BayService } from './bay.service';
import { DatabasePoolProvider } from '../auth/database.provider';
import { RealtimeModule } from '../realtime';

@Module({
  imports: [RealtimeModule],
  controllers: [BayController],
  providers: [BayService, DatabasePoolProvider],
  exports: [BayService],
})
export class BayModule {}
