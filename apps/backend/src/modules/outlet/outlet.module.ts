import { Module } from '@nestjs/common';
import { OutletController } from './outlet.controller';
import { OutletService } from './outlet.service';
import { DatabasePoolProvider } from '../auth/database.provider';
import { EntitlementModule } from '../entitlement';

@Module({
  imports: [EntitlementModule],
  controllers: [OutletController],
  providers: [OutletService, DatabasePoolProvider],
  exports: [OutletService],
})
export class OutletModule {}
