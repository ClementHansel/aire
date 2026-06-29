import { Module } from '@nestjs/common';
import { KioskController } from './kiosk.controller';
import { KioskService } from './kiosk.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [KioskController],
  providers: [KioskService, DatabasePoolProvider],
  exports: [KioskService],
})
export class KioskModule {}
