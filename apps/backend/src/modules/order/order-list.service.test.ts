import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderListService } from './order-list.service';
import { OrderStatus } from '@aire/shared';

describe('OrderListService', () => {
  let service: OrderListService;
  let mockPool: { query: ReturnType<typeof vi.fn> };

  const mockOrderRow = {
    id: 'order-001',
    order_number: 'ORD-001',
    customer_name: 'John Doe',
    customer_phone: '6281234567890',
    license_plate: 'B1234ABC',
    vehicle_brand: 'Toyota',
    operator_name: 'Cashier One',
    status: 'paid',
    total: '150000.00',
    created_at: '2024-01-15T10:00:00.000Z',
  };

  const mockOrderRow2 = {
    id: 'order-002',
    order_number: 'ORD-002',
    customer_name: 'Jane Smith',
    customer_phone: '6289876543210',
    license_plate: null,
    vehicle_brand: null,
    operator_name: 'Cashier Two',
    status: 'ordered',
    total: '75000.00',
    created_at: '2024-01-15T11:00:00.000Z',
  };

  const mockItemRows = [
    { order_id: 'order-001', service_name: 'Super Wash', quantity: 1, subtotal: '100000.00' },
    { order_id: 'order-001', service_name: 'Vacuum', quantity: 2, subtotal: '50000.00' },
    { order_id: 'order-002', service_name: 'Basic Wash', quantity: 1, subtotal: '75000.00' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = { query: vi.fn() };
    service = new OrderListService(mockPool as any);
  });

  describe('listOrders', () => {
    it('should return paginated orders with items', async () => {
      // Count query
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 2 }] });
      // Orders query
      mockPool.query.mockResolvedValueOnce({ rows: [mockOrderRow, mockOrderRow2] });
      // Items query
      mockPool.query.mockResolvedValueOnce({ rows: mockItemRows });

      const result = await service.listOrders({});

      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.hasMore).toBe(false);
      expect(result.orders).toHaveLength(2);

      // First order
      expect(result.orders[0]!.id).toBe('order-001');
      expect(result.orders[0]!.orderNumber).toBe('ORD-001');
      expect(result.orders[0]!.customerName).toBe('John Doe');
      expect(result.orders[0]!.customerPhone).toBe('6281234567890');
      expect(result.orders[0]!.licensePlate).toBe('B1234ABC');
      expect(result.orders[0]!.vehicleBrand).toBe('Toyota');
      expect(result.orders[0]!.operatorName).toBe('Cashier One');
      expect(result.orders[0]!.status).toBe('paid');
      expect(result.orders[0]!.total).toBe(150000);
      expect(result.orders[0]!.items).toHaveLength(2);
      expect(result.orders[0]!.items[0]).toEqual({
        serviceName: 'Super Wash',
        quantity: 1,
        subtotal: 100000,
      });

      // Second order - no plate/brand
      expect(result.orders[1]!.licensePlate).toBeUndefined();
      expect(result.orders[1]!.vehicleBrand).toBeUndefined();
      expect(result.orders[1]!.items).toHaveLength(1);
    });

    it('should return empty result when no orders match', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 0 }] });

      const result = await service.listOrders({});

      expect(result.orders).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
      // Should only have called the count query
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });

    it('should filter by status', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockOrderRow] });
      mockPool.query.mockResolvedValueOnce({ rows: mockItemRows.slice(0, 2) });

      const result = await service.listOrders({ status: OrderStatus.Paid });

      expect(result.total).toBe(1);
      // Verify status was included as a parameter in the count query
      const countCall = mockPool.query.mock.calls[0];
      expect(countCall[0]).toContain('o.status = $1');
      expect(countCall[1]).toContain('paid');
    });

    it('should search by order_number, customer_name, or customer_phone', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockOrderRow] });
      mockPool.query.mockResolvedValueOnce({ rows: mockItemRows.slice(0, 2) });

      const result = await service.listOrders({ search: 'John' });

      expect(result.total).toBe(1);
      const countCall = mockPool.query.mock.calls[0];
      expect(countCall[0]).toContain('ILIKE');
      expect(countCall[1]).toContain('%John%');
    });

    it('should filter by date range', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockOrderRow] });
      mockPool.query.mockResolvedValueOnce({ rows: mockItemRows.slice(0, 2) });

      await service.listOrders({
        dateFrom: '2024-01-15',
        dateTo: '2024-01-16',
      });

      const countCall = mockPool.query.mock.calls[0];
      expect(countCall[0]).toContain('o.created_at >=');
      expect(countCall[0]).toContain("o.created_at < ($2::date + interval '1 day')");
      expect(countCall[1]).toContain('2024-01-15');
      expect(countCall[1]).toContain('2024-01-16');
    });

    it('should filter by outletId', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockOrderRow] });
      mockPool.query.mockResolvedValueOnce({ rows: mockItemRows.slice(0, 2) });

      await service.listOrders({ outletId: 'outlet-001' });

      const countCall = mockPool.query.mock.calls[0];
      expect(countCall[0]).toContain('o.outlet_id = $1::uuid');
      expect(countCall[1]).toContain('outlet-001');
    });

    it('should apply pagination correctly', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 50 }] });
      mockPool.query.mockResolvedValueOnce({
        rows: [mockOrderRow],
      });
      mockPool.query.mockResolvedValueOnce({ rows: mockItemRows.slice(0, 2) });

      const result = await service.listOrders({ page: 2, pageSize: 10 });

      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(10);
      expect(result.hasMore).toBe(true); // offset(10) + 1 = 11 < 50

      // Verify LIMIT and OFFSET in the orders query
      const ordersCall = mockPool.query.mock.calls[1];
      const queryParams = ordersCall[1];
      // Last two params are LIMIT and OFFSET
      expect(queryParams[queryParams.length - 2]).toBe(10); // pageSize
      expect(queryParams[queryParams.length - 1]).toBe(10); // offset = (2-1) * 10
    });

    it('should cap pageSize at MAX_PAGE_SIZE (100)', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockOrderRow] });
      mockPool.query.mockResolvedValueOnce({ rows: mockItemRows.slice(0, 2) });

      const result = await service.listOrders({ pageSize: 500 });

      expect(result.pageSize).toBe(100);
      const ordersCall = mockPool.query.mock.calls[1];
      const queryParams = ordersCall[1];
      expect(queryParams[queryParams.length - 2]).toBe(100); // capped at 100
    });

    it('should default page to 1 and pageSize to 20', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockOrderRow] });
      mockPool.query.mockResolvedValueOnce({ rows: mockItemRows.slice(0, 2) });

      const result = await service.listOrders({});

      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
    });

    it('should handle orders with no items', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockOrderRow] });
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // no items found

      const result = await service.listOrders({});

      expect(result.orders[0]!.items).toEqual([]);
    });

    it('should combine multiple filters', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockOrderRow] });
      mockPool.query.mockResolvedValueOnce({ rows: mockItemRows.slice(0, 2) });

      await service.listOrders({
        status: OrderStatus.Paid,
        search: 'John',
        dateFrom: '2024-01-15',
        outletId: 'outlet-001',
      });

      const countCall = mockPool.query.mock.calls[0];
      expect(countCall[0]).toContain('o.status = $1');
      expect(countCall[0]).toContain('ILIKE');
      expect(countCall[0]).toContain('o.created_at >=');
      expect(countCall[0]).toContain('o.outlet_id =');
    });

    it('should set hasMore to false on last page', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 20 }] });
      mockPool.query.mockResolvedValueOnce({
        rows: Array(20).fill(mockOrderRow).map((r, i) => ({ ...r, id: `order-${i}` })),
      });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.listOrders({ page: 1, pageSize: 20 });

      // offset(0) + 20 items = 20, not less than total(20) so hasMore = false
      expect(result.hasMore).toBe(false);
    });

    it('should ignore empty search string', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockOrderRow] });
      mockPool.query.mockResolvedValueOnce({ rows: mockItemRows.slice(0, 2) });

      await service.listOrders({ search: '   ' });

      const countCall = mockPool.query.mock.calls[0];
      expect(countCall[0]).not.toContain('ILIKE');
    });

    it('should handle page < 1 by defaulting to page 1', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockOrderRow] });
      mockPool.query.mockResolvedValueOnce({ rows: mockItemRows.slice(0, 2) });

      const result = await service.listOrders({ page: -1 });

      expect(result.page).toBe(1);
      const ordersCall = mockPool.query.mock.calls[1];
      const queryParams = ordersCall[1];
      expect(queryParams[queryParams.length - 1]).toBe(0); // offset = 0
    });
  });
});
