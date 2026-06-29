import {
  Controller,
  Get,
  Query,
  Res,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { SummaryResponse, JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
import { ReportService } from './report.service';

/**
 * ReportController handles report endpoints.
 *
 * Endpoints:
 * - GET /api/reports/summary?dateFrom=&dateTo=&outletId= → SummaryResponse
 * - GET /api/reports/export?dateFrom=&dateTo=&outletId=&format=csv → CSV download
 *
 * Requirements: 23.1, 23.2, 23.3, 23.4, 23.5, 23.6
 */
@Controller('api/reports')
@UseGuards(JwtAuthGuard)
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  /**
   * GET /api/reports/summary
   *
   * Returns summary report with:
   * - Total orders, revenue, paid/cancelled counts
   * - Unique members served, new members
   * - Payment method breakdown
   * - Top 10 services by quantity/revenue
   *
   * Requirements: 23.1, 23.2, 23.3, 23.4, 23.6
   */
  @Get('summary')
  async getSummary(
    @CurrentUser() user: JWTPayload,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('outletId') outletId?: string,
  ): Promise<SummaryResponse> {
    // Validate required date parameters
    if (!dateFrom || !dateTo) {
      throw new BadRequestException(
        'dateFrom and dateTo query parameters are required.',
      );
    }

    if (isNaN(Date.parse(dateFrom))) {
      throw new BadRequestException('Invalid dateFrom format. Use ISO date string.');
    }
    if (isNaN(Date.parse(dateTo))) {
      throw new BadRequestException('Invalid dateTo format. Use ISO date string.');
    }

    // Cashiers are scoped by RLS to their own outlet
    // Tenant_Owner/Outlet_Admin can filter by outletId
    const effectiveOutletId =
      user.role === Role.Cashier || user.role === Role.OutletAdmin
        ? undefined
        : outletId;

    return this.reportService.getSummary({
      dateFrom,
      dateTo,
      outletId: effectiveOutletId,
    });
  }

  /**
   * GET /api/reports/export
   *
   * Exports order data as CSV for the selected date range.
   * Returns a downloadable CSV file.
   *
   * Requirement: 23.5
   */
  @Get('export')
  async exportReport(
    @CurrentUser() user: JWTPayload,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('outletId') outletId?: string,
    @Query('format') format?: string,
    @Res() reply?: FastifyReply,
  ): Promise<void> {
    // Validate required parameters
    if (!dateFrom || !dateTo) {
      throw new BadRequestException(
        'dateFrom and dateTo query parameters are required.',
      );
    }

    if (isNaN(Date.parse(dateFrom))) {
      throw new BadRequestException('Invalid dateFrom format. Use ISO date string.');
    }
    if (isNaN(Date.parse(dateTo))) {
      throw new BadRequestException('Invalid dateTo format. Use ISO date string.');
    }

    // Currently only CSV format is supported
    if (format && format !== 'csv') {
      throw new BadRequestException('Only csv format is currently supported.');
    }

    const effectiveOutletId =
      user.role === Role.Cashier || user.role === Role.OutletAdmin
        ? undefined
        : outletId;

    const csvContent = await this.reportService.exportCsv({
      dateFrom,
      dateTo,
      outletId: effectiveOutletId,
    });

    const filename = `orders-${dateFrom}-to-${dateTo}.csv`;

    reply!
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(csvContent);
  }
}
