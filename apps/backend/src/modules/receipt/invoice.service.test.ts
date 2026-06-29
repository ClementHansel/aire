import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { JWTPayload } from '@aire/shared';
import { InvoiceService, CreateInvoiceDto, UpdateInvoiceDto } from './invoice.service';

describe('InvoiceService', () => {
  let invoiceService: InvoiceService;
  let mockPool: {
    query: ReturnType<typeof vi.fn>;
  };

  const mockUser: JWTPayload = {
    sub: 'user-1',
    tenant_id: 'tenant-1',
    outlet_id: 'outlet-1',
    role: 'tenant_owner',
    iat: 1000,
    exp: 2000,
  };

  const mockInvoiceRow = {
    id: 'inv-1',
    tenant_id: 'tenant-1',
    outlet_id: 'outlet-1',
    order_id: null,
    invoice_number: 'INV-20250101-001',
    status: 'draft',
    customer_name: 'Test Customer',
    customer_phone: '081234567890',
    items: JSON.stringify([
      { description: 'Premium Wash', quantity: 1, unitPrice: 50000, subtotal: 50000 },
    ]),
    subtotal: '50000.00',
    tax: '5500.00',
    service_charge: '2500.00',
    discount: '0.00',
    total: '58000.00',
    payment_method: null,
    note: null,
    issued_at: null,
    due_date: null,
    created_at: new Date('2025-01-01T10:00:00Z'),
    updated_at: new Date('2025-01-01T10:00:00Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = { query: vi.fn() };
    invoiceService = new InvoiceService(mockPool as any);
  });

  describe('generateFromOrder', () => {
    it('should generate an invoice from a confirmed order', async () => {
      // Order lookup
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'order-1',
          tenant_id: 'tenant-1',
          outlet_id: 'outlet-1',
          customer_name: 'John Doe',
          customer_phone: '081234567890',
          subtotal: '100000.00',
          tax: '11000.00',
          service_charge: '5000.00',
          voucher_discount: '0.00',
          total: '116000.00',
          payment_method: 'cash',
          status: 'confirmed',
        }],
      });

      // Order items
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { service_id: 'svc-1', quantity: 1, unit_price: '50000.00', subtotal: '50000.00' },
          { service_id: 'svc-2', quantity: 2, unit_price: '25000.00', subtotal: '50000.00' },
        ],
      });

      // Service names
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { id: 'svc-1', name: 'Premium Wash' },
          { id: 'svc-2', name: 'Interior Clean' },
        ],
      });

      // Generate invoice number count
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '2' }] });

      // Insert invoice
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'inv-new',
          tenant_id: 'tenant-1',
          outlet_id: 'outlet-1',
          order_id: 'order-1',
          invoice_number: 'INV-20250101-003',
          status: 'issued',
          customer_name: 'John Doe',
          customer_phone: '081234567890',
          items: JSON.stringify([
            { description: 'Premium Wash', quantity: 1, unitPrice: 50000, subtotal: 50000 },
            { description: 'Interior Clean', quantity: 2, unitPrice: 25000, subtotal: 50000 },
          ]),
          subtotal: '100000.00',
          tax: '11000.00',
          service_charge: '5000.00',
          discount: '0.00',
          total: '116000.00',
          payment_method: 'cash',
          note: null,
          issued_at: new Date('2025-01-01T10:00:00Z'),
          due_date: null,
          created_at: new Date('2025-01-01T10:00:00Z'),
          updated_at: new Date('2025-01-01T10:00:00Z'),
        }],
      });

      const result = await invoiceService.generateFromOrder('order-1', mockUser);

      expect(result.id).toBe('inv-new');
      expect(result.orderId).toBe('order-1');
      expect(result.status).toBe('issued');
      expect(result.customerName).toBe('John Doe');
      expect(result.items).toHaveLength(2);
      expect(result.items[0]!.description).toBe('Premium Wash');
      expect(result.items[1]!.description).toBe('Interior Clean');
      expect(result.total).toBe(116000);
      expect(result.paymentMethod).toBe('cash');
    });

    it('should throw NotFoundException when order does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        invoiceService.generateFromOrder('nonexistent-order', mockUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('createInvoice', () => {
    const validDto: CreateInvoiceDto = {
      customerName: 'Test Customer',
      customerPhone: '081234567890',
      items: [
        { description: 'Premium Wash', quantity: 1, unitPrice: 50000, subtotal: 50000 },
      ],
      tax: 5500,
      serviceCharge: 2500,
      discount: 0,
      note: 'Manual invoice',
    };

    it('should create a manual invoice successfully', async () => {
      // Generate invoice number count
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

      // Insert invoice
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          ...mockInvoiceRow,
          note: 'Manual invoice',
          total: '58000.00',
        }],
      });

      const result = await invoiceService.createInvoice(validDto, mockUser);

      expect(result.id).toBe('inv-1');
      expect(result.status).toBe('draft');
      expect(result.customerName).toBe('Test Customer');
      expect(result.note).toBe('Manual invoice');
    });

    it('should throw BadRequestException when customer name is empty', async () => {
      const dto: CreateInvoiceDto = { ...validDto, customerName: '' };

      await expect(
        invoiceService.createInvoice(dto, mockUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when items array is empty', async () => {
      const dto: CreateInvoiceDto = { ...validDto, items: [] };

      await expect(
        invoiceService.createInvoice(dto, mockUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('should calculate total as subtotal + tax + serviceCharge - discount', async () => {
      // Generate invoice number count
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

      // Capture the INSERT query to verify calculation
      mockPool.query.mockResolvedValueOnce({
        rows: [mockInvoiceRow],
      });

      await invoiceService.createInvoice(validDto, mockUser);

      // Verify the INSERT was called with correct total
      const insertCall = mockPool.query.mock.calls[1]!;
      const insertValues = insertCall[1] as unknown[];
      // subtotal=50000, tax=5500, serviceCharge=2500, discount=0, total=58000
      expect(insertValues[7]).toBe(50000); // subtotal
      expect(insertValues[8]).toBe(5500);  // tax
      expect(insertValues[9]).toBe(2500);  // serviceCharge
      expect(insertValues[10]).toBe(0);    // discount
      expect(insertValues[11]).toBe(58000); // total
    });

    it('should default tax, serviceCharge, discount to 0 when not provided', async () => {
      const dto: CreateInvoiceDto = {
        customerName: 'Customer',
        items: [{ description: 'Service', quantity: 1, unitPrice: 100000, subtotal: 100000 }],
      };

      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          ...mockInvoiceRow,
          subtotal: '100000.00',
          tax: '0.00',
          service_charge: '0.00',
          discount: '0.00',
          total: '100000.00',
        }],
      });

      await invoiceService.createInvoice(dto, mockUser);

      const insertCall = mockPool.query.mock.calls[1]!;
      const insertValues = insertCall[1] as unknown[];
      expect(insertValues[8]).toBe(0);  // tax
      expect(insertValues[9]).toBe(0);  // serviceCharge
      expect(insertValues[10]).toBe(0); // discount
      expect(insertValues[11]).toBe(100000); // total = subtotal only
    });
  });

  describe('listInvoices', () => {
    it('should return paginated invoice list', async () => {
      // Count query
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '25' }] });

      // Data query
      mockPool.query.mockResolvedValueOnce({
        rows: [mockInvoiceRow],
      });

      const result = await invoiceService.listInvoices({ page: 1, pageSize: 10 });

      expect(result.total).toBe(25);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
      expect(result.invoices).toHaveLength(1);
      expect(result.invoices[0]!.id).toBe('inv-1');
    });

    it('should apply date filters when provided', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '5' }] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await invoiceService.listInvoices({
        dateFrom: '2025-01-01',
        dateTo: '2025-01-31',
      });

      // Verify filters were applied
      const countCall = mockPool.query.mock.calls[0]!;
      expect(countCall[0]).toContain('created_at >= $1');
      expect(countCall[0]).toContain('created_at <= $2');
      expect(countCall[1]).toEqual(['2025-01-01', '2025-01-31']);
    });

    it('should apply status filter when provided', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '3' }] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await invoiceService.listInvoices({ status: 'issued' });

      const countCall = mockPool.query.mock.calls[0]!;
      expect(countCall[0]).toContain('status = $1');
      expect(countCall[1]).toEqual(['issued']);
    });

    it('should default to page 1 with pageSize 20', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await invoiceService.listInvoices({});

      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
    });

    it('should cap pageSize at 100', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await invoiceService.listInvoices({ pageSize: 500 });

      expect(result.pageSize).toBe(100);
    });
  });

  describe('getInvoice', () => {
    it('should return an invoice by ID', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockInvoiceRow] });

      const result = await invoiceService.getInvoice('inv-1');

      expect(result.id).toBe('inv-1');
      expect(result.customerName).toBe('Test Customer');
      expect(result.subtotal).toBe(50000);
    });

    it('should throw NotFoundException when invoice does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        invoiceService.getInvoice('nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateInvoice', () => {
    it('should update invoice fields', async () => {
      // Existing invoice lookup
      mockPool.query.mockResolvedValueOnce({ rows: [mockInvoiceRow] });

      // Update query
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          ...mockInvoiceRow,
          customer_name: 'Updated Name',
          note: 'Updated note',
        }],
      });

      const dto: UpdateInvoiceDto = {
        customerName: 'Updated Name',
        note: 'Updated note',
      };

      const result = await invoiceService.updateInvoice('inv-1', dto);

      expect(result.customerName).toBe('Updated Name');
      expect(result.note).toBe('Updated note');
    });

    it('should throw NotFoundException when invoice does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        invoiceService.updateInvoice('nonexistent', { note: 'test' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for invalid status', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockInvoiceRow] });

      await expect(
        invoiceService.updateInvoice('inv-1', { status: 'invalid' as any }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should recalculate total when items are updated', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockInvoiceRow] });

      mockPool.query.mockResolvedValueOnce({
        rows: [{
          ...mockInvoiceRow,
          items: JSON.stringify([
            { description: 'New Service', quantity: 2, unitPrice: 30000, subtotal: 60000 },
          ]),
          subtotal: '60000.00',
          total: '68000.00',
        }],
      });

      const dto: UpdateInvoiceDto = {
        items: [{ description: 'New Service', quantity: 2, unitPrice: 30000, subtotal: 60000 }],
      };

      const result = await invoiceService.updateInvoice('inv-1', dto);

      // Verify the update query recalculated total
      const updateCall = mockPool.query.mock.calls[1]!;
      const sql = updateCall[0] as string;
      expect(sql).toContain('subtotal');
      expect(sql).toContain('total');
    });

    it('should return existing invoice when no fields to update', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockInvoiceRow] });

      const result = await invoiceService.updateInvoice('inv-1', {});

      expect(result.id).toBe('inv-1');
      // Should not have made an UPDATE query
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteInvoice', () => {
    it('should delete an invoice', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

      await expect(
        invoiceService.deleteInvoice('inv-1'),
      ).resolves.toBeUndefined();
    });

    it('should throw NotFoundException when invoice does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0 });

      await expect(
        invoiceService.deleteInvoice('nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('generatePdf', () => {
    it('should return PDF metadata with invoice data', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockInvoiceRow] });

      const result = await invoiceService.generatePdf('inv-1');

      expect(result.contentType).toBe('application/pdf');
      expect(result.filename).toContain('INV-20250101-001');
      expect(result.invoice.id).toBe('inv-1');
    });

    it('should throw NotFoundException for non-existent invoice', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        invoiceService.generatePdf('nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getReceiptTemplate', () => {
    it('should return receipt template from tenant settings', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          settings: {
            receipt_template: {
              header: 'Welcome to AIRE',
              footer: 'Thank you!',
              logo_url: 'https://example.com/logo.png',
              business_name: 'AIRE Car Wash',
              business_address: '123 Main St',
              business_phone: '021-1234567',
              tax_id: '12.345.678.9-012.000',
            },
          },
        }],
      });

      const result = await invoiceService.getReceiptTemplate('tenant-1');

      expect(result.header).toBe('Welcome to AIRE');
      expect(result.footer).toBe('Thank you!');
      expect(result.logoUrl).toBe('https://example.com/logo.png');
      expect(result.businessName).toBe('AIRE Car Wash');
      expect(result.businessAddress).toBe('123 Main St');
      expect(result.businessPhone).toBe('021-1234567');
      expect(result.taxId).toBe('12.345.678.9-012.000');
    });

    it('should return empty defaults when no template configured', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ settings: {} }],
      });

      const result = await invoiceService.getReceiptTemplate('tenant-1');

      expect(result.header).toBe('');
      expect(result.footer).toBe('');
      expect(result.logoUrl).toBeNull();
      expect(result.businessName).toBe('');
      expect(result.businessAddress).toBe('');
      expect(result.businessPhone).toBe('');
      expect(result.taxId).toBeNull();
    });

    it('should throw NotFoundException when tenant does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        invoiceService.getReceiptTemplate('nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateReceiptTemplate', () => {
    it('should update receipt template in tenant settings', async () => {
      // Get current settings
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          settings: {
            receipt_template: {
              header: 'Old Header',
              footer: 'Old Footer',
              logo_url: null,
              business_name: '',
              business_address: '',
              business_phone: '',
              tax_id: null,
            },
          },
        }],
      });

      // Update query
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

      const result = await invoiceService.updateReceiptTemplate('tenant-1', {
        header: 'New Header',
        footer: 'New Footer',
        logoUrl: 'https://example.com/new-logo.png',
        businessName: 'My Carwash',
      });

      expect(result.header).toBe('New Header');
      expect(result.footer).toBe('New Footer');
      expect(result.logoUrl).toBe('https://example.com/new-logo.png');
      expect(result.businessName).toBe('My Carwash');
    });

    it('should preserve existing fields when partial update', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          settings: {
            receipt_template: {
              header: 'Existing Header',
              footer: 'Existing Footer',
              logo_url: 'https://example.com/logo.png',
              business_name: 'AIRE',
              business_address: '123 Main St',
              business_phone: '021-123',
              tax_id: '999',
            },
          },
        }],
      });

      mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

      const result = await invoiceService.updateReceiptTemplate('tenant-1', {
        header: 'Updated Header Only',
      });

      expect(result.header).toBe('Updated Header Only');
      expect(result.footer).toBe('Existing Footer');
      expect(result.logoUrl).toBe('https://example.com/logo.png');
      expect(result.businessName).toBe('AIRE');
    });

    it('should throw NotFoundException when tenant does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        invoiceService.updateReceiptTemplate('nonexistent', { header: 'test' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
