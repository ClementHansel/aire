import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { CustomerService } from './customer.service';

function createMockPool() {
  return {
    query: vi.fn(),
  };
}

describe('CustomerService', () => {
  let service: CustomerService;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = createMockPool();
    service = new CustomerService(mockPool as any);
  });

  describe('getProfile', () => {
    it('should return a full customer profile', async () => {
      // Customer base info
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'cust-001',
            name: 'John Doe',
            phone: '628123456789',
            created_at: '2024-01-01T00:00:00Z',
          },
        ],
      });
      // Visit summary
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            total_visits: 15,
            total_spending: '2500000',
            last_visit_date: '2024-06-20T10:00:00Z',
          },
        ],
      });
      // Memberships
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'mem-001',
            plan_name: 'Gold Monthly',
            status: 'active',
            start_date: '2024-06-01',
            end_date: '2024-07-01',
            uses_count: 5,
            max_uses: 30,
          },
        ],
      });
      // Recent visits
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            order_id: 'ord-001',
            order_number: 'ORD-001',
            outlet_name: 'Outlet A',
            date: '2024-06-20T10:00:00Z',
            total: '150000',
            payment_method: 'cash',
          },
        ],
      });
      // Services for orders
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { order_id: 'ord-001', service_name: 'Premium Wash' },
          { order_id: 'ord-001', service_name: 'Interior Clean' },
        ],
      });
      // Service preferences
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            service_id: 'svc-001',
            service_name: 'Premium Wash',
            times_used: 10,
            total_spent: '1500000',
          },
        ],
      });
      // Voucher usage
      mockPool.query.mockResolvedValueOnce({
        rows: [{ total_redeemed: 3, total_saved: '75000' }],
      });

      const result = await service.getProfile('cust-001');

      expect(result.id).toBe('cust-001');
      expect(result.name).toBe('John Doe');
      expect(result.phone).toBe('628123456789');
      expect(result.totalVisits).toBe(15);
      expect(result.totalSpending).toBe(2500000);
      expect(result.lastVisitDate).toBe('2024-06-20T10:00:00Z');
      expect(result.memberships).toHaveLength(1);
      expect(result.memberships[0].planName).toBe('Gold Monthly');
      expect(result.memberships[0].status).toBe('active');
      expect(result.recentVisits).toHaveLength(1);
      expect(result.recentVisits[0].services).toEqual([
        'Premium Wash',
        'Interior Clean',
      ]);
      expect(result.servicePreferences).toHaveLength(1);
      expect(result.servicePreferences[0].timesUsed).toBe(10);
      expect(result.voucherUsage.totalRedeemed).toBe(3);
      expect(result.voucherUsage.totalSaved).toBe(75000);
    });

    it('should throw NotFoundException when customer does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.getProfile('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should handle customer with no visits', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'cust-002',
            name: 'Jane Smith',
            phone: '628987654321',
            created_at: '2024-06-15T00:00:00Z',
          },
        ],
      });
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { total_visits: 0, total_spending: '0', last_visit_date: null },
        ],
      });
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // memberships
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // recent visits
      // No order IDs means no services query
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // service preferences
      mockPool.query.mockResolvedValueOnce({
        rows: [{ total_redeemed: 0, total_saved: '0' }],
      });

      const result = await service.getProfile('cust-002');

      expect(result.totalVisits).toBe(0);
      expect(result.totalSpending).toBe(0);
      expect(result.lastVisitDate).toBeNull();
      expect(result.memberships).toHaveLength(0);
      expect(result.recentVisits).toHaveLength(0);
      expect(result.servicePreferences).toHaveLength(0);
    });
  });

  describe('getAnalytics', () => {
    it('should return full analytics for a customer', async () => {
      // Customer existence check
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'cust-001' }] });
      // Visit frequency
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            total_visits: 20,
            visits_30d: 5,
            visits_90d: 12,
            avg_days_between: '4.5',
          },
        ],
      });
      // Spending patterns
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            total_spending: '3000000',
            avg_order_value: '150000',
            spending_30d: '750000',
            spending_90d: '1800000',
            highest_order: '500000',
          },
        ],
      });
      // Service preferences
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            service_id: 'svc-001',
            service_name: 'Premium Wash',
            times_used: 15,
            total_spent: '2250000',
          },
        ],
      });
      // Membership status
      mockPool.query.mockResolvedValueOnce({ rows: [{ status: 'active' }] });
      // Last visit
      mockPool.query.mockResolvedValueOnce({
        rows: [{ last_visit: new Date().toISOString() }],
      });

      const result = await service.getAnalytics('cust-001');

      expect(result.customerId).toBe('cust-001');
      expect(result.visitFrequency.totalVisits).toBe(20);
      expect(result.visitFrequency.visitsLast30Days).toBe(5);
      expect(result.visitFrequency.visitsLast90Days).toBe(12);
      expect(result.visitFrequency.averageDaysBetweenVisits).toBe(4.5);
      expect(result.spendingPatterns.totalSpending).toBe(3000000);
      expect(result.spendingPatterns.averageOrderValue).toBe(150000);
      expect(result.spendingPatterns.highestOrder).toBe(500000);
      expect(result.servicePreferences).toHaveLength(1);
      expect(result.segmentation.frequencyTier).toBe('medium');
      expect(result.segmentation.spendTier).toBe('high');
      expect(result.segmentation.membershipStatus).toBe('active_member');
      expect(result.segmentation.recency).toBe('recent');
    });

    it('should throw NotFoundException when customer does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.getAnalytics('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should handle customer with no history', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'cust-003' }] });
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            total_visits: 0,
            visits_30d: 0,
            visits_90d: 0,
            avg_days_between: null,
          },
        ],
      });
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            total_spending: '0',
            avg_order_value: '0',
            spending_30d: '0',
            spending_90d: '0',
            highest_order: '0',
          },
        ],
      });
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // service prefs
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // membership
      mockPool.query.mockResolvedValueOnce({ rows: [{ last_visit: null }] });

      const result = await service.getAnalytics('cust-003');

      expect(result.visitFrequency.totalVisits).toBe(0);
      expect(result.visitFrequency.averageDaysBetweenVisits).toBeNull();
      expect(result.spendingPatterns.totalSpending).toBe(0);
      expect(result.segmentation.frequencyTier).toBe('inactive');
      expect(result.segmentation.spendTier).toBe('low');
      expect(result.segmentation.membershipStatus).toBe('non_member');
      expect(result.segmentation.recency).toBe('dormant');
    });

    it('should correctly segment a high-frequency VIP customer', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'cust-vip' }] });
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            total_visits: 50,
            visits_30d: 10,
            visits_90d: 30,
            avg_days_between: '2.0',
          },
        ],
      });
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            total_spending: '7500000',
            avg_order_value: '150000',
            spending_30d: '1500000',
            spending_90d: '4500000',
            highest_order: '800000',
          },
        ],
      });
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      mockPool.query.mockResolvedValueOnce({ rows: [{ status: 'active' }] });
      mockPool.query.mockResolvedValueOnce({
        rows: [{ last_visit: new Date().toISOString() }],
      });

      const result = await service.getAnalytics('cust-vip');

      expect(result.segmentation.frequencyTier).toBe('high');
      expect(result.segmentation.spendTier).toBe('vip');
      expect(result.segmentation.membershipStatus).toBe('active_member');
      expect(result.segmentation.recency).toBe('recent');
    });

    it('should segment expired member as expired_member', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'cust-ex' }] });
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            total_visits: 5,
            visits_30d: 0,
            visits_90d: 2,
            avg_days_between: '10',
          },
        ],
      });
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            total_spending: '800000',
            avg_order_value: '160000',
            spending_30d: '0',
            spending_90d: '320000',
            highest_order: '200000',
          },
        ],
      });
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      mockPool.query.mockResolvedValueOnce({ rows: [{ status: 'expired' }] });
      // Last visit 45 days ago
      const lastVisit = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
      mockPool.query.mockResolvedValueOnce({
        rows: [{ last_visit: lastVisit.toISOString() }],
      });

      const result = await service.getAnalytics('cust-ex');

      expect(result.segmentation.membershipStatus).toBe('expired_member');
      expect(result.segmentation.recency).toBe('lapsing');
      expect(result.segmentation.frequencyTier).toBe('inactive');
      expect(result.segmentation.spendTier).toBe('medium');
    });
  });

  describe('searchCustomers', () => {
    it('should return matching customers', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 1 }] });
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'cust-001',
            name: 'John Doe',
            phone: '628123456789',
            membership_status: 'active',
            total_visits: 10,
            last_visit_date: '2024-06-20T10:00:00Z',
          },
        ],
      });

      const result = await service.searchCustomers('John');

      expect(result.total).toBe(1);
      expect(result.customers).toHaveLength(1);
      expect(result.customers[0].name).toBe('John Doe');
      expect(result.customers[0].membershipStatus).toBe('active');
      expect(result.customers[0].totalVisits).toBe(10);
    });

    it('should return empty results when no match found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 0 }] });

      const result = await service.searchCustomers('Nonexistent');

      expect(result.total).toBe(0);
      expect(result.customers).toHaveLength(0);
    });

    it('should respect pagination parameters', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 50 }] });
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'cust-021',
            name: 'Customer 21',
            phone: '628111111111',
            membership_status: null,
            total_visits: 2,
            last_visit_date: '2024-06-10T10:00:00Z',
          },
        ],
      });

      const result = await service.searchCustomers('Customer', 3, 10);

      expect(result.total).toBe(50);
      // Verify offset calculation: (3-1)*10 = 20
      const queryCall = mockPool.query.mock.calls[1];
      expect(queryCall[1]).toEqual(['%Customer%', 10, 20]);
    });

    it('should cap page size at 100', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ total: 200 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.searchCustomers('test', 1, 500);

      const queryCall = mockPool.query.mock.calls[1];
      expect(queryCall[1][1]).toBe(100); // pageSize capped at 100
    });
  });
});
