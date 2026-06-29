import {
  Controller,
  Get,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JWTPayload } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
import { AuditService, PaginatedAuditResponse } from './audit.service';

/**
 * GET /api/audit-logs
 *
 * Provides audit log viewing and filtering for authenticated users.
 * Results are scoped to the user's tenant (enforced by passing tenantId from JWT).
 *
 * Requirement 40.4: Tenant_Dashboard provides audit log viewing and filtering
 * scoped to the Tenant.
 */
@Controller('api/audit-logs')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async listLogs(
    @CurrentUser() user: JWTPayload,
    @Query('operation') operation?: string,
    @Query('entityType') entityType?: string,
    @Query('outletId') outletId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<PaginatedAuditResponse> {
    return this.auditService.listLogs({
      tenantId: user.tenant_id,
      outletId: outletId ?? undefined,
      operation: operation ?? undefined,
      entityType: entityType ?? undefined,
      dateFrom: dateFrom ?? undefined,
      dateTo: dateTo ?? undefined,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }
}
