import {
  Controller,
  Get,
  Query,
  Res,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { SummaryResponse, JWTPayload } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, RequirePermission } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { ScopeService } from '../../common/scope/scope.service';
import { ReportService } from './report.service';
import { ReportPdfService } from './report-pdf.service';
import { DocTemplateService } from '../doc-template/doc-template.service';
import { BrandingService } from '../branding/branding.service';
import type { StoredObject } from '../storage';

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
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('reports.read')
export class ReportController {
  constructor(
    private readonly reportService: ReportService,
    private readonly reportPdfService: ReportPdfService,
    private readonly scope: ScopeService,
    private readonly docTemplate: DocTemplateService,
    private readonly branding: BrandingService,
  ) {}

  /** Read a stored image object into a base64 data URL (for pdfmake), or null. */
  private async toDataUrl(obj: StoredObject | null): Promise<string | undefined> {
    if (!obj) return undefined;
    const chunks: Buffer[] = [];
    for await (const chunk of obj.body) chunks.push(chunk as Buffer);
    const b64 = Buffer.concat(chunks).toString('base64');
    return `data:${obj.contentType};base64,${b64}`;
  }

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
    @Query('businessUnit') businessUnit?: string,
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

    // Owners/super-admins span branches (optionally narrowed by outletId);
    // outlet-bound roles are restricted to the branches assigned to them.
    const outletIds = await this.scope.resolveOutletIds(user, outletId);

    return this.reportService.getSummary(user.tenant_id, {
      dateFrom,
      dateTo,
      outletIds,
      businessUnit,
    });
  }

  /**
   * GET /api/reports/revenue-series — revenue + orders grouped by day/week/month.
   */
  @Get('revenue-series')
  async getRevenueSeries(
    @CurrentUser() user: JWTPayload,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('outletId') outletId?: string,
    @Query('businessUnit') businessUnit?: string,
    @Query('granularity') granularity?: string,
  ) {
    if (!dateFrom || !dateTo) throw new BadRequestException('dateFrom and dateTo are required.');
    if (isNaN(Date.parse(dateFrom)) || isNaN(Date.parse(dateTo))) throw new BadRequestException('Invalid date format.');
    const outletIds = await this.scope.resolveOutletIds(user, outletId);
    const gran = (['day', 'week', 'month'].includes(granularity ?? '') ? granularity : 'day') as 'day' | 'week' | 'month';
    return this.reportService.getRevenueSeries(user.tenant_id, { dateFrom, dateTo, outletIds, businessUnit, granularity: gran });
  }

  /**
   * GET /api/reports/customer-growth — new customers grouped by day/week/month.
   */
  @Get('customer-growth')
  async getCustomerGrowth(
    @CurrentUser() user: JWTPayload,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('granularity') granularity?: string,
  ) {
    if (!dateFrom || !dateTo) throw new BadRequestException('dateFrom and dateTo are required.');
    if (isNaN(Date.parse(dateFrom)) || isNaN(Date.parse(dateTo))) throw new BadRequestException('Invalid date format.');
    const gran = (['day', 'week', 'month'].includes(granularity ?? '') ? granularity : 'day') as 'day' | 'week' | 'month';
    return this.reportService.getCustomerGrowth(user.tenant_id, { dateFrom, dateTo, granularity: gran });
  }

  /**
   * GET /api/reports/daily-sales — one row per day (orders + revenue).
   */
  @Get('daily-sales')
  async getDailySales(
    @CurrentUser() user: JWTPayload,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('outletId') outletId?: string,
    @Query('businessUnit') businessUnit?: string,
  ) {
    if (!dateFrom || !dateTo) throw new BadRequestException('dateFrom and dateTo are required.');
    if (isNaN(Date.parse(dateFrom)) || isNaN(Date.parse(dateTo))) throw new BadRequestException('Invalid date format.');
    const outletIds = await this.scope.resolveOutletIds(user, outletId);
    return this.reportService.getDailySales(user.tenant_id, { dateFrom, dateTo, outletIds, businessUnit });
  }

  /**
   * GET /api/reports/shifts — shift-by-shift sales + cash reconciliation.
   */
  @Get('shifts')
  async getShiftReport(
    @CurrentUser() user: JWTPayload,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('outletId') outletId?: string,
  ) {
    if (!dateFrom || !dateTo) throw new BadRequestException('dateFrom and dateTo are required.');
    if (isNaN(Date.parse(dateFrom)) || isNaN(Date.parse(dateTo))) throw new BadRequestException('Invalid date format.');
    const outletIds = await this.scope.resolveOutletIds(user, outletId);
    return this.reportService.getShiftReport(user.tenant_id, { dateFrom, dateTo, outletIds });
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
  @RequirePermission('reports.export')
  async exportReport(
    @CurrentUser() user: JWTPayload,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('outletId') outletId?: string,
    @Query('format') format?: string,
    @Query('scope') scope?: string,
    @Query('businessUnit') businessUnit?: string,
    @Res() res?: Response,
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

    if (format && format !== 'csv' && format !== 'pdf') {
      throw new BadRequestException('Supported formats: csv, pdf.');
    }

    const outletIds = await this.scope.resolveOutletIds(user, outletId);
    // For the PDF header, name the branch only when scoped to exactly one.
    const headerOutletId = outletIds && outletIds.length === 1 ? outletIds[0] : undefined;

    // ── PDF: a polished, branded business report (KPIs, P&L, charts, tables) ───
    if (format === 'pdf') {
      const [summary, daily, shifts, names, tpl] = await Promise.all([
        this.reportService.getSummary(user.tenant_id, { dateFrom, dateTo, outletIds, businessUnit }),
        this.reportService.getDailySales(user.tenant_id, { dateFrom, dateTo, outletIds, businessUnit }),
        this.reportService.getShiftReport(user.tenant_id, { dateFrom, dateTo, outletIds }),
        this.reportService.getScopeNames(user.tenant_id, headerOutletId),
        this.docTemplate.get(user.tenant_id, 'report'),
      ]);
      // Embed the tenant logo in the masthead only when the report layout keeps a logo element.
      const wantsLogo = tpl.elements.some((el) => el.type === 'logo' || el.type === 'image');
      const logoDataUrl = wantsLogo ? await this.toDataUrl(await this.branding.getLogo(user.tenant_id)) : undefined;

      const pdf = await this.reportPdfService.build({
        tenantName: names.tenantName,
        outletName: names.outletName,
        businessUnit,
        dateFrom,
        dateTo,
        generatedAt: new Date(),
        summary,
        daily,
        shifts,
        sections: tpl.reportSections,
        logoDataUrl,
      });
      res!
        .set('Content-Type', 'application/pdf')
        .set('Content-Disposition', `attachment; filename="AIRE-report-${dateFrom}-to-${dateTo}.pdf"`)
        .send(pdf);
      return;
    }

    const exportScope = scope === 'daily' ? 'daily' : 'orders';
    const csvContent =
      exportScope === 'daily'
        ? await this.reportService.exportDailySalesCsv(user.tenant_id, { dateFrom, dateTo, outletIds, businessUnit })
        : await this.reportService.exportCsv(user.tenant_id, { dateFrom, dateTo, outletIds, businessUnit });

    const filename =
      exportScope === 'daily'
        ? `daily-sales-${dateFrom}-to-${dateTo}.csv`
        : `orders-${dateFrom}-to-${dateTo}.csv`;

    res!
      .set('Content-Type', 'text/csv')
      .set('Content-Disposition', `attachment; filename="${filename}"`)
      .send(csvContent);
  }
}
