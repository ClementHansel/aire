import { Body, Controller, Get, Post, Put, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { FeedbackService, FeedbackConfig, SubmitFeedbackDto } from './feedback.service';

/**
 * Authed feedback analytics + config. Reads are open to OutletAdmin+; the enable
 * toggle / thanks message is written by the tenant owner only.
 */
@Controller('api/feedback')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FeedbackController {
  constructor(private readonly service: FeedbackService) {}

  @Get('summary')
  @Roles(Role.OutletAdmin)
  summary(
    @CurrentUser() user: JWTPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('outletId') outletId?: string,
  ) {
    return this.service.summary(user.tenant_id, { from, to, outletId });
  }

  @Get('responses')
  @Roles(Role.OutletAdmin)
  responses(
    @CurrentUser() user: JWTPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('outletId') outletId?: string,
  ) {
    return this.service.responses(user.tenant_id, { from, to, outletId });
  }

  @Get('config')
  @Roles(Role.OutletAdmin)
  getConfig(@CurrentUser() user: JWTPayload) {
    return this.service.getConfig(user.tenant_id);
  }

  @Put('config')
  @Roles(Role.TenantOwner)
  setConfig(@CurrentUser() user: JWTPayload, @Body() body: Partial<FeedbackConfig>) {
    return this.service.setConfig(user.tenant_id, body ?? {});
  }
}

/**
 * Public (no-auth) feedback form endpoints. The unguessable token in the URL is
 * the only credential — modeled on the public booking-confirm / kiosk endpoints.
 */
@Controller('api/public/feedback')
export class PublicFeedbackController {
  constructor(private readonly service: FeedbackService) {}

  @Get(':token')
  get(@Param('token') token: string) {
    return this.service.getPublic(token);
  }

  @Post(':token')
  @HttpCode(HttpStatus.OK)
  submit(@Param('token') token: string, @Body() body: SubmitFeedbackDto) {
    return this.service.submit(token, body ?? ({} as SubmitFeedbackDto));
  }
}
