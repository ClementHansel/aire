import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReportService } from './report.service';

describe('ReportService', () => {
  let reportService: ReportService;
  let mockPool: { query: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = {
      query: vi.fn(),
      connect: vi.fn(),
    };
    reportService = new ReportService(mockPool as any);
  });

  describe('getSummary', () => {
    it('should return complete summary for a date range', async () => {
      // Overview stats query
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            total_orders: '25',
            revenue: '5000000.00',
            paid_count: '20',
            cancelled_count: '3',
            unique_members: '8',
            new_members: '2',
          },
        ],
      });

      // Payment method breakdown query
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { payment_method: 'cash', revenue: '2500000.00', count: '10' },
          { payment_method: 'qris_static', revenue: '1500000.00', count: '6' },
          { payment_method: 'edc', revenue: '1000000.00', count: '4' },
        ],
      });

      // Business unit breakdown query
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { business_unit: 'AIRE', revenue: '4000000.00', count: '18' },
          { business_unit: 'LEAD', revenue: '1000000.00', count: '2' },
        ],
      });

      // Service breakdown query
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { service_id: 'svc-1', name: 'Premium Wash', total_quantity: '15', total_revenue: '3000000.00' },
          { service_id: 'svc-2', name: 'Basic Wash', total_quantity: '10', total_revenue: '1000000.00' },
        ],
      });

      const result = await reportService.getSummary('tenant-1', {
        dateFrom: '2024-01-01',
        dateTo: '2024-01-31',
      });

      expect(result.totalOrders).toBe(25);
      expect(result.revenue).toBe(5000000);
      expect(result.paidCount).toBe(20);
      expect(result.cancelledCount).toBe(3);
      expect(result.uniqueMembers).toBe(8);
      expect(result.newMembers).toBe(2);
      expect(result.byPaymentMethod).toEqual({
        cash: { revenue: 2500000, count: 10 },
        qris_static: { revenue: 1500000, count: 6 },
        edc: { revenue: 1000000, count: 4 },
      });
      expect(result.byBusinessUnit).toEqual({
        AIRE: { revenue: 4000000, count: 18 },
        LEAD: { revenue: 1000000, count: 2 },
      });
      expect(result.byService).toEqual([
        { serviceId: 'svc-1', name: 'Premium Wash', quantity: 15, revenue: 3000000 },
        { serviceId: 'svc-2', name: 'Basic Wash', quantity: 10, revenue: 1000000 },
      ]);
    });

    it('should return zero values when no orders exist', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            total_orders: '0',
            revenue: '0',
            paid_count: '0',
            cancelled_count: '0',
            unique_members: '0',
            new_members: '0',
          },
        ],
      });
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await reportService.getSummary('tenant-1', {
        dateFrom: '2024-01-01',
        dateTo: '2024-01-31',
      });

      expect(result.totalOrders).toBe(0);
      expect(result.revenue).toBe(0);
      expect(result.paidCount).toBe(0);
      expect(result.cancelledCount).toBe(0);
      expect(result.uniqueMembers).toBe(0);
      expect(result.newMembers).toBe(0);
      expect(result.byPaymentMethod).toEqual({});
      expect(result.byBusinessUnit).toEqual({ AIRE: { revenue: 0, count: 0 }, LEAD: { revenue: 0, count: 0 } });
      expect(result.byService).toEqual([]);
    });

    it('should pass outletId filter when provided', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            total_orders: '5',
            revenue: '1000000.00',
            paid_count: '4',
            cancelled_count: '1',
            unique_members: '2',
            new_members: '1',
          },
        ],
      });
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await reportService.getSummary('tenant-1', {
        dateFrom: '2024-01-01',
        dateTo: '2024-01-31',
        outletIds: ['outlet-123'],
      });

      // Overview, payment, business-unit, and service queries all receive the
      // scoped outlet ids (passed as a single uuid[] parameter).
      expect(mockPool.query).toHaveBeenCalledTimes(4);
      for (const call of mockPool.query.mock.calls) {
        expect(call[1]).toContainEqual(['outlet-123']);
      }
    });

    it('should not include outlet filter when outletId is not provided', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            total_orders: '10',
            revenue: '2000000.00',
            paid_count: '8',
            cancelled_count: '2',
            unique_members: '4',
            new_members: '1',
          },
        ],
      });
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await reportService.getSummary('tenant-1', {
        dateFrom: '2024-01-01',
        dateTo: '2024-01-31',
      });

      // Each query should have 3 params (dateFrom, dateTo, tenantId)
      for (const call of mockPool.query.mock.calls) {
        expect(call[1]).toHaveLength(3);
      }
    });
  });

  describe('exportCsv', () => {
    it('should return CSV with headers and order rows', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            order_number: 'ORD-20240101-001',
            created_at: new Date('2024-01-01T10:00:00Z'),
            customer_name: 'John Doe',
            customer_phone: '628123456789',
            status: 'paid',
            payment_method: 'cash',
            total: '150000.00',
            note: null,
            items: 'Premium Wash x1; Interior Clean x1',
          },
          {
            order_number: 'ORD-20240101-002',
            created_at: new Date('2024-01-01T11:00:00Z'),
            customer_name: 'Jane Smith',
            customer_phone: '628987654321',
            status: 'completed',
            payment_method: 'qris_static',
            total: '200000.00',
            note: 'Extra shiny',
            items: 'Super Wash x1',
          },
        ],
      });

      const csv = await reportService.exportCsv('tenant-1', {
        dateFrom: '2024-01-01',
        dateTo: '2024-01-01',
      });

      const lines = csv.split('\n');
      expect(lines[0]).toBe(
        'Order Number,Date,Business Unit,Customer,Phone,Salesperson,Status,Payment Method,Payment Channel,Total,Items,Note',
      );
      expect(lines.length).toBe(3); // header + 2 rows
      expect(lines[1]).toContain('ORD-20240101-001');
      expect(lines[1]).toContain('John Doe');
      expect(lines[1]).toContain('150000.00');
      expect(lines[2]).toContain('ORD-20240101-002');
      expect(lines[2]).toContain('Jane Smith');
    });

    it('should return only headers when no orders exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const csv = await reportService.exportCsv('tenant-1', {
        dateFrom: '2024-01-01',
        dateTo: '2024-01-01',
      });

      const lines = csv.split('\n');
      expect(lines.length).toBe(1);
      expect(lines[0]).toBe(
        'Order Number,Date,Business Unit,Customer,Phone,Salesperson,Status,Payment Method,Payment Channel,Total,Items,Note',
      );
    });

    it('should escape CSV values containing commas', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            order_number: 'ORD-20240101-001',
            created_at: new Date('2024-01-01T10:00:00Z'),
            customer_name: 'Smith, John',
            customer_phone: '628123456789',
            status: 'paid',
            payment_method: 'cash',
            total: '100000.00',
            note: 'Includes wax, polish',
            items: 'Basic Wash x1',
          },
        ],
      });

      const csv = await reportService.exportCsv('tenant-1', {
        dateFrom: '2024-01-01',
        dateTo: '2024-01-01',
      });

      const lines = csv.split('\n');
      // Values with commas should be quoted
      expect(lines[1]).toContain('"Smith, John"');
      expect(lines[1]).toContain('"Includes wax, polish"');
    });

    it('should pass outletIds filter to query when provided', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await reportService.exportCsv('tenant-1', {
        dateFrom: '2024-01-01',
        dateTo: '2024-01-31',
        outletIds: ['outlet-456'],
      });

      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const [, params] = mockPool.query.mock.calls[0];
      expect(params).toContainEqual(['outlet-456']);
    });
  });
});
