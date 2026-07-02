import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { JWTPayload } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
import { ScopeService } from '../../common/scope/scope.service';
import { SalesService, CreateLeadDto, SetTargetDto } from './sales.service';

@Controller('api/sales')
@UseGuards(JwtAuthGuard)
export class SalesController {
  constructor(
    private readonly service: SalesService,
    private readonly scope: ScopeService,
  ) {}

  @Get('summary')
  async summary(@CurrentUser() user: JWTPayload, @Query('outletId') outletId?: string) {
    const ids = await this.scope.resolveOutletIds(user, outletId);
    return this.service.summary(user.tenant_id, ids);
  }

  @Get('leads')
  leads(@CurrentUser() user: JWTPayload, @Query('status') status?: string) {
    return this.service.listLeads(user.tenant_id, status);
  }

  @Post('leads')
  @HttpCode(HttpStatus.CREATED)
  createLead(@CurrentUser() user: JWTPayload, @Body() dto: CreateLeadDto) {
    return this.service.createLead(user.tenant_id, dto, user.sub);
  }

  @Patch('leads/:id/status')
  updateStatus(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() body: { status: string }) {
    return this.service.updateLeadStatus(user.tenant_id, id, body.status, user.sub);
  }

  @Post('targets')
  @HttpCode(HttpStatus.CREATED)
  setTarget(@CurrentUser() user: JWTPayload, @Body() dto: SetTargetDto) {
    return this.service.setTarget(user.tenant_id, dto, user.sub);
  }
}
