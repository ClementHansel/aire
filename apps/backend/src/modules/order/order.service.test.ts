import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  CreateOrderRequest,
  OrderStatus,
  JWTPayload,
  ERR_VALIDATION_FAILED,
} from '@aire/shared';
import { OrderService } from './order.service';

describe('OrderService', () => {
  let orderService: OrderService;
  let mockPool: {
    query: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
  };
  let mockClient: {
    query: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  };

  const mockUser: JWTPayload = {
    sub: 'operator-1',
    tenant_id: 'tenant-1',
    outlet_id: 'outlet-1',
    role: 'cashier',
    iat: 1000,
    exp: 2000,
  };

  const validRequest: CreateOrderRequest = {
    customer: {
      name: 'John Doe',
      phone: '081234567890',
      licensePlate: 'B1234ABC',
      brand: 'Toyota',
      model: 'Avanza',
    },
    items: [
      { serviceId: 'svc-1', quantity: 1 },
      { serviceId: 'svc-2', quantity: 2 },
    ],
    note: 'Test order',
  };

  const mockServices = [
    {
      id: 'svc-1',
      name: 'Premium Wash',
      category: 'car_wash',
      price: '50000.00',
      is_main_service: true,
      is_active: true,
    },
    {
      id: 'svc-2',
      name: 'Interior Clean',
      category: 'add_on',
      price: '25000.00',
      is_main_service: false,
      is_active: true,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };

    mockPool = {
      query: vi.fn(),
      connect: vi.fn().mockResolvedValue(mockClient),
    };

    orderService = new OrderService(mockPool as any);
  });

  describe('createOrder', () => {
    function setupSuccessfulOrderCreation() {
      // 1. lookupServices query
      mockPool.query.mockResolvedValueOnce({ rows: mockServices });

      // 2. getOutletConfig query
      mockPool.query.mockResolvedValueOnce({
        rows: [{ settings: { service_charge_pct: 0.05, tax_pct: 0.11 } }],
      });

      // 3. generateOrderNumber - count query
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '5' }] });

      // Transaction queries
      // BEGIN
      mockClient.query.mockResolvedValueOnce({});

      // INSERT order
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'order-123',
            tenant_id: 'tenant-1',
            outlet_id: 'outlet-1',
            operator_id: 'operator-1',
            customer_id: null,
            order_number: 'ORD-20250101-006',
            status: 'ordered',
            customer_name: 'John Doe',
            customer_phone: '081234567890',
            license_plate: 'B1234ABC',
            vehicle_brand: 'Toyota',
            vehicle_model: 'Avanza',
            subtotal: '100000.00',
            service_charge: '5000.00',
            tax: '11000.00',
            voucher_discount: '0.00',
            promo_discount: '0.00',
            total: '116000.00',
            payment_method: null,
            payment_reference: null,
            amount_received: null,
            change_amount: null,
            note: 'Test order',
            membership_id: null,
            created_at: new Date('2025-01-01T10:00:00Z'),
            updated_at: new Date('2025-01-01T10:00:00Z'),
          },
        ],
      });

      // INSERT order_items (2 items)
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'item-1' }],
      });
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'item-2' }],
      });

      // INSERT order_status_logs
      mockClient.query.mockResolvedValueOnce({});

      // COMMIT
      mockClient.query.mockResolvedValueOnce({});
    }

    it('should create an order successfully with valid input', async () => {
      setupSuccessfulOrderCreation();

      const result = await orderService.createOrder(validRequest, mockUser);

      expect(result.id).toBe('order-123');
      expect(result.orderNumber).toBe('ORD-20250101-006');
      expect(result.status).toBe(OrderStatus.Ordered);
      expect(result.customerName).toBe('John Doe');
      expect(result.customerPhone).toBe('081234567890');
      expect(result.licensePlate).toBe('B1234ABC');
      expect(result.items).toHaveLength(2);
      expect(result.note).toBe('Test order');
    });

    it('should calculate correct subtotal from service prices', async () => {
      setupSuccessfulOrderCreation();

      const result = await orderService.createOrder(validRequest, mockUser);

      // Item 1: 1 * 50000 = 50000
      // Item 2: 2 * 25000 = 50000
      // Subtotal: 100000
      expect(result.items[0]!.unitPrice).toBe(50000);
      expect(result.items[0]!.quantity).toBe(1);
      expect(result.items[1]!.unitPrice).toBe(25000);
      expect(result.items[1]!.quantity).toBe(2);
    });

    it('should throw BadRequestException when customer name is empty', async () => {
      // lookupServices
      mockPool.query.mockResolvedValueOnce({ rows: mockServices });

      const invalidRequest: CreateOrderRequest = {
        ...validRequest,
        customer: { ...validRequest.customer, name: '' },
      };

      await expect(
        orderService.createOrder(invalidRequest, mockUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when phone is too short', async () => {
      // lookupServices
      mockPool.query.mockResolvedValueOnce({ rows: mockServices });

      const invalidRequest: CreateOrderRequest = {
        ...validRequest,
        customer: { ...validRequest.customer, phone: '0812' },
      };

      await expect(
        orderService.createOrder(invalidRequest, mockUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when cart is empty', async () => {
      // lookupServices returns empty for empty items
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const invalidRequest: CreateOrderRequest = {
        ...validRequest,
        items: [],
      };

      await expect(
        orderService.createOrder(invalidRequest, mockUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when no main service in cart', async () => {
      // lookupServices - only add-on services, none are main
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'svc-2',
            name: 'Interior Clean',
            category: 'add_on',
            price: '25000.00',
            is_main_service: false,
            is_active: true,
          },
        ],
      });

      const invalidRequest: CreateOrderRequest = {
        ...validRequest,
        items: [{ serviceId: 'svc-2', quantity: 1 }],
      };

      await expect(
        orderService.createOrder(invalidRequest, mockUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('should apply membership pricing when membershipId is provided', async () => {
      // lookupServices
      mockPool.query.mockResolvedValueOnce({ rows: mockServices });

      // getMembershipPlates
      mockPool.query.mockResolvedValueOnce({
        rows: [{ plate_normalized: 'B1234ABC' }],
      });

      // getMembershipBenefits - membership lookup
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'mem-1',
            plan_id: 'plan-1',
            status: 'active',
            uses_count: 5,
            max_uses: 30,
            daily_limit: 1,
          },
        ],
      });

      // getMembershipBenefits - plan lookup
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'plan-1',
            name: 'Gold Plan',
            free_service_ids: ['svc-1'],
            discounted_services: [],
          },
        ],
      });

      // getOutletConfig
      mockPool.query.mockResolvedValueOnce({
        rows: [{ settings: { service_charge_pct: 0, tax_pct: 0 } }],
      });

      // generateOrderNumber
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

      // Transaction
      mockClient.query.mockResolvedValueOnce({}); // BEGIN
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'order-456',
            tenant_id: 'tenant-1',
            outlet_id: 'outlet-1',
            operator_id: 'operator-1',
            customer_id: null,
            order_number: 'ORD-20250101-001',
            status: 'ordered',
            customer_name: 'John Doe',
            customer_phone: '081234567890',
            license_plate: 'B1234ABC',
            vehicle_brand: 'Toyota',
            vehicle_model: 'Avanza',
            subtotal: '50000.00',
            service_charge: '0.00',
            tax: '0.00',
            voucher_discount: '0.00',
            promo_discount: '0.00',
            total: '50000.00',
            payment_method: null,
            payment_reference: null,
            amount_received: null,
            change_amount: null,
            note: null,
            membership_id: 'mem-1',
            created_at: new Date('2025-01-01T10:00:00Z'),
            updated_at: new Date('2025-01-01T10:00:00Z'),
          },
        ],
      });
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'item-1' }] });
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'item-2' }] });
      mockClient.query.mockResolvedValueOnce({}); // status log
      mockClient.query.mockResolvedValueOnce({}); // COMMIT

      const requestWithMembership: CreateOrderRequest = {
        ...validRequest,
        membershipId: 'mem-1',
        selectedPlate: 'B1234ABC',
      };

      const result = await orderService.createOrder(
        requestWithMembership,
        mockUser,
      );

      expect(result.id).toBe('order-456');
      expect(result.membershipId).toBe('mem-1');
      // The first item (svc-1) should have member pricing applied
      expect(result.items[0]!.isMemberPricing).toBe(true);
    });

    it('should assign "regular" tag when no membership or voucher', async () => {
      setupSuccessfulOrderCreation();

      const result = await orderService.createOrder(validRequest, mockUser);

      expect(result.tags).toContain('regular');
    });

    it('should assign "member" tag when membership benefits are applied', async () => {
      // Same setup as membership test above
      mockPool.query.mockResolvedValueOnce({ rows: mockServices });
      mockPool.query.mockResolvedValueOnce({
        rows: [{ plate_normalized: 'B1234ABC' }],
      });
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'mem-1',
            plan_id: 'plan-1',
            status: 'active',
            uses_count: 5,
            max_uses: 30,
            daily_limit: 1,
          },
        ],
      });
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'plan-1',
            name: 'Gold Plan',
            free_service_ids: ['svc-1'],
            discounted_services: [],
          },
        ],
      });
      mockPool.query.mockResolvedValueOnce({
        rows: [{ settings: { service_charge_pct: 0, tax_pct: 0 } }],
      });
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

      mockClient.query.mockResolvedValueOnce({}); // BEGIN
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'order-789',
            tenant_id: 'tenant-1',
            outlet_id: 'outlet-1',
            operator_id: 'operator-1',
            customer_id: null,
            order_number: 'ORD-20250101-001',
            status: 'ordered',
            customer_name: 'John Doe',
            customer_phone: '081234567890',
            license_plate: 'B1234ABC',
            vehicle_brand: 'Toyota',
            vehicle_model: 'Avanza',
            subtotal: '50000.00',
            service_charge: '0.00',
            tax: '0.00',
            voucher_discount: '0.00',
            promo_discount: '0.00',
            total: '50000.00',
            payment_method: null,
            payment_reference: null,
            amount_received: null,
            change_amount: null,
            note: null,
            membership_id: 'mem-1',
            created_at: new Date('2025-01-01T10:00:00Z'),
            updated_at: new Date('2025-01-01T10:00:00Z'),
          },
        ],
      });
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'item-1' }] });
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'item-2' }] });
      mockClient.query.mockResolvedValueOnce({}); // status log
      mockClient.query.mockResolvedValueOnce({}); // COMMIT

      const requestWithMembership: CreateOrderRequest = {
        ...validRequest,
        membershipId: 'mem-1',
        selectedPlate: 'B1234ABC',
      };

      const result = await orderService.createOrder(
        requestWithMembership,
        mockUser,
      );

      expect(result.tags).toContain('member');
      expect(result.tags).not.toContain('regular');
    });

    it('should rollback transaction on error', async () => {
      // lookupServices
      mockPool.query.mockResolvedValueOnce({ rows: mockServices });
      // getOutletConfig
      mockPool.query.mockResolvedValueOnce({
        rows: [{ settings: { service_charge_pct: 0, tax_pct: 0 } }],
      });
      // generateOrderNumber
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

      // Transaction
      mockClient.query.mockResolvedValueOnce({}); // BEGIN
      mockClient.query.mockRejectedValueOnce(new Error('DB error')); // INSERT order fails
      mockClient.query.mockResolvedValueOnce({}); // ROLLBACK

      await expect(
        orderService.createOrder(validRequest, mockUser),
      ).rejects.toThrow('DB error');

      // Verify ROLLBACK was called
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should generate sequential order numbers per day', async () => {
      setupSuccessfulOrderCreation();

      const result = await orderService.createOrder(validRequest, mockUser);

      // Count was 5, so next order number should be 006
      expect(result.orderNumber).toContain('-006');
    });

    it('should validate plate selection for multi-plate members', async () => {
      // lookupServices
      mockPool.query.mockResolvedValueOnce({ rows: mockServices });

      // getMembershipPlates - returns multiple plates
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { plate_normalized: 'B1234ABC' },
          { plate_normalized: 'B5678DEF' },
        ],
      });

      const requestWithMembership: CreateOrderRequest = {
        ...validRequest,
        membershipId: 'mem-1',
        // No selectedPlate provided
      };

      await expect(
        orderService.createOrder(requestWithMembership, mockUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('should use default outlet config when outlet has no settings', async () => {
      // lookupServices
      mockPool.query.mockResolvedValueOnce({ rows: mockServices });
      // getOutletConfig - no settings
      mockPool.query.mockResolvedValueOnce({ rows: [{ settings: {} }] });
      // generateOrderNumber
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

      // Transaction
      mockClient.query.mockResolvedValueOnce({}); // BEGIN
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'order-000',
            tenant_id: 'tenant-1',
            outlet_id: 'outlet-1',
            operator_id: 'operator-1',
            customer_id: null,
            order_number: 'ORD-20250101-001',
            status: 'ordered',
            customer_name: 'John Doe',
            customer_phone: '081234567890',
            license_plate: 'B1234ABC',
            vehicle_brand: 'Toyota',
            vehicle_model: 'Avanza',
            subtotal: '100000.00',
            service_charge: '0.00',
            tax: '0.00',
            voucher_discount: '0.00',
            promo_discount: '0.00',
            total: '100000.00',
            payment_method: null,
            payment_reference: null,
            amount_received: null,
            change_amount: null,
            note: 'Test order',
            membership_id: null,
            created_at: new Date('2025-01-01T10:00:00Z'),
            updated_at: new Date('2025-01-01T10:00:00Z'),
          },
        ],
      });
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'item-1' }] });
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'item-2' }] });
      mockClient.query.mockResolvedValueOnce({}); // status log
      mockClient.query.mockResolvedValueOnce({}); // COMMIT

      const result = await orderService.createOrder(validRequest, mockUser);

      // With no service charge and tax configured, total = subtotal
      expect(result.serviceCharge).toBe(0);
      expect(result.tax).toBe(0);
    });
  });
});
