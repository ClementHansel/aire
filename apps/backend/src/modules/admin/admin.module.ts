import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [AdminController],
  providers: [AdminService, DatabasePoolProvider],
  exports: [AdminService],
})
export class AdminModule {}
