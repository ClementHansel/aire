import {
  Controller, Get, Put, Post, Patch, Body, Param, Query, Res,
  UseGuards, HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../../common/guards';
import { CurrentUser, Roles } from '../../common/decorators';
import {
  TaxInvoiceService, TaxInvoiceConfig, UpdateCustomerTaxDto, GenerateTaxInvoiceDto,
} from './tax-invoice.service';

/**
 * Tax-invoice (Faktur Pajak) endpoints — owner-only. Export scope is the
 * Coretax/e-Faktur bulk-import file; there is no live government API.
 */
@Controller('api/tax-invoice')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TenantOwner)
export class TaxInvoiceController {
  constructor(private readonly service: TaxInvoiceService) {}

  // ── Config ───────────────────────────────────────────────────────────────

  @Get('config')
  getConfig(@CurrentUser() user: JWTPayload) {
    return this.service.getConfig(user.tenant_id);
  }

  @Put('config')
  setConfig(@CurrentUser() user: JWTPayload, @Body() body: Partial<TaxInvoiceConfig>) {
    return this.service.setConfig(user.tenant_id, body ?? {});
  }

  // ── Buyer tax identity on a customer ──────────────────────────────────────

  @Patch('customer/:customerId')
  updateCustomerTax(
    @CurrentUser() user: JWTPayload,
    @Param('customerId') customerId: string,
    @Body() body: UpdateCustomerTaxDto,
  ) {
    return this.service.updateCustomerTax(user.tenant_id, customerId, body ?? {});
  }

  // ── Generate from an order ────────────────────────────────────────────────

  @Post('generate')
  @HttpCode(HttpStatus.CREATED)
  generate(@CurrentUser() user: JWTPayload, @Body() body: GenerateTaxInvoiceDto) {
    return this.service.generate(user.tenant_id, body, user.sub);
  }

  // ── Coretax export (must precede the ':id' route) ─────────────────────────

  @Get('export')
  async export(
    @CurrentUser() user: JWTPayload,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('format') format?: string,
  ): Promise<void> {
    if (format && format !== 'coretax' && format !== 'csv') {
      throw new BadRequestException('Supported formats: coretax, csv');
    }
    const fmt = (format === 'csv' ? 'csv' : 'coretax') as 'coretax' | 'csv';
    const file = await this.service.exportRange(user.tenant_id, from, to, fmt);
    res
      .set('Content-Type', `${file.contentType}; charset=utf-8`)
      .set('Content-Disposition', `attachment; filename="${file.filename}"`)
      .send(file.content);
  }

  // ── List / detail ─────────────────────────────────────────────────────────

  @Get()
  list(
    @CurrentUser() user: JWTPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.list(user.tenant_id, from, to);
  }

  @Get(':id')
  getOne(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.getOne(user.tenant_id, id);
  }
}
