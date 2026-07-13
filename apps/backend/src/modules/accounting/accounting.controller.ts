import { Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { AccountingService, PostEntryInput } from './accounting.service';
import { AccountingPoster } from './accounting-poster.service';

@Controller('api/accounting')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TenantOwner)
export class AccountingController {
  constructor(
    private readonly service: AccountingService,
    private readonly poster: AccountingPoster,
  ) {}

  // ── Chart of accounts ──
  @Get('accounts')
  accounts(@CurrentUser() user: JWTPayload) {
    return this.service.listAccounts(user.tenant_id);
  }

  @Post('accounts')
  @HttpCode(HttpStatus.CREATED)
  createAccount(@CurrentUser() user: JWTPayload, @Body() dto: { code: string; name: string; type: string; normalBalance?: string }) {
    return this.service.createAccount(user.tenant_id, dto);
  }

  @Post('seed-defaults')
  @HttpCode(HttpStatus.OK)
  seedDefaults(@CurrentUser() user: JWTPayload) {
    return this.service.seedDefaults(user.tenant_id);
  }

  // ── Journal ──
  @Get('journal')
  journal(
    @CurrentUser() user: JWTPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('outletId') outletId?: string,
    @Query('sourceType') sourceType?: string,
  ) {
    return this.service.listJournal(user.tenant_id, { from, to, outletId, sourceType });
  }

  @Post('journal')
  @HttpCode(HttpStatus.CREATED)
  createEntry(@CurrentUser() user: JWTPayload, @Body() dto: PostEntryInput) {
    return this.service.createManualEntry(user.tenant_id, { ...dto, createdBy: user.sub });
  }

  @Post('journal/:id/void')
  @HttpCode(HttpStatus.OK)
  voidEntry(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.voidEntry(user.tenant_id, id);
  }

  // ── Reports ──
  @Get('trial-balance')
  trialBalance(@CurrentUser() user: JWTPayload, @Query('from') from?: string, @Query('to') to?: string, @Query('outletId') outletId?: string) {
    return this.service.trialBalance(user.tenant_id, from, to, outletId);
  }

  @Get('general-ledger')
  generalLedger(@CurrentUser() user: JWTPayload, @Query('accountId') accountId: string, @Query('from') from?: string, @Query('to') to?: string, @Query('outletId') outletId?: string) {
    if (!accountId) throw new BadRequestException('accountId is required');
    return this.service.generalLedger(user.tenant_id, accountId, from, to, outletId);
  }

  // ── Accounting periods (open/close) ──
  @Get('periods')
  periods(@CurrentUser() user: JWTPayload) {
    return this.service.listPeriods(user.tenant_id);
  }

  @Post('periods')
  @HttpCode(HttpStatus.OK)
  setPeriod(@CurrentUser() user: JWTPayload, @Body() body: { period: string; status: 'open' | 'closed' }) {
    if (!body?.period || !body?.status) throw new BadRequestException('period (YYYY-MM) and status are required');
    return this.service.setPeriod(user.tenant_id, body.period, body.status, user.sub);
  }

  // ── Backfill posting from operational tables ──
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  sync(@CurrentUser() user: JWTPayload, @Body() body: { from: string; to: string }) {
    if (!body?.from || !body?.to) throw new BadRequestException('from and to (YYYY-MM-DD) are required');
    return this.poster.sync(user.tenant_id, body.from, body.to);
  }
}
