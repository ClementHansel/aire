import { Global, Module } from '@nestjs/common';
import { BusinessUnitController } from './business-unit.controller';
import { BusinessUnitService } from './business-unit.service';
import { DatabasePoolProvider } from '../auth/database.provider';

/**
 * Global because `resolveCode`/`defaultCode` are needed by any module that
 * WRITES a business_unit column (kiosk, portal bookings, vouchers, POS). Those
 * sites previously fell back to a hardcoded 'AIRE'; resolving the tenant's own
 * unit instead should not require every one of them to grow a module import.
 */
@Global()
@Module({
  controllers: [BusinessUnitController],
  providers: [BusinessUnitService, DatabasePoolProvider],
  exports: [BusinessUnitService],
})
export class BusinessUnitModule {}
