import { Module } from '@nestjs/common';
import { TaxInvoiceController } from './tax-invoice.controller';
import { TaxInvoiceService } from './tax-invoice.service';
import { DatabasePoolProvider } from '../auth/database.provider';

@Module({
  controllers: [TaxInvoiceController],
  providers: [TaxInvoiceService, DatabasePoolProvider],
  exports: [TaxInvoiceService],
})
export class TaxInvoiceModule {}
