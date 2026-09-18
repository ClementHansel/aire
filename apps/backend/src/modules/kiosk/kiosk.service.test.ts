import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { KioskService } from './kiosk.service';

describe('KioskService', () => {
  let service: KioskService;
  let mockPool: { query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = { query: vi.fn() };
    service = new KioskService(mockPool as any);
  });

  describe('getQueueStatus', () => {
    it('should throw BadRequestException for empty order number', async () => {
      await expect(service.getQueueStatus('tenant-1', '')).rejects.toThrow(BadRequestException);
      await expect(service.getQueueStatus('tenant-1', '   ')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when no tenant is given', async () => {
      // This endpoint is unauthenticated, so the tenant cannot come from a JWT.
      // Letting it through unscoped is what leaked another tenant's customer.
      await expect(service.getQueueStatus('', 'ORD-001')).rejects.toThrow(BadRequestException);
      await expect(service.getQueueStatus('   ', 'ORD-001')).rejects.toThrow(BadRequestException);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('scopes the lookup by tenant, because order numbers repeat across them', async () => {
      // ORD-YYYYMMDD-NNN is sequential per outlet per day with no cross-tenant
      // unique constraint, so two businesses trading the same day both mint
      // ORD-20260918-001. Unscoped, this returned whichever row Postgres
      // reached first — another tenant's customer_name, to an anonymous caller
      // holding a guessable order number.
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.getQueueStatus('tenant-2', 'ORD-20260918-001');

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toMatch(/o\.tenant_id\s*=\s*\$1/);
      expect(params).toEqual(['tenant-2', 'ORD-20260918-001']);
    });

    it('scopes the board counts by tenant too', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{
          id: 'o1', order_number: 'ORD-001', customer_name: 'John', outlet_id: 'outlet-1',
          queue_entry_id: 'q1', position: 3, queue_status: 'waiting',
        }] })
        .mockResolvedValueOnce({ rows: [{ count: '2' }] })
        .mockResolvedValueOnce({ rows: [{ count: '5' }] });

      await service.getQueueStatus('tenant-1', 'ORD-001');

      for (const call of mockPool.query.mock.calls.slice(1)) {
        expect(call[0]).toMatch(/tenant_id\s*=\s*\$1/);
        expect(call[1][0]).toBe('tenant-1');
      }
    });

    it('should return not_found status when order does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.getQueueStatus('tenant-1', 'ORD-001');

      expect(result.status).toBe('not_found');
      expect(result.orderNumber).toBe('ORD-001');
      expect(result.position).toBe(0);
      expect(result.estimatedWaitMinutes).toBe(0);
    });

    it('should return not_found when order exists but has no queue entry', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'order-id-1',
          order_number: 'ORD-001',
          customer_name: 'John',
          outlet_id: 'outlet-1',
          queue_entry_id: null,
          position: null,
          queue_status: null,
        }],
      });

      const result = await service.getQueueStatus('tenant-1', 'ORD-001');

      expect(result.status).toBe('not_found');
      expect(result.orderId).toBe('order-id-1');
      expect(result.customerName).toBe('John');
    });

    it('should return waiting status with position and estimated wait time', async () => {
      // Order + vehicle_queue entry query
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'order-id-1',
          order_number: 'ORD-001',
          customer_name: 'John',
          outlet_id: 'outlet-1',
          queue_entry_id: 'vq-1',
          position: 3,
          queue_status: 'waiting',
        }],
      });

      // Entries ahead count
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '2' }] });

      // Total waiting count
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '5' }] });

      const result = await service.getQueueStatus('tenant-1', 'ORD-001');

      expect(result.status).toBe('waiting');
      expect(result.orderNumber).toBe('ORD-001');
      expect(result.customerName).toBe('John');
      expect(result.position).toBe(3); // 2 ahead + 1
      expect(result.totalWaiting).toBe(5);
      expect(result.estimatedWaitMinutes).toBe(30); // 2 * 15 min
    });

    it('should map serving -> in_progress, still showing its place on the board', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'order-id-2',
          order_number: 'ORD-002',
          customer_name: 'Jane',
          outlet_id: 'outlet-1',
          queue_entry_id: 'vq-2',
          position: 1,
          queue_status: 'serving',
        }],
      });
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] }); // ahead
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '3' }] }); // total

      const result = await service.getQueueStatus('tenant-1', 'ORD-002');

      expect(result.status).toBe('in_progress');
      // Since AIRIN-170 every car is 'serving' from arrival, so 'serving' can no
      // longer mean "no longer queued" — the customer is first in line (0 ahead),
      // which is a real position, not a blank.
      expect(result.position).toBe(1);
      expect(result.estimatedWaitMinutes).toBe(0); // nobody ahead
    });

    it('should map done -> completed', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'order-id-3',
          order_number: 'ORD-003',
          customer_name: 'Bob',
          outlet_id: 'outlet-1',
          queue_entry_id: 'vq-3',
          position: 1,
          queue_status: 'done',
        }],
      });
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '2' }] });

      const result = await service.getQueueStatus('tenant-1', 'ORD-003');

      expect(result.status).toBe('completed');
      expect(result.estimatedWaitMinutes).toBe(0);
    });

    it('should map cancelled -> not_found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'order-id-4',
          order_number: 'ORD-004',
          customer_name: 'Al',
          outlet_id: 'outlet-1',
          queue_entry_id: 'vq-4',
          position: 1,
          queue_status: 'cancelled',
        }],
      });

      const result = await service.getQueueStatus('tenant-1', 'ORD-004');

      expect(result.status).toBe('not_found');
    });

    it('should trim order number before querying', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.getQueueStatus('tenant-1', '  ORD-001  ');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        ['tenant-1', 'ORD-001'],
      );
    });
  });
});
