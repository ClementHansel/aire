import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { CustomerController } from './customer.controller';
import { JWTPayload } from '@aire/shared';

function createMockService() {
  return {
    getProfile: vi.fn(),
    getAnalytics: vi.fn(),
    searchCustomers: vi.fn(),
    listCustomers: vi.fn(),
    updateCustomer: vi.fn(),
    deleteCustomer: vi.fn(),
  };
}

const USER: JWTPayload = {
  sub: 'user-001',
  tenant_id: 'tenant-001',
  outlet_id: null,
  role: 'tenant_owner',
  iat: 0,
  exp: 0,
};

describe('CustomerController', () => {
  let controller: CustomerController;
  let mockService: ReturnType<typeof createMockService>;
  const mockScope = { resolveOutletIds: vi.fn().mockResolvedValue(null) };

  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new CustomerController(mockService as any, mockScope as any);
  });

  describe('GET /api/customers (searchCustomers)', () => {
    it('should call service with the caller tenant + search term', async () => {
      mockService.searchCustomers.mockResolvedValue({
        customers: [{ id: 'cust-1', name: 'John' }],
        total: 1,
      });

      const result = await controller.searchCustomers(USER, 'John', '1', '20');

      // Tenant is always the first argument — the search is scoped to the caller.
      expect(mockService.searchCustomers).toHaveBeenCalledWith('tenant-001', 'John', 1, 20);
      expect(result.total).toBe(1);
    });

    it('should throw BadRequestException when search is missing', async () => {
      await expect(
        controller.searchCustomers(USER, undefined, '1', '20'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when search is empty', async () => {
      await expect(
        controller.searchCustomers(USER, '   ', '1', '20'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when page is invalid', async () => {
      await expect(
        controller.searchCustomers(USER, 'test', '-1', '20'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when pageSize is invalid', async () => {
      await expect(
        controller.searchCustomers(USER, 'test', '1', '0'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should default to page 1 and pageSize 20 when not provided', async () => {
      mockService.searchCustomers.mockResolvedValue({
        customers: [],
        total: 0,
      });

      await controller.searchCustomers(USER, 'test');

      expect(mockService.searchCustomers).toHaveBeenCalledWith('tenant-001', 'test', 1, 20);
    });
  });

  describe('GET /api/customers/:id/profile', () => {
    it('should call service with tenant + customer ID', async () => {
      const mockProfile = {
        id: 'cust-001',
        name: 'John Doe',
        totalVisits: 10,
      };
      mockService.getProfile.mockResolvedValue(mockProfile);

      const result = await controller.getProfile(USER, 'cust-001');

      expect(mockService.getProfile).toHaveBeenCalledWith('tenant-001', 'cust-001');
      expect(result).toEqual(mockProfile);
    });

    it('should throw BadRequestException for empty ID', async () => {
      await expect(controller.getProfile(USER, '')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('GET /api/customers/:id/analytics', () => {
    it('should call service with tenant + customer ID', async () => {
      const mockAnalytics = {
        customerId: 'cust-001',
        visitFrequency: { totalVisits: 20 },
      };
      mockService.getAnalytics.mockResolvedValue(mockAnalytics);

      const result = await controller.getAnalytics(USER, 'cust-001');

      expect(mockService.getAnalytics).toHaveBeenCalledWith('tenant-001', 'cust-001');
      expect(result).toEqual(mockAnalytics);
    });

    it('should throw BadRequestException for empty ID', async () => {
      await expect(controller.getAnalytics(USER, '')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
