import { Controller, Get, Post, Put, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { FinanceSetupService, FinanceSettingsPatch, OpeningBalances } from './finance-setup.service';

@Controller('api/finance-setup')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TenantOwner)
export class FinanceSetupController {
  constructor(private readonly service: FinanceSetupService) {}

  @Get()
  settings(@CurrentUser() user: JWTPayload) {
    return this.service.getSettings(user.tenant_id);
  }

  @Put()
  update(@CurrentUser() user: JWTPayload, @Body() patch: FinanceSettingsPatch) {
    return this.service.updateSettings(user.tenant_id, patch);
  }

  @Get('status')
  status(@CurrentUser() user: JWTPayload) {
    return this.service.status(user.tenant_id);
  }

  /** One-click: seed chart of accounts, record opening balances, backfill postings. */
  @Post('provision')
  @HttpCode(HttpStatus.OK)
  provision(@CurrentUser() user: JWTPayload, @Body() body: { openingBalances?: OpeningBalances }) {
    return this.service.provision(user.tenant_id, body?.openingBalances, user.sub, new Date());
  }

  /** Manual trigger for the pay-day/close automation (also runs on a daily timer). */
  @Post('run-automation')
  @HttpCode(HttpStatus.OK)
  runAutomation(@CurrentUser() user: JWTPayload, @Body() body: { asOf?: string }) {
    const now = body?.asOf ? new Date(body.asOf) : new Date();
    return this.service.runAutomation(user.tenant_id, now, user.sub);
  }
}
