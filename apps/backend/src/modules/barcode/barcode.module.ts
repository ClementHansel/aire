import { Module } from '@nestjs/common';
import { BarcodeController } from './barcode.controller';
import { BarcodeService } from './barcode.service';
import { DatabasePoolProvider } from '../auth/database.provider';

/**
 * Barcode feature module — per-tenant config for scan-to-cart + label printing.
 * Registered in the root module alongside the other feature modules.
 */
@Module({
  controllers: [BarcodeController],
  providers: [BarcodeService, DatabasePoolProvider],
  exports: [BarcodeService],
})
export class BarcodeModule {}
