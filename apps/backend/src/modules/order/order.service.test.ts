import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import {
  CreateOrderRequest,
  OrderStatus,
  JWTPayload,
  ERR_VALIDATION_FAILED,
  ERR_VOID_PIN_REQUIRED,
  ERR_VOID_PIN_INVALID,
} from '@aire/shared';
import { OrderService } from './order.service';
import { NotificationService } from '../notification/notification.service';

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

  // The order INSERT row returned by the transaction, set per-test. The client
  // mock routes by SQL (not call order) so it stays robust as the transaction body
  // grows (COGS recipe lookups, queue linking, settlement, etc.).
  let currentOrderRow: Record<string, unknown> | null;
  let failOrderInsert: boolean;

  beforeEach(() => {
    vi.clearAllMocks();
    currentOrderRow = null;
    failOrderInsert = false;
    let itemSeq = 0;

    mockClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        const s = String(sql);
        if (s.includes('INSERT INTO orders')) {
          if (failOrderInsert) return Promise.reject(new Error('DB error'));
          return Promise.resolve({ rows: [currentOrderRow], rowCount: 1 });
        }
        if (s.includes('INSERT INTO order_items')) {
          return Promise.resolve({ rows: [{ id: `item-${++itemSeq}` }], rowCount: 1 });
        }
        // Any other RETURNING insert (membership_usages, settlement, vouchers…).
        if (/RETURNING/i.test(s)) return Promise.resolve({ rows: [{ id: 'gen-id', pack_id: 'pack-1' }], rowCount: 1 });
        // BEGIN/COMMIT/ROLLBACK, recipe-component SELECTs, status logs, updates…
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
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

      // promotions (none)
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      // 3. generateOrderNumber - count query
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '5' }] });

      // Transaction: the client mock routes by SQL; just declare the order row.
      currentOrderRow = {
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
      };
    }

    it('should create an order successfully with valid input', async () => {
      setupSuccessfulOrderCreation();

      const result = await orderService.createOrder(validRequest, mockUser, { shift: { id: 'shift-1', outletId: 'outlet-1' } });

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

      const result = await orderService.createOrder(validRequest, mockUser, { shift: { id: 'shift-1', outletId: 'outlet-1' } });

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

      // getMembershipBenefits - today's usages (quota gate); none today
      mockPool.query.mockResolvedValueOnce({ rows: [] });

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

      // promotions (none)
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      // generateOrderNumber
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

      // Transaction: client mock routes by SQL; just declare the order row.
      currentOrderRow = {
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
      };

      const requestWithMembership: CreateOrderRequest = {
        ...validRequest,
        membershipId: 'mem-1',
        selectedPlate: 'B1234ABC',
      };

      const result = await orderService.createOrder(
        requestWithMembership,
        mockUser,
        { shift: { id: 'shift-1', outletId: 'outlet-1' } },
      );

      expect(result.id).toBe('order-456');
      expect(result.membershipId).toBe('mem-1');
      // The first item (svc-1) should have member pricing applied
      expect(result.items[0]!.isMemberPricing).toBe(true);
    });

    it('should assign "regular" tag when no membership or voucher', async () => {
      setupSuccessfulOrderCreation();

      const result = await orderService.createOrder(validRequest, mockUser, { shift: { id: 'shift-1', outletId: 'outlet-1' } });

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
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // today's usages (quota gate)
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
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // promotions
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

      currentOrderRow = {
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
      };

      const requestWithMembership: CreateOrderRequest = {
        ...validRequest,
        membershipId: 'mem-1',
        selectedPlate: 'B1234ABC',
      };

      const result = await orderService.createOrder(
        requestWithMembership,
        mockUser,
        { shift: { id: 'shift-1', outletId: 'outlet-1' } },
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
      // promotions (none)
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      // generateOrderNumber
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

      // Transaction
      mockClient.query.mockResolvedValueOnce({}); // BEGIN
      mockClient.query.mockRejectedValueOnce(new Error('DB error')); // INSERT order fails
      mockClient.query.mockResolvedValueOnce({}); // ROLLBACK

      await expect(
        orderService.createOrder(validRequest, mockUser, { shift: { id: 'shift-1', outletId: 'outlet-1' } }),
      ).rejects.toThrow('DB error');

      // Verify ROLLBACK was called
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should generate sequential order numbers per day', async () => {
      setupSuccessfulOrderCreation();

      const result = await orderService.createOrder(validRequest, mockUser, { shift: { id: 'shift-1', outletId: 'outlet-1' } });

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
      // promotions (none)
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      // generateOrderNumber
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

      // Transaction: client mock routes by SQL; just declare the order row.
      currentOrderRow = {
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
      };

      const result = await orderService.createOrder(validRequest, mockUser, { shift: { id: 'shift-1', outletId: 'outlet-1' } });

      // With no service charge and tax configured, total = subtotal
      expect(result.serviceCharge).toBe(0);
      expect(result.tax).toBe(0);
    });
  });
});

describe('OrderService.payOrder — consumption at payment & golden rule', () => {
  const user: JWTPayload = {
    sub: 'op-1', tenant_id: 'tenant-1', outlet_id: 'outlet-1', role: 'cashier', iat: 1, exp: 2,
  };

  // Build a pool/client pair that returns a paid membership order and records the
  // SQL the transaction runs, so we can assert what happened at payment.
  function setup(opts: { voucherDiscount: string; isMemberPricing: boolean; membershipId: string | null }) {
    const clientSql: string[] = [];
    const orderRow = {
      id: 'order-1', tenant_id: 'tenant-1', outlet_id: 'outlet-1', order_number: 'ORD-1',
      status: 'ordered', customer_name: 'John', customer_phone: '0812', license_plate: 'B1ABC',
      vehicle_brand: null, vehicle_model: null, subtotal: '50000', service_charge: '0', tax: '0',
      voucher_discount: opts.voucherDiscount, promo_discount: '0', total: '50000', note: null,
      membership_id: opts.membershipId, business_unit: 'aire', created_at: new Date('2025-01-01'),
    };
    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        const s = String(sql);
        clientSql.push(s);
        if (s.includes('UPDATE orders')) return Promise.resolve({ rows: [{ ...orderRow, status: 'paid' }] });
        if (s.includes('FROM order_items')) {
          return Promise.resolve({ rows: [{ id: 'oi-1', service_id: 'svc-1', service_name: 'Wash', quantity: 1, unit_price: '50000', discount: '0', subtotal: '50000', is_member_pricing: opts.isMemberPricing }] });
        }
        if (s.includes('FROM memberships m JOIN membership_plans')) {
          return Promise.resolve({ rows: [{ home_outlet_id: 'outlet-1', settlement_amount: null }] });
        }
        if (/RETURNING/i.test(s)) return Promise.resolve({ rows: [{ id: 'gen' }] });
        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn().mockImplementation((sql: string) => {
        const s = String(sql);
        if (s.includes('FROM orders')) return Promise.resolve({ rows: [orderRow] });
        if (s.includes('FROM pos_shifts')) return Promise.resolve({ rows: [{ id: 'shift-1' }] });
        return Promise.resolve({ rows: [] });
      }),
      connect: vi.fn().mockResolvedValue(client),
    };
    return { pool, client, clientSql };
  }

  it('records membership usage + increments uses_count when member pricing applied and no voucher', async () => {
    const { pool, clientSql } = setup({ voucherDiscount: '0', isMemberPricing: true, membershipId: 'mem-1' });
    const svc = new OrderService(pool as never);
    const res = await svc.payOrder('order-1', user, { method: 'cash', amountReceived: 50000 });

    expect(clientSql.some((s) => s.includes('INSERT INTO membership_usages'))).toBe(true);
    expect(clientSql.some((s) => s.includes('UPDATE memberships') && s.includes('uses_count'))).toBe(true);
    expect(clientSql.some((s) => s.includes('INSERT INTO order_tags'))).toBe(true);
    expect(res.tags).toContain('member');
  });

  it('does NOT consume membership when a voucher is applied (golden rule)', async () => {
    const { pool, clientSql } = setup({ voucherDiscount: '10000', isMemberPricing: true, membershipId: 'mem-1' });
    const svc = new OrderService(pool as never);
    const res = await svc.payOrder('order-1', user, { method: 'cash', amountReceived: 50000 });

    expect(clientSql.some((s) => s.includes('INSERT INTO membership_usages'))).toBe(false);
    expect(res.tags).toContain('voucher');
    expect(res.tags).not.toContain('member');
  });

  it('tags a plain order "regular" and consumes nothing', async () => {
    const { pool, clientSql } = setup({ voucherDiscount: '0', isMemberPricing: false, membershipId: null });
    const svc = new OrderService(pool as never);
    const res = await svc.payOrder('order-1', user, { method: 'cash', amountReceived: 50000 });

    expect(clientSql.some((s) => s.includes('INSERT INTO membership_usages'))).toBe(false);
    expect(res.tags).toContain('regular');
  });
});

describe('OrderService — one-time emailed void PIN (requestVoidPin / voidOrder)', () => {
  const cashier: JWTPayload = {
    sub: 'operator-1', tenant_id: 'tenant-1', outlet_id: 'outlet-1', role: 'cashier', iat: 1, exp: 2,
  };
  const owner: JWTPayload = {
    sub: 'owner-1', tenant_id: 'tenant-1', outlet_id: 'outlet-1', role: 'tenant_owner', iat: 1, exp: 2,
  };

  // An order created well outside any free-void window (default 0 min).
  const orderRow = {
    id: 'order-1',
    status: 'paid',
    total: '100000.00',
    order_number: 'ORD-1',
    created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    shift_status: 'open',
    outlet_settings: { free_void_window_minutes: 0 },
  };

  describe('requestVoidPin', () => {
    function setup(opts: { ownerEmail?: string | null } = {}) {
      const sentEmails: { to: string; subject: string; body: string }[] = [];
      const poolSql: string[] = [];
      const pool = {
        query: vi.fn().mockImplementation((sql: string) => {
          const s = String(sql);
          poolSql.push(s);
          if (s.includes('FROM orders WHERE id')) {
            return Promise.resolve({ rows: [{ id: 'order-1', outlet_id: 'outlet-1', order_number: 'ORD-1' }] });
          }
          if (s.includes("role = 'tenant_owner'")) {
            return Promise.resolve({ rows: opts.ownerEmail === null ? [] : [{ email: opts.ownerEmail ?? 'owner@tenant.com' }] });
          }
          return Promise.resolve({ rows: [], rowCount: 0 });
        }),
        connect: vi.fn(),
      };
      const notification = { sendEmail: vi.fn().mockImplementation(async (msg: any) => { sentEmails.push(msg); return { success: true, messageId: 'msg-1' }; }) };
      const svc = new OrderService(pool as never, undefined, notification as unknown as NotificationService);
      return { svc, pool, poolSql, sentEmails, notification };
    }

    it('generates a PIN, invalidates prior unconsumed PINs, and emails the owner', async () => {
      const { svc, poolSql, sentEmails } = setup();

      const res = await svc.requestVoidPin('order-1', cashier);

      expect(res).toEqual({ sent: true, expiresInMinutes: 10 });
      expect(poolSql.some((s) => s.includes('UPDATE void_pin_requests SET consumed_at = NOW()') && s.includes('consumed_at IS NULL'))).toBe(true);
      expect(poolSql.some((s) => s.includes('INSERT INTO void_pin_requests'))).toBe(true);
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0]!.to).toBe('owner@tenant.com');
      expect(sentEmails[0]!.body).toMatch(/\d{6}/); // the plaintext PIN appears in the email body
      expect(sentEmails[0]!.subject).toContain('ORD-1');
    });

    it('throws when the order is not found (tenant-scoped lookup)', async () => {
      const pool = { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn() };
      const svc = new OrderService(pool as never);

      await expect(svc.requestVoidPin('missing-order', cashier)).rejects.toThrow(BadRequestException);
    });

    it('throws when no active tenant owner with an email exists', async () => {
      const { svc } = setup({ ownerEmail: null });

      await expect(svc.requestVoidPin('order-1', cashier)).rejects.toThrow(BadRequestException);
    });
  });

  describe('voidOrder — PIN verification', () => {
    // Builds a pool/client pair. `pinRow` simulates the latest live
    // void_pin_requests row (null = none live, e.g. none requested / already
    // consumed / expired).
    function setup(pinPlaintext: string | null, pinRow: { id: string } | null) {
      const clientSql: string[] = [];
      const client = {
        query: vi.fn().mockImplementation((sql: string) => {
          clientSql.push(String(sql));
          return Promise.resolve({ rows: [], rowCount: 0 });
        }),
        release: vi.fn(),
      };
      const pool = {
        query: vi.fn().mockImplementation((sql: string) => {
          const s = String(sql);
          if (s.includes('FROM orders o')) return Promise.resolve({ rows: [orderRow] });
          if (s.includes('FROM void_pin_requests')) {
            if (!pinRow) return Promise.resolve({ rows: [] });
            return Promise.resolve({ rows: [{ id: pinRow.id, pin_hash: bcrypt.hashSync(pinPlaintext!, 10) }] });
          }
          return Promise.resolve({ rows: [], rowCount: 0 });
        }),
        connect: vi.fn().mockResolvedValue(client),
      };
      return { pool, client, clientSql };
    }

    it('owner bypasses the PIN requirement even past the free-void window', async () => {
      const { pool } = setup(null, null);
      const svc = new OrderService(pool as never);

      const res = await svc.voidOrder('order-1', owner, { reason: 'owner override' });
      expect(res.id).toBe('order-1');
    });

    it('cashier past the free window without a PIN is asked for one (requiresPin)', async () => {
      const { pool } = setup(null, null);
      const svc = new OrderService(pool as never);

      try {
        await svc.voidOrder('order-1', cashier, { reason: 'test' });
        expect.fail('expected BadRequestException');
      } catch (e: any) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect(e.getResponse()).toMatchObject({ code: ERR_VOID_PIN_REQUIRED, requiresPin: true });
      }
    });

    it('rejects an incorrect PIN', async () => {
      const { pool } = setup('123456', { id: 'pin-1' }); // live PIN is 123456
      const svc = new OrderService(pool as never);

      try {
        await svc.voidOrder('order-1', cashier, { reason: 'test', adminPin: '000000' });
        expect.fail('expected BadRequestException');
      } catch (e: any) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect(e.getResponse()).toMatchObject({ code: ERR_VOID_PIN_INVALID, requiresPin: true });
      }
    });

    it('rejects a PIN when none is live (already consumed or expired) — single-use enforced', async () => {
      const { pool } = setup(null, null); // no live row: simulates a consumed/expired PIN
      const svc = new OrderService(pool as never);

      try {
        await svc.voidOrder('order-1', cashier, { reason: 'test', adminPin: '123456' });
        expect.fail('expected BadRequestException');
      } catch (e: any) {
        expect(e.getResponse()).toMatchObject({ code: ERR_VOID_PIN_INVALID, requiresPin: true });
      }
    });

    it('accepts a correct, live PIN and consumes it (single-use) in the same transaction', async () => {
      const { pool, client, clientSql } = setup('123456', { id: 'pin-1' });
      const svc = new OrderService(pool as never);

      const res = await svc.voidOrder('order-1', cashier, { reason: 'test', adminPin: '123456' });

      expect(res.id).toBe('order-1');
      expect(clientSql.some((s) => s.includes('UPDATE void_pin_requests SET consumed_at = NOW() WHERE id = $1'))).toBe(true);
      expect(client.query).toHaveBeenCalledWith(
        'UPDATE void_pin_requests SET consumed_at = NOW() WHERE id = $1',
        ['pin-1'],
      );
    });
  });
});
