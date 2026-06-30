import { Module } from '@nestjs/common';
import { VoucherTicketController } from './voucher-ticket.controller';
import { VoucherTicketService } from './voucher-ticket.service';
import { DatabasePoolProvider } from '../auth/database.provider';
import { NotificationModule } from '../notification';

@Module({
  imports: [NotificationModule],
  controllers: [VoucherTicketController],
  providers: [VoucherTicketService, DatabasePoolProvider],
  exports: [VoucherTicketService],
})
export class VoucherTicketModule {}

export { VoucherTicketService } from './voucher-ticket.service';
