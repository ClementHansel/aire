import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderListService } from './order-list.service';
import { OrderStatus } from '@aire/shared';

const TENANT = '11111111-1111-1111-1111-111111111111';

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
    { order_id: 'order-001', service_name: 'Super Wash', item_type: 'service', quantity: 1, subtotal: '100000.00', is_member_pricing: false, discount: '0' },
    { order_id: 'order-001', service_name: 'Vacuum', item_type: 'service', quantity: 2, subtotal: '50000.00', is_member_pricing: false, discount: '0' },
    { order_id: 'order-002', service_name: 'Basic Wash', item_type: 'service', quantity: 1, subtotal: '75000.00', is_member_pricing: false, discount: '0' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    // Default every un-stubbed query to an empty result. The cases below stub the
    // count/orders/items calls positionally, and without this baseline any query
    // added afterwards (e.g. the discount-source attribution load) makes the next
    // call resolve to undefined and breaks tests whose assertions all still hold.
    mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
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

      const result = await service.listOrders({ tenantId: TENANT });

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
        itemType: 'service',
        isMemberPricing: false,
        memberDiscountType: null,
        memberDiscountValue: null,
        discount: 0,
      });

      // Second order - no plate/brand
      expect(result.orders[1]!.licensePlate).toBeUndefined();
      expect(result.orders[1]!.vehicleBrand).toBeUndefined();
      expect(result.orders[1]!.items).toHaveLength(1);
    });

    it('keeps membership-plan and voucher-pack lines, which have no services row', async () => {
      // AIRIN-115: the items query used to INNER JOIN services on oi.service_id,
      // which is NULL for a pack/plan line (migration 089) — so an order that was
      // a membership or voucher-pack purchase came back with NO items at all and
      // the cashier could not tell what had been sold. The name comes from
      // oi.item_name via COALESCE, and item_type says which kind it is.
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockOrderRow] });
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { order_id: 'order-001', service_name: 'Paket Member Gold', item_type: 'membership_plan', quantity: 1, subtotal: '500000.00', is_member_pricing: false, discount: '0' },
          { order_id: 'order-001', service_name: 'Voucher Cuci 10x', item_type: 'voucher_pack', quantity: 1, subtotal: '300000.00', is_member_pricing: false, discount: '0' },
        ],
      });

      const result = await service.listOrders({ tenantId: TENANT });

      const itemsQuery = String(mockPool.query.mock.calls[2]![0]);
      expect(itemsQuery).toContain('LEFT JOIN services');
      expect(itemsQuery).toContain('COALESCE(s.name, oi.item_name)');
      expect(result.orders[0]!.items).toHaveLength(2);
      expect(result.orders[0]!.items[0]).toEqual({
        serviceName: 'Paket Member Gold', quantity: 1, subtotal: 500000, itemType: 'membership_plan',
        isMemberPricing: false, memberDiscountType: null, memberDiscountValue: null, discount: 0,
      });
      expect(result.orders[0]!.items[1]!.itemType).toBe('voucher_pack');
    });

    it('reports WHY a line is free — a membership benefit, not just a lower number', async () => {
      // A Rp 0 wash beside a full-price add-on was unexplained on the card: a
      // membership, a voucher and a cashier discount all just showed less money.
      // is_member_pricing was already recorded on the row, never surfaced
      // (Samuel 2026-08-06).
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockOrderRow] });
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { order_id: 'order-001', service_name: 'Standard Car Wash', item_type: 'service', quantity: 1, subtotal: '0.00', is_member_pricing: true, discount: '60000.00' },
          { order_id: 'order-001', service_name: '+ Spray Wax', item_type: 'service', quantity: 1, subtotal: '50000.00', is_member_pricing: false, discount: '0' },
        ],
      });

      const result = await service.listOrders({ tenantId: TENANT });

      expect(String(mockPool.query.mock.calls[2]![0])).toContain('is_member_pricing');
      expect(result.orders[0]!.items[0]).toMatchObject({
        serviceName: 'Standard Car Wash', subtotal: 0, isMemberPricing: true, discount: 60000,
      });
      // The add-on the member still pays for must NOT be flagged.
      expect(result.orders[0]!.items[1]!.isMemberPricing).toBe(false);
    });

    it('names WHICH promo and WHICH voucher discounted the order', async () => {
      // Attribution, not just an amount: promotion_grants and redeemed tickets have
      // always recorded this and were never read back, so a discounted line could
      // not be traced to the campaign that caused it (Samuel 2026-08-06).
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockOrderRow] });
      mockPool.query.mockResolvedValueOnce({ rows: mockItemRows.slice(0, 1) });
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { order_id: 'order-001', kind: 'promo', label: 'Bonus 3x Spray Wax', amount: '15000.00', covers_service_id: null, via_campaign: null },
          { order_id: 'order-001', kind: 'voucher', label: 'Standard Car Wash (KCL-082026-000050)', amount: null, covers_service_id: 'svc-wash', via_campaign: 'Bonus 3x Spray Wax Setiap Pembelian Voucher Pack 10x' },
          { order_id: 'order-001', kind: 'campaign', label: 'Unlimited Wash Launch Bonus -> Rp 25.000 Discount x5', amount: null, covers_service_id: null, via_campaign: 'Unlimited Wash Launch Bonus' },
        ],
      });

      const result = await service.listOrders({ tenantId: TENANT });

      const sql = String(mockPool.query.mock.calls[3]![0]);
      expect(sql).toContain('promotion_grants');
      expect(sql).toContain('redeemed_order_id');
      // Campaign attribution, both directions: which campaign granted a redeemed
      // voucher, and which campaign this order's purchase triggered.
      expect(sql).toContain('campaign_grants');
      expect(sql).toContain('campaigns');
      expect(result.orders[0]!.discountSources).toEqual([
        { kind: 'promo', label: 'Bonus 3x Spray Wax', amount: 15000, coversServiceId: null, viaCampaign: null },
        {
          kind: 'voucher', label: 'Standard Car Wash (KCL-082026-000050)', amount: null,
          coversServiceId: 'svc-wash', viaCampaign: 'Bonus 3x Spray Wax Setiap Pembelian Voucher Pack 10x',
        },
        {
          kind: 'campaign', label: 'Unlimited Wash Launch Bonus -> Rp 25.000 Discount x5',
          amount: null, coversServiceId: null, viaCampaign: 'Unlimited Wash Launch Bonus',
        },
      ]);
    });

    it('should return empty result when no orders match', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 0 }] });

      const result = await service.listOrders({ tenantId: TENANT });

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

      const result = await service.listOrders({ tenantId: TENANT, status: OrderStatus.Paid });

      expect(result.total).toBe(1);
      // Tenant scope is always $1; status is therefore $2.
      const countCall = mockPool.query.mock.calls[0];
      expect(countCall[0]).toContain('o.tenant_id = $1');
      expect(countCall[0]).toContain('o.status = $2');
      expect(countCall[1]).toContain(TENANT);
      expect(countCall[1]).toContain('paid');
    });

    it('should search by order_number, customer_name, or customer_phone', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockOrderRow] });
      mockPool.query.mockResolvedValueOnce({ rows: mockItemRows.slice(0, 2) });

      const result = await service.listOrders({ tenantId: TENANT, search: 'John' });

      expect(result.total).toBe(1);
      const countCall = mockPool.query.mock.calls[0];
      expect(countCall[0]).toContain('ILIKE');
      expect(countCall[1]).toContain('%John%');
    });

    it('finds an order by plate regardless of spacing', async () => {
      // AIRIN-117: plates were stored as typed, so searching "B 8882 CST" missed
      // an order stored as "B8882CST" and vice-versa. The search term is
      // normalized and matched against plate_normalized.
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockOrderRow] });
      mockPool.query.mockResolvedValueOnce({ rows: mockItemRows.slice(0, 2) });

      await service.listOrders({ tenantId: TENANT, search: 'b 8882 cst' });

      const countCall = mockPool.query.mock.calls[0];
      expect(countCall[0]).toContain('plate_normalized');
      // Canonical pattern for plate matching…
      expect(countCall[1]).toContain('%B8882CST%');
      // …alongside the raw pattern, so pre-backfill rows stay findable via
      // license_plate and name/phone/order-number search still works.
      expect(countCall[1]).toContain('%b 8882 cst%');
    });

    it('should filter by date range', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockOrderRow] });
      mockPool.query.mockResolvedValueOnce({ rows: mockItemRows.slice(0, 2) });

      await service.listOrders({
        tenantId: TENANT,
        dateFrom: '2024-01-15',
        dateTo: '2024-01-16',
      });

      // Tenant scope is $1, dateFrom $2, dateTo $3.
      const countCall = mockPool.query.mock.calls[0];
      expect(countCall[0]).toContain('o.created_at >=');
      expect(countCall[0]).toContain("o.created_at < ($3::date + interval '1 day')");
      expect(countCall[1]).toContain('2024-01-15');
      expect(countCall[1]).toContain('2024-01-16');
    });

    it('should filter by the role-resolved outletIds set', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockOrderRow] });
      mockPool.query.mockResolvedValueOnce({ rows: mockItemRows.slice(0, 2) });

      await service.listOrders({ tenantId: TENANT, outletIds: ['outlet-001'] });

      // Tenant scope is $1; the branch set is applied as ANY($2::uuid[]).
      const countCall = mockPool.query.mock.calls[0];
      expect(countCall[0]).toContain('o.outlet_id = ANY($2::uuid[])');
      expect(countCall[1]).toEqual([TENANT, ['outlet-001']]);
    });

    it('should NOT filter by branch when outletIds is null (all branches)', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockOrderRow] });
      mockPool.query.mockResolvedValueOnce({ rows: mockItemRows.slice(0, 2) });

      await service.listOrders({ tenantId: TENANT, outletIds: null });

      const countCall = mockPool.query.mock.calls[0];
      expect(countCall[0]).toContain('o.tenant_id = $1');
      expect(countCall[0]).not.toContain('o.outlet_id');
      expect(countCall[1]).toEqual([TENANT]);
    });

    it('should apply pagination correctly', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 50 }] });
      mockPool.query.mockResolvedValueOnce({
        rows: [mockOrderRow],
      });
      mockPool.query.mockResolvedValueOnce({ rows: mockItemRows.slice(0, 2) });

      const result = await service.listOrders({ tenantId: TENANT, page: 2, pageSize: 10 });

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

      const result = await service.listOrders({ tenantId: TENANT, pageSize: 500 });

      expect(result.pageSize).toBe(100);
      const ordersCall = mockPool.query.mock.calls[1];
      const queryParams = ordersCall[1];
      expect(queryParams[queryParams.length - 2]).toBe(100); // capped at 100
    });

    it('should default page to 1 and pageSize to 20', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockOrderRow] });
      mockPool.query.mockResolvedValueOnce({ rows: mockItemRows.slice(0, 2) });

      const result = await service.listOrders({ tenantId: TENANT });

      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
    });

    it('should handle orders with no items', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockOrderRow] });
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // no items found

      const result = await service.listOrders({ tenantId: TENANT });

      expect(result.orders[0]!.items).toEqual([]);
    });

    it('should combine multiple filters', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockOrderRow] });
      mockPool.query.mockResolvedValueOnce({ rows: mockItemRows.slice(0, 2) });

      await service.listOrders({
        tenantId: TENANT,
        status: OrderStatus.Paid,
        search: 'John',
        dateFrom: '2024-01-15',
        outletIds: ['outlet-001'],
      });

      const countCall = mockPool.query.mock.calls[0];
      expect(countCall[0]).toContain('o.tenant_id = $1');
      expect(countCall[0]).toContain('o.status = $2');
      expect(countCall[0]).toContain('ILIKE');
      expect(countCall[0]).toContain('o.created_at >=');
      expect(countCall[0]).toContain('o.outlet_id = ANY(');
    });

    it('should set hasMore to false on last page', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 20 }] });
      mockPool.query.mockResolvedValueOnce({
        rows: Array(20).fill(mockOrderRow).map((r, i) => ({ ...r, id: `order-${i}` })),
      });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.listOrders({ tenantId: TENANT, page: 1, pageSize: 20 });

      // offset(0) + 20 items = 20, not less than total(20) so hasMore = false
      expect(result.hasMore).toBe(false);
    });

    it('should ignore empty search string', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockOrderRow] });
      mockPool.query.mockResolvedValueOnce({ rows: mockItemRows.slice(0, 2) });

      await service.listOrders({ tenantId: TENANT, search: '   ' });

      const countCall = mockPool.query.mock.calls[0];
      expect(countCall[0]).not.toContain('ILIKE');
    });

    it('should handle page < 1 by defaulting to page 1', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockOrderRow] });
      mockPool.query.mockResolvedValueOnce({ rows: mockItemRows.slice(0, 2) });

      const result = await service.listOrders({ tenantId: TENANT, page: -1 });

      expect(result.page).toBe(1);
      const ordersCall = mockPool.query.mock.calls[1];
      const queryParams = ordersCall[1];
      expect(queryParams[queryParams.length - 1]).toBe(0); // offset = 0
    });
  });
});
