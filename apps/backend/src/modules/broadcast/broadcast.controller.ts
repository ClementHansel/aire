import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../../common/guards';
import { CurrentUser, Roles } from '../../common/decorators';
import {
  BroadcastService,
  CreateCampaignDto,
  UpdateCampaignDto,
  StartCampaignDto,
  AudienceSegment,
} from './broadcast.service';

/**
 * WhatsApp marketing broadcast API. Owner-only — bulk outbound carries a real
 * account-ban risk, so it sits behind the tenant owner role.
 */
@Controller('api/broadcast')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TenantOwner)
export class BroadcastController {
  constructor(private readonly service: BroadcastService) {}

  @Get('campaigns')
  list(@CurrentUser() user: JWTPayload) {
    return this.service.listCampaigns(user.tenant_id);
  }

  @Post('campaigns')
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JWTPayload, @Body() dto: CreateCampaignDto) {
    return this.service.createCampaign(user.tenant_id, dto, user.sub);
  }

  @Get('audience/preview')
  previewAudience(
    @CurrentUser() user: JWTPayload,
    @Query('segment') segment: AudienceSegment,
    @Query('tag') tag?: string,
    @Query('outletId') outletId?: string,
    @Query('includeNoConsent') includeNoConsent?: string,
  ) {
    return this.service.previewAudience(
      user.tenant_id,
      { segment, tag: tag ?? null, outletId: outletId ?? null },
      includeNoConsent === 'true' || includeNoConsent === '1',
    );
  }

  @Patch('consent')
  setConsent(
    @CurrentUser() user: JWTPayload,
    @Body() body: { phone?: string; customerId?: string; consent: boolean },
  ) {
    return this.service.setConsent(user.tenant_id, body);
  }

  @Get('campaigns/:id')
  get(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.getCampaign(user.tenant_id, id);
  }

  @Patch('campaigns/:id')
  update(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() dto: UpdateCampaignDto) {
    return this.service.updateCampaign(user.tenant_id, id, dto);
  }

  @Get('campaigns/:id/recipients')
  recipients(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.listRecipients(user.tenant_id, id);
  }

  @Post('campaigns/:id/start')
  @HttpCode(HttpStatus.OK)
  start(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() dto: StartCampaignDto) {
    return this.service.startCampaign(user.tenant_id, id, dto);
  }

  @Post('campaigns/:id/pause')
  @HttpCode(HttpStatus.OK)
  pause(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.pauseCampaign(user.tenant_id, id);
  }

  @Post('campaigns/:id/resume')
  @HttpCode(HttpStatus.OK)
  resume(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.resumeCampaign(user.tenant_id, id);
  }

  @Post('campaigns/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.cancelCampaign(user.tenant_id, id);
  }
}
