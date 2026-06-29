import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KioskController } from './kiosk.controller';
import { KioskService, KioskQueueStatus, KioskQueueEntry } from './kiosk.service';

describe('KioskController', () => {
  let controller: KioskController;
  let mockService: {
    getQueueStatus: ReturnType<typeof vi.fn>;
    joinQueue: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockService = {
      getQueueStatus: vi.fn(),
      joinQueue: vi.fn(),
    };
    controller = new KioskController(mockService as unknown as KioskService);
  });

  describe('GET /api/kiosk/queue-status', () => {
    it('should call service.getQueueStatus with the order number', async () => {
      const mockResult: KioskQueueStatus = {
        orderNumber: 'ORD-001',
        orderId: 'order-id-1',
        customerName: 'John',
        position: 2,
        totalWaiting: 5,
        estimatedWaitMinutes: 15,
        status: 'waiting',
      };

      mockService.getQueueStatus.mockResolvedValueOnce(mockResult);

      const result = await controller.getQueueStatus('ORD-001');

      expect(mockService.getQueueStatus).toHaveBeenCalledWith('ORD-001');
      expect(result).toEqual(mockResult);
    });

    it('should return not_found status when order is not in queue', async () => {
      const mockResult: KioskQueueStatus = {
        orderNumber: 'ORD-999',
        orderId: '',
        customerName: '',
        position: 0,
        totalWaiting: 0,
        estimatedWaitMinutes: 0,
        status: 'not_found',
      };

      mockService.getQueueStatus.mockResolvedValueOnce(mockResult);

      const result = await controller.getQueueStatus('ORD-999');

      expect(result.status).toBe('not_found');
    });

    it('should pass through service errors', async () => {
      mockService.getQueueStatus.mockRejectedValueOnce(
        new Error('Order number is required'),
      );

      await expect(controller.getQueueStatus('')).rejects.toThrow(
        'Order number is required',
      );
    });
  });

  describe('POST /api/kiosk/join-queue', () => {
    it('should call service.joinQueue with orderId and outletId', async () => {
      const mockResult: KioskQueueEntry = {
        id: 'qe-1',
        orderId: 'order-1',
        orderNumber: 'ORD-001',
        position: 3,
        priority: 0,
        isMember: false,
        estimatedWaitMinutes: 30,
        createdAt: '2024-07-01T10:00:00.000Z',
      };

      mockService.joinQueue.mockResolvedValueOnce(mockResult);

      const result = await controller.joinQueue({
        orderId: 'order-1',
        outletId: 'outlet-1',
      });

      expect(mockService.joinQueue).toHaveBeenCalledWith('order-1', 'outlet-1');
      expect(result).toEqual(mockResult);
    });

    it('should return queue entry with member priority', async () => {
      const mockResult: KioskQueueEntry = {
        id: 'qe-2',
        orderId: 'order-2',
        orderNumber: 'ORD-002',
        position: 1,
        priority: 10,
        isMember: true,
        estimatedWaitMinutes: 0,
        createdAt: '2024-07-01T10:05:00.000Z',
      };

      mockService.joinQueue.mockResolvedValueOnce(mockResult);

      const result = await controller.joinQueue({
        orderId: 'order-2',
        outletId: 'outlet-1',
      });

      expect(result.priority).toBe(10);
      expect(result.isMember).toBe(true);
    });

    it('should pass through service errors for invalid orders', async () => {
      mockService.joinQueue.mockRejectedValueOnce(
        new Error('Order must be paid before joining the queue'),
      );

      await expect(
        controller.joinQueue({ orderId: 'order-unpaid', outletId: 'outlet-1' }),
      ).rejects.toThrow('Order must be paid before joining the queue');
    });
  });
});
