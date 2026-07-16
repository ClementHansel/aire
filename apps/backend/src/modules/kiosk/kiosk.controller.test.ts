import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KioskController } from './kiosk.controller';
import { KioskService, KioskQueueStatus } from './kiosk.service';

describe('KioskController', () => {
  let controller: KioskController;
  let mockService: {
    getQueueStatus: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockService = {
      getQueueStatus: vi.fn(),
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

});
