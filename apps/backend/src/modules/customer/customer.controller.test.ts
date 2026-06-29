import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';

function createMockService() {
  return {
    getProfile: vi.fn(),
    getAnalytics: vi.fn(),
    searchCustomers: vi.fn(),
  };
}

describe('CustomerController', () => {
  let controller: CustomerController;
  let mockService: ReturnType<typeof createMockService>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new CustomerController(mockService as any);
  });

  describe('GET /api/customers (searchCustomers)', () => {
    it('should call service with search term', async () => {
      mockService.searchCustomers.mockResolvedValue({
        customers: [{ id: 'cust-1', name: 'John' }],
        total: 1,
      });

      const result = await controller.searchCustomers('John', '1', '20');

      expect(mockService.searchCustomers).toHaveBeenCalledWith('John', 1, 20);
      expect(result.total).toBe(1);
    });

    it('should throw BadRequestException when search is missing', async () => {
      await expect(
        controller.searchCustomers(undefined, '1', '20'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when search is empty', async () => {
      await expect(
        controller.searchCustomers('   ', '1', '20'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when page is invalid', async () => {
      await expect(
        controller.searchCustomers('test', '-1', '20'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when pageSize is invalid', async () => {
      await expect(
        controller.searchCustomers('test', '1', '0'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should default to page 1 and pageSize 20 when not provided', async () => {
      mockService.searchCustomers.mockResolvedValue({
        customers: [],
        total: 0,
      });

      await controller.searchCustomers('test');

      expect(mockService.searchCustomers).toHaveBeenCalledWith('test', 1, 20);
    });
  });

  describe('GET /api/customers/:id/profile', () => {
    it('should call service with customer ID', async () => {
      const mockProfile = {
        id: 'cust-001',
        name: 'John Doe',
        totalVisits: 10,
      };
      mockService.getProfile.mockResolvedValue(mockProfile);

      const result = await controller.getProfile('cust-001');

      expect(mockService.getProfile).toHaveBeenCalledWith('cust-001');
      expect(result).toEqual(mockProfile);
    });

    it('should throw BadRequestException for empty ID', async () => {
      await expect(controller.getProfile('')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('GET /api/customers/:id/analytics', () => {
    it('should call service with customer ID', async () => {
      const mockAnalytics = {
        customerId: 'cust-001',
        visitFrequency: { totalVisits: 20 },
      };
      mockService.getAnalytics.mockResolvedValue(mockAnalytics);

      const result = await controller.getAnalytics('cust-001');

      expect(mockService.getAnalytics).toHaveBeenCalledWith('cust-001');
      expect(result).toEqual(mockAnalytics);
    });

    it('should throw BadRequestException for empty ID', async () => {
      await expect(controller.getAnalytics('')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
