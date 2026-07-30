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

      // Product-mix breakdown query — services AND packs (migration 089), keyed
      // by item_id with the line's kind alongside it.
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { item_id: 'svc-1', name: 'Premium Wash', kind: 'service', total_quantity: '15', total_revenue: '3000000.00' },
          { item_id: 'plan-1', name: 'Membership Bulanan', kind: 'membership_plan', total_quantity: '2', total_revenue: '2000000.00' },
          { item_id: 'svc-2', name: 'Basic Wash', kind: 'service', total_quantity: '10', total_revenue: '1000000.00' },
        ],
      });

      // New-members count — fires LAST (getOverviewStats issues it after awaiting
      // the overview query, so it lands after the parallel payment/BU/service calls).
      mockPool.query.mockResolvedValueOnce({ rows: [{ n: '2' }] });

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
        { serviceId: 'svc-1', name: 'Premium Wash', kind: 'service', quantity: 15, revenue: 3000000 },
        { serviceId: 'plan-1', name: 'Membership Bulanan', kind: 'membership_plan', quantity: 2, revenue: 2000000 },
        { serviceId: 'svc-2', name: 'Basic Wash', kind: 'service', quantity: 10, revenue: 1000000 },
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
          },
        ],
      });
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      mockPool.query.mockResolvedValueOnce({ rows: [{ n: '0' }] }); // new-members count (fires last)

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
          },
        ],
      });
      mockPool.query.mockResolvedValueOnce({ rows: [{ n: '1' }] }); // new-members count
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await reportService.getSummary('tenant-1', {
        dateFrom: '2024-01-01',
        dateTo: '2024-01-31',
        outletIds: ['outlet-123'],
      });

      // Overview, new-members, payment, business-unit, and service queries all
      // receive the scoped outlet ids (passed as a single uuid[] parameter).
      expect(mockPool.query).toHaveBeenCalledTimes(5);
      for (const call of mockPool.query.mock.calls) {
        expect(call[1]).toContainEqual(['outlet-123']);
      }
    });

    it('applies the businessUnit filter to the business-unit breakdown too', async () => {
      // AIRIN-130: getBusinessUnitBreakdown was the only one of the four summary
      // queries that ignored `businessUnit`, so picking a unit narrowed every KPI
      // while the BU split card still showed both units at full revenue — which
      // is exactly what "the filter does nothing" looked like on screen.
      // getOverviewStats dereferences rows[0], so it needs a real row; the other
      // four summary queries tolerate an empty result.
      mockPool.query.mockResolvedValueOnce({
        rows: [{ total_orders: '0', revenue: '0', paid_count: '0', cancelled_count: '0', unique_members: '0' }],
      });
      for (let i = 0; i < 4; i++) mockPool.query.mockResolvedValueOnce({ rows: [] });

      await reportService.getSummary('tenant-1', {
        dateFrom: '2024-01-01',
        dateTo: '2024-01-31',
        businessUnit: 'LEAD',
      });

      const buCall = mockPool.query.mock.calls.find(
        ([sql]) => typeof sql === 'string' && sql.includes('GROUP BY business_unit'),
      );
      expect(buCall, 'business-unit breakdown query was not issued').toBeDefined();
      expect(buCall![0]).toContain('business_unit = $');
      expect(buCall![1]).toContain('LEAD');
    });

    it('leaves the business-unit breakdown unfiltered when no unit is selected', async () => {
      // getOverviewStats dereferences rows[0], so it needs a real row; the other
      // four summary queries tolerate an empty result.
      mockPool.query.mockResolvedValueOnce({
        rows: [{ total_orders: '0', revenue: '0', paid_count: '0', cancelled_count: '0', unique_members: '0' }],
      });
      for (let i = 0; i < 4; i++) mockPool.query.mockResolvedValueOnce({ rows: [] });

      await reportService.getSummary('tenant-1', { dateFrom: '2024-01-01', dateTo: '2024-01-31' });

      const buCall = mockPool.query.mock.calls.find(
        ([sql]) => typeof sql === 'string' && sql.includes('GROUP BY business_unit'),
      );
      expect(buCall![1]).not.toContain('LEAD');
      expect(buCall![1]).not.toContain('AIRE');
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
          },
        ],
      });
      mockPool.query.mockResolvedValueOnce({ rows: [{ n: '1' }] }); // new-members count
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

  /**
   * The two reports rebuilt from the owner's manual spreadsheet (Samuel
   * 2026-07-30). Both fan out several grouped queries and stitch the rows into
   * one table, so the stitching is what's worth pinning down.
   */
  describe('getDailyOperations', () => {
    /** The six queries fire via Promise.all in a fixed order. */
    const setup = (over: Partial<Record<'payments' | 'volume' | 'categories' | 'newMembers' | 'renewals' | 'vouchers', any[]>> = {}) => {
      mockPool.query
        .mockResolvedValueOnce({ rows: over.payments ?? [] })
        .mockResolvedValueOnce({ rows: over.volume ?? [] })
        .mockResolvedValueOnce({ rows: over.categories ?? [] })
        .mockResolvedValueOnce({ rows: over.newMembers ?? [] })
        .mockResolvedValueOnce({ rows: over.renewals ?? [] })
        .mockResolvedValueOnce({ rows: over.vouchers ?? [] });
    };

    it('splits card/QRIS revenue per business unit but keeps cash whole', async () => {
      setup({
        payments: [
          { day: '2026-01-01', method: 'cash', channel: 'AIRE', revenue: '60000' },
          { day: '2026-01-01', method: 'qris_dynamic', channel: 'AIRE', revenue: '540000' },
          { day: '2026-01-01', method: 'qris_dynamic', channel: 'LEAD', revenue: '1179000' },
        ],
      });

      const [row] = await reportService.getDailyOperations('tenant-1', { dateFrom: '2026-01-01', dateTo: '2026-01-01' });

      // Cash is one column in their sheet; the QRIS rail is split by unit.
      expect(row!.payments).toEqual({
        cash: 60000,
        'qris_dynamic|AIRE': 540000,
        'qris_dynamic|LEAD': 1179000,
      });
      expect(row!.revenue).toBe(1779000);
    });

    it('derives the non-member count and keys memberships by plan length', async () => {
      setup({
        volume: [{ day: '2026-01-01', orders: '57', member: '34' }],
        newMembers: [{ day: '2026-01-01', months: 1, n: '2' }],
        renewals: [{ day: '2026-01-01', months: 3, n: '5' }],
        vouchers: [{ day: '2026-01-01', n: '1' }],
        categories: [{ day: '2026-01-01', category: 'car_wash', qty: '65' }],
      });

      const [row] = await reportService.getDailyOperations('tenant-1', { dateFrom: '2026-01-01', dateTo: '2026-01-01' });

      expect(row!.memberOrders).toBe(34);
      expect(row!.nonMemberOrders).toBe(23);
      expect(row!.newMemberships).toEqual({ '1': 2 });
      expect(row!.renewals).toEqual({ '3': 5 });
      expect(row!.voucherPacks).toBe(1);
      expect(row!.itemsByCategory).toEqual({ car_wash: 65 });
    });

    it('returns one row per day, oldest first', async () => {
      setup({
        volume: [
          { day: '2026-01-02', orders: '5', member: '1' },
          { day: '2026-01-01', orders: '3', member: '0' },
        ],
      });

      const rows = await reportService.getDailyOperations('tenant-1', { dateFrom: '2026-01-01', dateTo: '2026-01-02' });
      expect(rows.map((r) => r.date)).toEqual(['2026-01-01', '2026-01-02']);
    });
  });

  describe('getAgentPerformance', () => {
    const setup = (newMembers: any[], renewals: any[], vouchers: any[], items: any[]) => {
      mockPool.query
        .mockResolvedValueOnce({ rows: newMembers })
        .mockResolvedValueOnce({ rows: renewals })
        .mockResolvedValueOnce({ rows: vouchers })
        .mockResolvedValueOnce({ rows: items });
    };

    it('builds an item x agent matrix with totals', async () => {
      setup(
        [{ agent: 'FITRI', months: 1, n: '18' }, { agent: 'ADEL', months: 1, n: '9' }],
        [{ agent: 'FITRI', months: 3, n: '9' }],
        [{ agent: 'FITRI', n: '26' }],
        [{ agent: 'ADEL', name: 'Microfiber', kind: 'service', qty: '2' }],
      );

      const report = await reportService.getAgentPerformance('tenant-1', { dateFrom: '2026-01-01', dateTo: '2026-01-31' });

      expect(report.agents).toEqual(['ADEL', 'FITRI']);
      const newMbr = report.rows.find((r) => r.item === 'NEW MBR (1mth)')!;
      expect(newMbr.byAgent).toEqual({ FITRI: 18, ADEL: 9 });
      expect(newMbr.total).toBe(27);
      expect(report.rows.find((r) => r.item === 'BELI PAKET VOU')!.total).toBe(26);
      expect(report.rows.find((r) => r.item === 'Microfiber')!.total).toBe(2);
    });

    it('does not double-count pack lines already counted from their own tables', async () => {
      setup(
        [{ agent: 'FITRI', months: 1, n: '1' }],
        [],
        [],
        // The merged POS writes the plan as an order line too — counting it here
        // as well would report the sale twice.
        [{ agent: 'FITRI', name: 'Unlimited 1 Month', kind: 'membership_plan', qty: '1' }],
      );

      const report = await reportService.getAgentPerformance('tenant-1', { dateFrom: '2026-01-01', dateTo: '2026-01-31' });

      expect(report.rows.map((r) => r.item)).toEqual(['NEW MBR (1mth)']);
    });

    it('groups orders with no salesperson under a single trailing column', async () => {
      setup([], [], [], [
        { agent: 'FITRI', name: 'Cuci Reguler', kind: 'service', qty: '3' },
        { agent: '—', name: 'Cuci Reguler', kind: 'service', qty: '7' },
      ]);

      const report = await reportService.getAgentPerformance('tenant-1', { dateFrom: '2026-01-01', dateTo: '2026-01-31' });

      expect(report.agents[report.agents.length - 1]).toBe('—');
      expect(report.rows[0]!.total).toBe(10);
    });
  });

});
