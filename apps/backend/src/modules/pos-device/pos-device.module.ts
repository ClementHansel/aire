import { Module } from '@nestjs/common';
import { PosDeviceController } from './pos-device.controller';
import { PosDeviceService } from './pos-device.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [PosDeviceController],
  providers: [PosDeviceService, DatabasePoolProvider],
  exports: [PosDeviceService],
})
export class PosDeviceModule {}
