import { Module } from '@nestjs/common';
import { ServiceController } from './service.controller';
import { ServiceService } from './service.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [ServiceController],
  providers: [ServiceService, DatabasePoolProvider],
  exports: [ServiceService],
})
export class ServiceModule {}
