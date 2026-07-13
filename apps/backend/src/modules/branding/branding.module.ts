import { Module } from '@nestjs/common';
import { BrandingController, PublicBrandingController, PublicTenantController } from './branding.controller';
import { BrandingService } from './branding.service';
import { DatabasePoolProvider } from '../auth/database.provider';
import { AuthModule } from '../auth';

/**
 * Branding Module.
 *
 * Per-tenant branding (colors, fonts, logo, dark-mode policy) stored in
 * tenants.settings. Read by the app shell; written by the tenant owner.
 */
@Module({
  imports: [AuthModule],
  controllers: [BrandingController, PublicBrandingController, PublicTenantController],
  providers: [BrandingService, DatabasePoolProvider],
  exports: [BrandingService],
})
export class BrandingModule {}
