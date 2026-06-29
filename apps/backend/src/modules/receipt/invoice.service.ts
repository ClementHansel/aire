import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { JWTPayload } from '@aire/shared';

/**
 * Invoice status values.
 */
export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'cancelled';

/**
 * Shape of an invoice row from the database.
 */
export interface InvoiceRow {
  id: string;
  tenant_id: string;
  outlet_id: string;
  order_id: string | null;
  invoice_number: string;
  status: InvoiceStatus;
  customer_name: string;
  customer_phone: string | null;
  items: InvoiceItem[];
  subtotal: string;
  tax: string;
  service_charge: string;
  discount: string;
  total: string;
  payment_method: string | null;
  note: string | null;
  issued_at: Date | null;
  due_date: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Line item on an invoice.
 */
export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

/**
 * DTO for creating a manual invoice.
 */
export interface CreateInvoiceDto {
  customerName: string;
  customerPhone?: string;
  items: InvoiceItem[];
  tax?: number;
  serviceCharge?: number;
  discount?: number;
  paymentMethod?: string;
  note?: string;
  dueDate?: string;
}

/**
 * DTO for updating an invoice.
 */
export interface UpdateInvoiceDto {
  customerName?: string;
  customerPhone?: string;
  items?: InvoiceItem[];
  tax?: number;
  serviceCharge?: number;
  discount?: number;
  paymentMethod?: string;
  note?: string;
  status?: InvoiceStatus;
  dueDate?: string;
}

/**
 * Query params for listing invoices.
 */
export interface InvoiceQueryParams {
  dateFrom?: string;
  dateTo?: string;
  status?: InvoiceStatus;
  page?: number;
  pageSize?: number;
}

/**
 * Response shape for a single invoice.
 */
export interface InvoiceResponse {
  id: string;
  tenantId: string;
  outletId: string;
  orderId: string | null;
  invoiceNumber: string;
  status: InvoiceStatus;
  customerName: string;
  customerPhone: string | null;
  items: InvoiceItem[];
  subtotal: number;
  tax: number;
  serviceCharge: number;
  discount: number;
  total: number;
  paymentMethod: string | null;
  note: string | null;
  issuedAt: Date | null;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Paginated list response for invoices.
 */
export interface InvoiceListResponse {
  invoices: InvoiceResponse[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Receipt template configuration stored at tenant level.
 */
export interface ReceiptTemplate {
  header: string;
  footer: string;
  logoUrl: string | null;
  businessName: string;
  businessAddress: string;
  businessPhone: string;
  taxId: string | null;
}

const VALID_INVOICE_STATUSES: InvoiceStatus[] = ['draft', 'issued', 'paid', 'cancelled'];

@Injectable()
export class InvoiceService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /**
   * Auto-generate an invoice from a confirmed order.
   * Requirement 31.1
   */
  async generateFromOrder(orderId: string, user: JWTPayload): Promise<InvoiceResponse> {
    // Fetch the order with its items
    const orderResult = await this.pool.query<{
      id: string;
      tenant_id: string;
      outlet_id: string;
      customer_name: string;
      customer_phone: string;
      subtotal: string;
      tax: string;
      service_charge: string;
      voucher_discount: string;
      total: string;
      payment_method: string | null;
      status: string;
    }>(
      `SELECT id, tenant_id, outlet_id, customer_name, customer_phone,
              subtotal, tax, service_charge, voucher_discount, total, payment_method, status
       FROM orders WHERE id = $1`,
      [orderId],
    );

    if (orderResult.rows.length === 0) {
      throw new NotFoundException(`Order not found: ${orderId}`);
    }

    const order = orderResult.rows[0]!;

    // Fetch order items
    const itemsResult = await this.pool.query<{
      service_id: string;
      quantity: number;
      unit_price: string;
      subtotal: string;
    }>(
      `SELECT oi.service_id, oi.quantity, oi.unit_price, oi.subtotal
       FROM order_items oi WHERE oi.order_id = $1 ORDER BY oi.sort_order`,
      [orderId],
    );

    // Fetch service names for items
    const serviceIds = itemsResult.rows.map((r) => r.service_id);
    let serviceNames = new Map<string, string>();
    if (serviceIds.length > 0) {
      const placeholders = serviceIds.map((_, i) => `$${i + 1}`).join(', ');
      const servicesResult = await this.pool.query<{ id: string; name: string }>(
        `SELECT id, name FROM services WHERE id IN (${placeholders})`,
        serviceIds,
      );
      serviceNames = new Map(servicesResult.rows.map((r) => [r.id, r.name]));
    }

    const invoiceItems: InvoiceItem[] = itemsResult.rows.map((row) => ({
      description: serviceNames.get(row.service_id) ?? 'Unknown Service',
      quantity: row.quantity,
      unitPrice: parseFloat(row.unit_price),
      subtotal: parseFloat(row.subtotal),
    }));

    // Generate invoice number
    const invoiceNumber = await this.generateInvoiceNumber(user.tenant_id);

    // Insert invoice
    const result = await this.pool.query<InvoiceRow>(
      `INSERT INTO invoices
        (tenant_id, outlet_id, order_id, invoice_number, status,
         customer_name, customer_phone, items, subtotal, tax,
         service_charge, discount, total, payment_method, issued_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
       RETURNING *`,
      [
        order.tenant_id,
        order.outlet_id,
        order.id,
        invoiceNumber,
        'issued',
        order.customer_name,
        order.customer_phone,
        JSON.stringify(invoiceItems),
        order.subtotal,
        order.tax,
        order.service_charge,
        order.voucher_discount,
        order.total,
        order.payment_method,
      ],
    );

    return this.mapRowToResponse(result.rows[0]!);
  }

  /**
   * Create a manual invoice.
   * Requirement 31.2
   */
  async createInvoice(dto: CreateInvoiceDto, user: JWTPayload): Promise<InvoiceResponse> {
    if (!dto.customerName || dto.customerName.trim() === '') {
      throw new BadRequestException('Customer name is required');
    }
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('At least one item is required');
    }

    const subtotal = dto.items.reduce((sum, item) => sum + item.subtotal, 0);
    const tax = dto.tax ?? 0;
    const serviceCharge = dto.serviceCharge ?? 0;
    const discount = dto.discount ?? 0;
    const total = subtotal + tax + serviceCharge - discount;

    const invoiceNumber = await this.generateInvoiceNumber(user.tenant_id);

    const result = await this.pool.query<InvoiceRow>(
      `INSERT INTO invoices
        (tenant_id, outlet_id, order_id, invoice_number, status,
         customer_name, customer_phone, items, subtotal, tax,
         service_charge, discount, total, payment_method, note, due_date)
       VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        user.tenant_id,
        user.outlet_id ?? null,
        invoiceNumber,
        'draft',
        dto.customerName,
        dto.customerPhone ?? null,
        JSON.stringify(dto.items),
        subtotal,
        tax,
        serviceCharge,
        discount,
        total,
        dto.paymentMethod ?? null,
        dto.note ?? null,
        dto.dueDate ?? null,
      ],
    );

    return this.mapRowToResponse(result.rows[0]!);
  }

  /**
   * List invoices with optional date filtering and pagination.
   * Requirement 31.2
   */
  async listInvoices(params: InvoiceQueryParams): Promise<InvoiceListResponse> {
    const page = params.page ?? 1;
    const pageSize = Math.min(params.pageSize ?? 20, 100);
    const offset = (page - 1) * pageSize;

    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (params.dateFrom) {
      conditions.push(`created_at >= $${paramIndex}`);
      values.push(params.dateFrom);
      paramIndex++;
    }
    if (params.dateTo) {
      conditions.push(`created_at <= $${paramIndex}`);
      values.push(params.dateTo);
      paramIndex++;
    }
    if (params.status) {
      conditions.push(`status = $${paramIndex}`);
      values.push(params.status);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count query
    const countResult = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM invoices ${whereClause}`,
      values,
    );
    const total = parseInt(countResult.rows[0]!.count, 10);

    // Data query
    const dataValues = [...values, pageSize, offset];
    const dataResult = await this.pool.query<InvoiceRow>(
      `SELECT * FROM invoices ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      dataValues,
    );

    return {
      invoices: dataResult.rows.map((row) => this.mapRowToResponse(row)),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Get a single invoice by ID.
   */
  async getInvoice(id: string): Promise<InvoiceResponse> {
    const result = await this.pool.query<InvoiceRow>(
      'SELECT * FROM invoices WHERE id = $1',
      [id],
    );

    if (result.rows.length === 0) {
      throw new NotFoundException(`Invoice not found: ${id}`);
    }

    return this.mapRowToResponse(result.rows[0]!);
  }

  /**
   * Update an existing invoice.
   * Requirement 31.2
   */
  async updateInvoice(id: string, dto: UpdateInvoiceDto): Promise<InvoiceResponse> {
    // Check exists
    const existing = await this.pool.query<InvoiceRow>(
      'SELECT * FROM invoices WHERE id = $1',
      [id],
    );
    if (existing.rows.length === 0) {
      throw new NotFoundException(`Invoice not found: ${id}`);
    }

    if (dto.status && !VALID_INVOICE_STATUSES.includes(dto.status)) {
      throw new BadRequestException(
        `Invalid status. Must be one of: ${VALID_INVOICE_STATUSES.join(', ')}`,
      );
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (dto.customerName !== undefined) {
      setClauses.push(`customer_name = $${paramIndex}`);
      values.push(dto.customerName);
      paramIndex++;
    }
    if (dto.customerPhone !== undefined) {
      setClauses.push(`customer_phone = $${paramIndex}`);
      values.push(dto.customerPhone);
      paramIndex++;
    }
    if (dto.items !== undefined) {
      const subtotal = dto.items.reduce((sum, item) => sum + item.subtotal, 0);
      setClauses.push(`items = $${paramIndex}`);
      values.push(JSON.stringify(dto.items));
      paramIndex++;
      setClauses.push(`subtotal = $${paramIndex}`);
      values.push(subtotal);
      paramIndex++;

      // Recalculate total
      const tax = dto.tax ?? parseFloat(existing.rows[0]!.tax);
      const serviceCharge = dto.serviceCharge ?? parseFloat(existing.rows[0]!.service_charge);
      const discount = dto.discount ?? parseFloat(existing.rows[0]!.discount);
      const total = subtotal + tax + serviceCharge - discount;
      setClauses.push(`total = $${paramIndex}`);
      values.push(total);
      paramIndex++;
    }
    if (dto.tax !== undefined) {
      setClauses.push(`tax = $${paramIndex}`);
      values.push(dto.tax);
      paramIndex++;
    }
    if (dto.serviceCharge !== undefined) {
      setClauses.push(`service_charge = $${paramIndex}`);
      values.push(dto.serviceCharge);
      paramIndex++;
    }
    if (dto.discount !== undefined) {
      setClauses.push(`discount = $${paramIndex}`);
      values.push(dto.discount);
      paramIndex++;
    }
    if (dto.paymentMethod !== undefined) {
      setClauses.push(`payment_method = $${paramIndex}`);
      values.push(dto.paymentMethod);
      paramIndex++;
    }
    if (dto.note !== undefined) {
      setClauses.push(`note = $${paramIndex}`);
      values.push(dto.note);
      paramIndex++;
    }
    if (dto.status !== undefined) {
      setClauses.push(`status = $${paramIndex}`);
      values.push(dto.status);
      paramIndex++;
      if (dto.status === 'issued') {
        setClauses.push(`issued_at = NOW()`);
      }
    }
    if (dto.dueDate !== undefined) {
      setClauses.push(`due_date = $${paramIndex}`);
      values.push(dto.dueDate);
      paramIndex++;
    }

    setClauses.push('updated_at = NOW()');

    if (setClauses.length === 1) {
      // Only updated_at, nothing to update
      return this.mapRowToResponse(existing.rows[0]!);
    }

    values.push(id);
    const result = await this.pool.query<InvoiceRow>(
      `UPDATE invoices SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values,
    );

    return this.mapRowToResponse(result.rows[0]!);
  }

  /**
   * Delete an invoice.
   * Requirement 31.2
   */
  async deleteInvoice(id: string): Promise<void> {
    const result = await this.pool.query(
      'DELETE FROM invoices WHERE id = $1',
      [id],
    );

    if ((result as { rowCount: number }).rowCount === 0) {
      throw new NotFoundException(`Invoice not found: ${id}`);
    }
  }

  /**
   * Generate PDF content for an invoice.
   * Returns a stub with content-type metadata.
   * Requirement 31.4
   */
  async generatePdf(id: string): Promise<{ contentType: string; filename: string; invoice: InvoiceResponse }> {
    const invoice = await this.getInvoice(id);

    return {
      contentType: 'application/pdf',
      filename: `invoice-${invoice.invoiceNumber}.pdf`,
      invoice,
    };
  }

  /**
   * Get the receipt template configuration for a tenant.
   * Requirement 31.3
   */
  async getReceiptTemplate(tenantId: string): Promise<ReceiptTemplate> {
    const result = await this.pool.query<{ settings: Record<string, unknown> }>(
      'SELECT settings FROM tenants WHERE id = $1',
      [tenantId],
    );

    if (result.rows.length === 0) {
      throw new NotFoundException(`Tenant not found: ${tenantId}`);
    }

    const settings = result.rows[0]!.settings ?? {};
    const receiptTemplate = (settings.receipt_template ?? {}) as Record<string, unknown>;

    return {
      header: (receiptTemplate.header as string) ?? '',
      footer: (receiptTemplate.footer as string) ?? '',
      logoUrl: (receiptTemplate.logo_url as string) ?? null,
      businessName: (receiptTemplate.business_name as string) ?? '',
      businessAddress: (receiptTemplate.business_address as string) ?? '',
      businessPhone: (receiptTemplate.business_phone as string) ?? '',
      taxId: (receiptTemplate.tax_id as string) ?? null,
    };
  }

  /**
   * Update the receipt template configuration for a tenant.
   * Requirement 31.3
   */
  async updateReceiptTemplate(
    tenantId: string,
    template: Partial<ReceiptTemplate>,
  ): Promise<ReceiptTemplate> {
    // Get current settings
    const currentResult = await this.pool.query<{ settings: Record<string, unknown> }>(
      'SELECT settings FROM tenants WHERE id = $1',
      [tenantId],
    );

    if (currentResult.rows.length === 0) {
      throw new NotFoundException(`Tenant not found: ${tenantId}`);
    }

    const currentSettings = currentResult.rows[0]!.settings ?? {};
    const currentTemplate = (currentSettings.receipt_template ?? {}) as Record<string, unknown>;

    // Merge updates
    const updatedTemplate = {
      header: template.header ?? (currentTemplate.header as string) ?? '',
      footer: template.footer ?? (currentTemplate.footer as string) ?? '',
      logo_url: template.logoUrl ?? (currentTemplate.logo_url as string) ?? null,
      business_name: template.businessName ?? (currentTemplate.business_name as string) ?? '',
      business_address: template.businessAddress ?? (currentTemplate.business_address as string) ?? '',
      business_phone: template.businessPhone ?? (currentTemplate.business_phone as string) ?? '',
      tax_id: template.taxId ?? (currentTemplate.tax_id as string) ?? null,
    };

    const updatedSettings = { ...currentSettings, receipt_template: updatedTemplate };

    await this.pool.query(
      'UPDATE tenants SET settings = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(updatedSettings), tenantId],
    );

    return {
      header: updatedTemplate.header,
      footer: updatedTemplate.footer,
      logoUrl: updatedTemplate.logo_url,
      businessName: updatedTemplate.business_name,
      businessAddress: updatedTemplate.business_address,
      businessPhone: updatedTemplate.business_phone,
      taxId: updatedTemplate.tax_id,
    };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────

  /**
   * Generates a sequential invoice number for the tenant.
   * Format: INV-YYYYMMDD-NNN
   */
  private async generateInvoiceNumber(tenantId: string): Promise<string> {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');

    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM invoices
       WHERE tenant_id = $1
       AND DATE(created_at) = CURRENT_DATE`,
      [tenantId],
    );

    const count = parseInt(result.rows[0]!.count, 10) + 1;
    const paddedCount = count.toString().padStart(3, '0');

    return `INV-${dateStr}-${paddedCount}`;
  }

  /**
   * Maps a database row to the API response shape.
   */
  private mapRowToResponse(row: InvoiceRow): InvoiceResponse {
    const items = typeof row.items === 'string' ? JSON.parse(row.items) : row.items;
    return {
      id: row.id,
      tenantId: row.tenant_id,
      outletId: row.outlet_id,
      orderId: row.order_id,
      invoiceNumber: row.invoice_number,
      status: row.status,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      items,
      subtotal: parseFloat(row.subtotal),
      tax: parseFloat(row.tax),
      serviceCharge: parseFloat(row.service_charge),
      discount: parseFloat(row.discount),
      total: parseFloat(row.total),
      paymentMethod: row.payment_method,
      note: row.note,
      issuedAt: row.issued_at,
      dueDate: row.due_date,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
