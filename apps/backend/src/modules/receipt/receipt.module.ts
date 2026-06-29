import { Module } from '@nestjs/common';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [InvoiceController],
  providers: [InvoiceService, DatabasePoolProvider],
  exports: [InvoiceService],
})
export class ReceiptModule {}
