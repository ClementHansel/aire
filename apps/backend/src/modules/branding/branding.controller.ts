import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Role, JWTPayload } from '@aire/shared';
import { Roles, CurrentUser } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { JwtAuthGuard } from '../auth/auth.guard';
import {
  BrandingService,
  BrandingConfig,
  PublicBranding,
  PublicTenantRef,
  DEFAULT_BRANDING,
} from './branding.service';
import { readUploadedImage, streamImage } from '../storage/upload.util';

/**
 * Branding controller.
 *
 * Read is available to any authenticated user (the app shell needs it to theme
 * the dashboard). Writes are restricted to the tenant owner.
 */
@Controller('api/branding')
@UseGuards(JwtAuthGuard)
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  /** GET /api/branding/me — branding for the current user's tenant. */
  @Get('me')
  async myBranding(@CurrentUser() user: JWTPayload): Promise<PublicBranding> {
    return this.branding.getBranding(user.tenant_id);
  }

  /** PUT /api/branding — save colors/fonts/dark-mode policy (owner only). */
  @Put()
  @UseGuards(RolesGuard)
  @Roles(Role.TenantOwner)
  async saveBranding(
    @CurrentUser() user: JWTPayload,
    @Body() body: BrandingConfig,
  ): Promise<BrandingConfig> {
    return this.branding.setBranding(user.tenant_id, body);
  }

  /** PUT /api/branding/logo — upload the logo image (multipart, owner only). */
  @Put('logo')
  @UseGuards(RolesGuard)
  @Roles(Role.TenantOwner)
  @UseInterceptors(FileInterceptor('file', { limits: { files: 1 } }))
  async saveLogo(
    @CurrentUser() user: JWTPayload,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ logo_url: string }> {
    const { buffer, contentType } = readUploadedImage(file);
    const logo_url = await this.branding.setLogo(user.tenant_id, buffer, contentType);
    return { logo_url };
  }

  /** DELETE /api/branding/logo — remove the logo (owner only). */
  @Delete('logo')
  @UseGuards(RolesGuard)
  @Roles(Role.TenantOwner)
  async deleteLogo(@CurrentUser() user: JWTPayload): Promise<{ ok: true }> {
    await this.branding.removeLogo(user.tenant_id);
    return { ok: true };
  }
}

/**
 * Public branding read + logo stream — so the pre-login customer-facing pages
 * (kiosk, menu, queue board) and every <img> can show the tenant's logo/colors.
 * No auth: branding is public-facing by nature (shown to walk-in customers).
 */
@Controller('api/public/branding')
export class PublicBrandingController {
  constructor(private readonly branding: BrandingService) {}

  @Get()
  async get(@Query('tenantId') tenantId: string): Promise<PublicBranding> {
    // Unknown/omitted tenant → default theme (never 404): a public page should
    // always render, just un-branded.
    try {
      return await this.branding.getBranding(tenantId);
    } catch {
      return { company_name: '', legal_name: '', logo_url: null, branding: DEFAULT_BRANDING, tenant_code: null, slug: null };
    }
  }

  /** GET /api/public/branding/logo?tenantId= — stream the tenant's logo image. */
  @Get('logo')
  async logo(@Query('tenantId') tenantId: string, @Res() res: Response): Promise<void> {
    const obj = tenantId ? await this.branding.getLogo(tenantId) : null;
    streamImage(res, obj);
  }
}

/**
 * Public tenant resolver — turns a URL segment (slug OR uuid) into the canonical
 * tenant identity, so customer-facing pages can use pretty slug URLs
 * (/menu/airin-demo) while old UUID links keep working. No auth by design.
 */
@Controller('api/public/tenant')
export class PublicTenantController {
  constructor(private readonly branding: BrandingService) {}

  /** GET /api/public/tenant/:ref → { id, slug, name }. 404 when unknown. */
  @Get(':ref')
  async resolve(@Param('ref') ref: string): Promise<PublicTenantRef> {
    return this.branding.resolveTenantRef(ref);
  }
}
