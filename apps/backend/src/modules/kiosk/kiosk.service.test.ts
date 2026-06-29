import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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
      await expect(service.getQueueStatus('')).rejects.toThrow(BadRequestException);
      await expect(service.getQueueStatus('   ')).rejects.toThrow(BadRequestException);
    });

    it('should return not_found status when order does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.getQueueStatus('ORD-001');

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
          order_status: 'paid',
          queue_entry_id: null,
          position: null,
          priority: null,
          queue_status: null,
          bay_id: null,
          bay_name: null,
        }],
      });

      const result = await service.getQueueStatus('ORD-001');

      expect(result.status).toBe('not_found');
      expect(result.orderId).toBe('order-id-1');
      expect(result.customerName).toBe('John');
    });

    it('should return waiting status with position and estimated wait time', async () => {
      // Order + queue entry query
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'order-id-1',
          order_number: 'ORD-001',
          customer_name: 'John',
          order_status: 'paid',
          queue_entry_id: 'qe-1',
          position: 3,
          priority: 0,
          queue_status: 'waiting',
          bay_id: null,
          bay_name: null,
        }],
      });

      // Entries ahead count
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '2' }] });

      // Total waiting count
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '5' }] });

      const result = await service.getQueueStatus('ORD-001');

      expect(result.status).toBe('waiting');
      expect(result.orderNumber).toBe('ORD-001');
      expect(result.customerName).toBe('John');
      expect(result.position).toBe(3); // 2 ahead + 1
      expect(result.totalWaiting).toBe(5);
      expect(result.estimatedWaitMinutes).toBe(30); // 2 * 15 min
      expect(result.bayName).toBeUndefined();
    });

    it('should return in_progress status with bay name', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'order-id-1',
          order_number: 'ORD-002',
          customer_name: 'Jane',
          order_status: 'confirmed',
          queue_entry_id: 'qe-2',
          position: 1,
          priority: 10,
          queue_status: 'in_progress',
          bay_id: 'bay-1',
          bay_name: 'Bay A',
        }],
      });

      // Entries ahead (0 for in_progress)
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

      // Total waiting
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '3' }] });

      const result = await service.getQueueStatus('ORD-002');

      expect(result.status).toBe('in_progress');
      expect(result.position).toBe(0); // not waiting, so position = 0
      expect(result.estimatedWaitMinutes).toBe(0); // in progress, no wait
      expect(result.bayName).toBe('Bay A');
    });

    it('should return completed status', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'order-id-3',
          order_number: 'ORD-003',
          customer_name: 'Bob',
          order_status: 'completed',
          queue_entry_id: 'qe-3',
          position: 1,
          priority: 0,
          queue_status: 'completed',
          bay_id: 'bay-2',
          bay_name: 'Bay B',
        }],
      });

      // Entries ahead
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

      // Total waiting
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '2' }] });

      const result = await service.getQueueStatus('ORD-003');

      expect(result.status).toBe('completed');
      expect(result.estimatedWaitMinutes).toBe(0);
    });

    it('should trim order number before querying', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.getQueueStatus('  ORD-001  ');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        ['ORD-001'],
      );
    });
  });

  describe('joinQueue', () => {
    it('should throw BadRequestException for empty orderId', async () => {
      await expect(service.joinQueue('', 'outlet-1')).rejects.toThrow(BadRequestException);
      await expect(service.joinQueue('   ', 'outlet-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for empty outletId', async () => {
      await expect(service.joinQueue('order-1', '')).rejects.toThrow(BadRequestException);
      await expect(service.joinQueue('order-1', '   ')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when order does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.joinQueue('order-1', 'outlet-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when order is not paid', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'order-1', order_number: 'ORD-001', status: 'ordered', customer_id: 'c1', membership_id: null }],
      });

      await expect(service.joinQueue('order-1', 'outlet-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when order is already in queue', async () => {
      // Order exists and is paid
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'order-1', order_number: 'ORD-001', status: 'paid', customer_id: 'c1', membership_id: null }],
      });

      // Already in queue
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'qe-existing' }],
      });

      await expect(service.joinQueue('order-1', 'outlet-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should successfully join queue for a paid order (non-member)', async () => {
      // Order exists and is paid, no membership
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'order-1', order_number: 'ORD-001', status: 'paid', customer_id: 'c1', membership_id: null }],
      });

      // Not already in queue
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      // Next position
      mockPool.query.mockResolvedValueOnce({ rows: [{ next_position: '4' }] });

      // Insert queue entry
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'qe-new',
          order_id: 'order-1',
          position: 4,
          priority: 0,
          is_member: false,
          status: 'waiting',
          created_at: new Date('2024-07-01T10:00:00Z'),
        }],
      });

      // Entries ahead
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '3' }] });

      const result = await service.joinQueue('order-1', 'outlet-1');

      expect(result.id).toBe('qe-new');
      expect(result.orderId).toBe('order-1');
      expect(result.orderNumber).toBe('ORD-001');
      expect(result.position).toBe(4); // 3 ahead + 1
      expect(result.priority).toBe(0);
      expect(result.isMember).toBe(false);
      expect(result.estimatedWaitMinutes).toBe(45); // 3 * 15
      expect(result.createdAt).toBe('2024-07-01T10:00:00.000Z');
    });

    it('should assign member priority when order has membership', async () => {
      // Order exists, is paid, has membership
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'order-2', order_number: 'ORD-002', status: 'confirmed', customer_id: 'c2', membership_id: 'mem-1' }],
      });

      // Not already in queue
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      // Next position
      mockPool.query.mockResolvedValueOnce({ rows: [{ next_position: '2' }] });

      // Insert queue entry - priority=10 for member
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'qe-mem',
          order_id: 'order-2',
          position: 2,
          priority: 10,
          is_member: true,
          status: 'waiting',
          created_at: new Date('2024-07-01T10:05:00Z'),
        }],
      });

      // Entries ahead (only 0 with higher priority since member has 10)
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

      const result = await service.joinQueue('order-2', 'outlet-1');

      expect(result.priority).toBe(10);
      expect(result.isMember).toBe(true);
      expect(result.position).toBe(1); // 0 ahead + 1
      expect(result.estimatedWaitMinutes).toBe(0); // 0 * 15

      // Verify INSERT was called with priority=10, is_member=true
      const insertCall = mockPool.query.mock.calls[3];
      expect(insertCall[1]).toEqual(['outlet-1', 'order-2', 2, 10, true]);
    });

    it('should accept orders in confirmed status', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'order-3', order_number: 'ORD-003', status: 'confirmed', customer_id: 'c3', membership_id: null }],
      });

      mockPool.query.mockResolvedValueOnce({ rows: [] });
      mockPool.query.mockResolvedValueOnce({ rows: [{ next_position: '1' }] });
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'qe-3',
          order_id: 'order-3',
          position: 1,
          priority: 0,
          is_member: false,
          status: 'waiting',
          created_at: new Date('2024-07-01T11:00:00Z'),
        }],
      });
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

      const result = await service.joinQueue('order-3', 'outlet-1');

      expect(result.id).toBe('qe-3');
      expect(result.position).toBe(1);
    });

    it('should reject orders in cancelled status', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'order-4', order_number: 'ORD-004', status: 'cancelled', customer_id: 'c4', membership_id: null }],
      });

      await expect(service.joinQueue('order-4', 'outlet-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
