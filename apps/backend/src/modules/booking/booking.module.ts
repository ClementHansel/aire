import { Module } from '@nestjs/common';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [BookingController],
  providers: [BookingService, DatabasePoolProvider],
  exports: [BookingService],
})
export class BookingModule {}
