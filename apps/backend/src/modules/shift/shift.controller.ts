import { Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { JWTPayload } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, RequiresOnboarding } from '../../common/decorators';
import { OnboardingCompleteGuard } from '../../common/guards';
import { ShiftService, OpenShiftDto, CloseShiftDto, PettyCashDto, ShiftIssueDto } from './shift.service';

@Controller('api/shifts')
@UseGuards(JwtAuthGuard, OnboardingCompleteGuard)
@RequiresOnboarding()
export class ShiftController {
  constructor(private readonly service: ShiftService) {}

  @Get('current')
  current(@CurrentUser() user: JWTPayload) {
    return this.service.current(user);
  }

  @Get()
  list(
    @CurrentUser() user: JWTPayload,
    @Query('outletId') outletId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.service.list(user.tenant_id, { outletId, dateFrom, dateTo });
  }

  @Get(':id')
  details(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.details(user.tenant_id, id);
  }

  @Post('open')
  @HttpCode(HttpStatus.CREATED)
  open(@CurrentUser() user: JWTPayload, @Body() dto: OpenShiftDto) {
    return this.service.open(user, dto);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  close(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() dto: CloseShiftDto) {
    return this.service.close(user, id, dto);
  }

  @Post(':id/petty-cash')
  @HttpCode(HttpStatus.CREATED)
  pettyCash(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() dto: PettyCashDto) {
    return this.service.addPettyCash(user, id, dto);
  }

  @Post(':id/issues')
  @HttpCode(HttpStatus.CREATED)
  issue(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() dto: ShiftIssueDto) {
    return this.service.addIssue(user, id, dto);
  }
}
