import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { OrderController } from './order.controller';
import { OrderListService } from './order-list.service';
import { JWTPayload, OrderListResponse, OrderStatus, Role } from '@aire/shared';

describe('OrderController', () => {
  let controller: OrderController;
  let mockOrderListService: { listOrders: ReturnType<typeof vi.fn> };

  const mockCashierUser: JWTPayload = {
    sub: 'user-001',
    tenant_id: 'tenant-001',
    outlet_id: 'outlet-001',
    role: 'cashier',
    iat: Date.now(),
    exp: Date.now() + 3600,
  };

  const mockTenantOwnerUser: JWTPayload = {
    sub: 'user-002',
    tenant_id: 'tenant-001',
    outlet_id: null,
    role: 'tenant_owner',
    iat: Date.now(),
    exp: Date.now() + 3600,
  };

  const mockResponse: OrderListResponse = {
    orders: [],
    total: 0,
    page: 1,
    pageSize: 20,
    hasMore: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockOrderListService = { listOrders: vi.fn().mockResolvedValue(mockResponse) };
    controller = new OrderController(mockOrderListService as any);
  });

  describe('listOrders', () => {
    it('should call service with parsed params', async () => {
      await controller.listOrders(mockCashierUser, 'paid', undefined, undefined, undefined, undefined, undefined, undefined);

      expect(mockOrderListService.listOrders).toHaveBeenCalledWith({
        status: 'paid',
        search: undefined,
        dateFrom: undefined,
        dateTo: undefined,
        outletId: undefined, // Cashier cannot use outletId filter
        page: undefined,
        pageSize: undefined,
      });
    });

    it('should allow Tenant_Owner to filter by outletId', async () => {
      await controller.listOrders(mockTenantOwnerUser, undefined, undefined, undefined, undefined, 'outlet-002', undefined, undefined);

      expect(mockOrderListService.listOrders).toHaveBeenCalledWith(
        expect.objectContaining({ outletId: 'outlet-002' }),
      );
    });

    it('should ignore outletId filter for Cashier role', async () => {
      await controller.listOrders(mockCashierUser, undefined, undefined, undefined, undefined, 'outlet-002', undefined, undefined);

      expect(mockOrderListService.listOrders).toHaveBeenCalledWith(
        expect.objectContaining({ outletId: undefined }),
      );
    });

    it('should ignore outletId filter for Outlet_Admin role', async () => {
      const outletAdmin: JWTPayload = {
        ...mockCashierUser,
        role: 'outlet_admin',
      };
      await controller.listOrders(outletAdmin, undefined, undefined, undefined, undefined, 'outlet-002', undefined, undefined);

      expect(mockOrderListService.listOrders).toHaveBeenCalledWith(
        expect.objectContaining({ outletId: undefined }),
      );
    });

    it('should throw BadRequestException for invalid status', async () => {
      await expect(
        controller.listOrders(mockCashierUser, 'invalid_status', undefined, undefined, undefined, undefined, undefined, undefined),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid dateFrom', async () => {
      await expect(
        controller.listOrders(mockCashierUser, undefined, undefined, 'not-a-date', undefined, undefined, undefined, undefined),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid dateTo', async () => {
      await expect(
        controller.listOrders(mockCashierUser, undefined, undefined, undefined, 'not-a-date', undefined, undefined, undefined),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid page', async () => {
      await expect(
        controller.listOrders(mockCashierUser, undefined, undefined, undefined, undefined, undefined, '0', undefined),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid pageSize', async () => {
      await expect(
        controller.listOrders(mockCashierUser, undefined, undefined, undefined, undefined, undefined, undefined, '-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should parse page and pageSize as integers', async () => {
      await controller.listOrders(mockCashierUser, undefined, undefined, undefined, undefined, undefined, '3', '15');

      expect(mockOrderListService.listOrders).toHaveBeenCalledWith(
        expect.objectContaining({ page: 3, pageSize: 15 }),
      );
    });

    it('should pass search query through', async () => {
      await controller.listOrders(mockCashierUser, undefined, 'John', undefined, undefined, undefined, undefined, undefined);

      expect(mockOrderListService.listOrders).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'John' }),
      );
    });

    it('should pass valid date range through', async () => {
      await controller.listOrders(
        mockCashierUser,
        undefined,
        undefined,
        '2024-01-15',
        '2024-01-16',
        undefined,
        undefined,
        undefined,
      );

      expect(mockOrderListService.listOrders).toHaveBeenCalledWith(
        expect.objectContaining({
          dateFrom: '2024-01-15',
          dateTo: '2024-01-16',
        }),
      );
    });
  });
});
