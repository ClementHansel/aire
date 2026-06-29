import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { JWTPayload } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
import {
  InvoiceService,
  CreateInvoiceDto,
  UpdateInvoiceDto,
  InvoiceResponse,
  InvoiceListResponse,
  InvoiceStatus,
  ReceiptTemplate,
} from './invoice.service';

const VALID_INVOICE_STATUSES: InvoiceStatus[] = ['draft', 'issued', 'paid', 'cancelled'];

@Controller('api')
@UseGuards(JwtAuthGuard)
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  /**
   * POST /api/invoices
   * Create a manual invoice.
   * Requirement 31.2
   */
  @Post('invoices')
  async createInvoice(
    @Body() body: CreateInvoiceDto,
    @CurrentUser() user: JWTPayload,
  ): Promise<InvoiceResponse> {
    return this.invoiceService.createInvoice(body, user);
  }

  /**
   * GET /api/invoices
   * List invoices with optional date filtering and pagination.
   * Requirement 31.2
   */
  @Get('invoices')
  async listInvoices(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('status') status?: string,
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
  ): Promise<InvoiceListResponse> {
    // Validate status if provided
    if (status && !VALID_INVOICE_STATUSES.includes(status as InvoiceStatus)) {
      throw new BadRequestException(
        `Invalid status. Must be one of: ${VALID_INVOICE_STATUSES.join(', ')}`,
      );
    }

    // Validate date formats
    if (dateFrom && isNaN(Date.parse(dateFrom))) {
      throw new BadRequestException('Invalid dateFrom format. Use ISO date string.');
    }
    if (dateTo && isNaN(Date.parse(dateTo))) {
      throw new BadRequestException('Invalid dateTo format. Use ISO date string.');
    }

    // Parse pagination
    const page = pageStr ? parseInt(pageStr, 10) : undefined;
    const pageSize = pageSizeStr ? parseInt(pageSizeStr, 10) : undefined;

    if (page !== undefined && (isNaN(page) || page < 1)) {
      throw new BadRequestException('page must be a positive integer.');
    }
    if (pageSize !== undefined && (isNaN(pageSize) || pageSize < 1)) {
      throw new BadRequestException('pageSize must be a positive integer.');
    }

    return this.invoiceService.listInvoices({
      dateFrom,
      dateTo,
      status: status as InvoiceStatus | undefined,
      page,
      pageSize,
    });
  }

  /**
   * GET /api/invoices/:id
   * Get a single invoice.
   */
  @Get('invoices/:id')
  async getInvoice(@Param('id') id: string): Promise<InvoiceResponse> {
    return this.invoiceService.getInvoice(id);
  }

  /**
   * PUT /api/invoices/:id
   * Update an existing invoice.
   * Requirement 31.2
   */
  @Put('invoices/:id')
  async updateInvoice(
    @Param('id') id: string,
    @Body() body: UpdateInvoiceDto,
  ): Promise<InvoiceResponse> {
    return this.invoiceService.updateInvoice(id, body);
  }

  /**
   * DELETE /api/invoices/:id
   * Delete an invoice.
   * Requirement 31.2
   */
  @Delete('invoices/:id')
  async deleteInvoice(@Param('id') id: string): Promise<{ deleted: boolean }> {
    await this.invoiceService.deleteInvoice(id);
    return { deleted: true };
  }

  /**
   * GET /api/invoices/:id/pdf
   * Generate PDF for an invoice (stub returning content-type).
   * Requirement 31.4
   */
  @Get('invoices/:id/pdf')
  async getInvoicePdf(
    @Param('id') id: string,
  ): Promise<{ contentType: string; filename: string; invoice: InvoiceResponse }> {
    return this.invoiceService.generatePdf(id);
  }

  /**
   * GET /api/receipt-templates
   * Get the current receipt template configuration for the tenant.
   * Requirement 31.3
   */
  @Get('receipt-templates')
  async getReceiptTemplate(
    @CurrentUser() user: JWTPayload,
  ): Promise<ReceiptTemplate> {
    return this.invoiceService.getReceiptTemplate(user.tenant_id);
  }

  /**
   * PUT /api/receipt-templates
   * Update the receipt template (header, footer, logo, business info).
   * Requirement 31.3
   */
  @Put('receipt-templates')
  async updateReceiptTemplate(
    @CurrentUser() user: JWTPayload,
    @Body() body: Partial<ReceiptTemplate>,
  ): Promise<ReceiptTemplate> {
    return this.invoiceService.updateReceiptTemplate(user.tenant_id, body);
  }
}
