import { Controller, Delete, Get, Put, Body, Query, Res, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { MembershipCardService, CardTemplate, CardSide } from './membership-card.service';
import { readUploadedImage, streamImage } from '../storage/upload.util';

/** Coerce an untrusted ?side= value to a valid card side (defaults to front). */
function parseSide(side?: string): CardSide {
  return side === 'back' ? 'back' : 'front';
}

/** Membership card template designer. Read by any staff (to render cards); edited by OutletAdmin+. */
@Controller('api/membership-card')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MembershipCardController {
  constructor(private readonly service: MembershipCardService) {}

  @Get()
  get(@CurrentUser() user: JWTPayload) {
    return this.service.get(user.tenant_id);
  }

  @Put()
  @Roles(Role.OutletAdmin)
  set(@CurrentUser() user: JWTPayload, @Body() body: CardTemplate) {
    return this.service.set(user.tenant_id, body);
  }

  /** PUT /api/membership-card/background?side=front|back — upload the card background (multipart). */
  @Put('background')
  @Roles(Role.OutletAdmin)
  @UseInterceptors(FileInterceptor('file', { limits: { files: 1 } }))
  async setBackground(@CurrentUser() user: JWTPayload, @UploadedFile() file: Express.Multer.File, @Query('side') side?: string): Promise<CardTemplate> {
    const { buffer, contentType } = readUploadedImage(file);
    return this.service.setBackground(user.tenant_id, buffer, contentType, parseSide(side));
  }

  /** DELETE /api/membership-card/background?side=front|back — remove the card background. */
  @Delete('background')
  @Roles(Role.OutletAdmin)
  removeBackground(@CurrentUser() user: JWTPayload, @Query('side') side?: string): Promise<CardTemplate> {
    return this.service.removeBackground(user.tenant_id, parseSide(side));
  }
}

/**
 * Public read of the card TEMPLATE (design only — background + field layout, no
 * member data) so the kiosk and public menu can render a member's card after the
 * member has identified themselves. No auth: the template is not sensitive.
 */
@Controller('api/public/card-template')
export class PublicMembershipCardController {
  constructor(private readonly service: MembershipCardService) {}

  @Get()
  get(@Query('tenantId') tenantId: string) {
    return this.service.get(tenantId);
  }

  /** GET /api/public/card-template/background?tenantId=&side=front|back — stream the card bg image. */
  @Get('background')
  async background(@Query('tenantId') tenantId: string, @Query('side') side: string | undefined, @Res() res: Response): Promise<void> {
    const obj = tenantId ? await this.service.getBackground(tenantId, parseSide(side)) : null;
    streamImage(res, obj);
  }
}
