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

    /**
     * AIRIN-112: POS checkout never created a customer row, so walk-ins never
     * reached CRM and every visit/spend metric (which joins orders on
     * customer_id) read zero. AIRIN-117: the plate was stored exactly as typed,
     * so "B 8882 CST" and "B8882CST" were two different cars.
     */
    describe('customer linkage + plate normalization', () => {
      /** The arguments the order INSERT was called with. */
      const orderInsert = () => {
        const call = mockClient.query.mock.calls.find(
          ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO orders'),
        );
        expect(call, 'order INSERT was never issued').toBeDefined();
        return { sql: call![0] as string, params: call![1] as unknown[] };
      };

      const customerUpserts = () =>
        mockClient.query.mock.calls.filter(
          ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO customers'),
        );

      it('upserts a customer and links it on the order', async () => {
        setupSuccessfulOrderCreation();

        await orderService.createOrder(validRequest, mockUser, { shift: { id: 'shift-1', outletId: 'outlet-1' } });

        const upserts = customerUpserts();
        expect(upserts).toHaveLength(1);
        // Keyed on normalized phone so repeat visits reuse one customer.
        expect(upserts[0]![0]).toContain('ON CONFLICT (tenant_id, phone_normalized)');

        const { sql, params } = orderInsert();
        expect(sql).toContain('customer_id');
        // upsertCustomerRow returns the mock router's generated id.
        expect(params).toContain('gen-id');
      });

      it('does NOT upsert a customer for a blank or sentinel phone', async () => {
        // Phone is the upsert key. Walk-in sentinels ('', '0000', short junk from
        // older flows and e2e fixtures) all normalize to the same value, so
        // upserting them would merge every anonymous customer into ONE CRM record
        // with a fabricated visit history. Verified against the real dataset: the
        // migration's matching guard leaves such rows unlinked rather than
        // minting a bogus "Walk-in" customer.
        for (const phone of ['   ', '0000', '0812']) {
          vi.clearAllMocks();
          setupSuccessfulOrderCreation();

          await orderService
            .createOrder(
              { ...validRequest, customer: { ...validRequest.customer, phone } },
              mockUser,
              { shift: { id: 'shift-1', outletId: 'outlet-1' } },
            )
            .catch(() => { /* validation may reject it earlier; the assertion is the point */ });

          expect(customerUpserts(), `phone ${JSON.stringify(phone)} must not upsert`).toHaveLength(0);
        }
      });

      it('stores both the as-typed plate and a normalized form', async () => {
        setupSuccessfulOrderCreation();

        await orderService.createOrder(
          { ...validRequest, customer: { ...validRequest.customer, licensePlate: 'b 8882 cst' } },
          mockUser,
          { shift: { id: 'shift-1', outletId: 'outlet-1' } },
        );

        const { sql, params } = orderInsert();
        expect(sql).toContain('plate_normalized');
        // As typed — the receipt shows what the cashier entered.
        expect(params).toContain('b 8882 cst');
        // Canonical — what search and matching use.
        expect(params).toContain('B8882CST');
      });

      it('leaves plate_normalized null when no plate was given', async () => {
        setupSuccessfulOrderCreation();

        await orderService.createOrder(
          { ...validRequest, customer: { ...validRequest.customer, licensePlate: undefined }, selectedPlate: undefined },
          mockUser,
          { shift: { id: 'shift-1', outletId: 'outlet-1' } },
        );

        const { sql } = orderInsert();
        expect(sql).toContain('plate_normalized');
        // Both plate columns null rather than '' — '' would be a distinct,
        // meaningless plate value that an ILIKE search could match.
        const { params } = orderInsert();
        const plateIdx = 7; // license_plate is the 8th bound parameter
        expect(params[plateIdx]).toBeNull();
        expect(params[plateIdx + 1]).toBeNull();
      });
    });

    /**
     * Samuel 2026-07-30: selling a membership plan on the SAME order as a wash
     * (the counter upsell that replaced the separate Sell Pack page) must make
     * that day's wash free, keep add-ons charged, and still record the plan sale.
     */
    describe('membership plan sold on the order (counter upsell)', () => {
      const plan = {
        id: 'plan-1', name: 'Membership Bulanan', price: '300000.00',
        duration_months: 1, max_uses: 8, daily_limit: 1, max_plates: 2,
      };

      const setupUpsell = () => {
        mockPool.query.mockResolvedValueOnce({ rows: mockServices });      // lookupServices
        mockPool.query.mockResolvedValueOnce({ rows: [plan] });            // resolvePackLines
        mockPool.query.mockResolvedValueOnce({ rows: [{ settings: { service_charge_pct: 0, tax_pct: 0 } }] });
        mockPool.query.mockResolvedValueOnce({ rows: [] });                // promotions
        mockPool.query.mockResolvedValueOnce({ rows: [{ count: '1' }] });  // order number
        currentOrderRow = {
          id: 'order-123', order_number: 'ORD-1', status: 'ordered',
          customer_name: 'John Doe', customer_phone: '081234567890',
          license_plate: 'B1234ABC', vehicle_brand: null, vehicle_model: null,
          subtotal: '350000.00', service_charge: '0.00', tax: '0.00',
          voucher_discount: '0.00', promo_discount: '0.00', total: '350000.00',
          note: null, membership_id: null, created_at: new Date(),
        };
      };

      const itemInserts = () =>
        mockClient.query.mock.calls
          .filter(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO order_items'))
          .map(([sql, params]) => ({ sql: String(sql), params: params as unknown[] }));

      it('frees the wash, keeps the add-on charged, and adds a plan line', async () => {
        setupUpsell();

        await orderService.createOrder(
          { ...validRequest, items: [{ serviceId: 'svc-1', quantity: 1 }, { serviceId: 'svc-2', quantity: 1 }], membershipPlanId: 'plan-1' },
          mockUser,
          { shift: { id: 'shift-1', outletId: 'outlet-1' } },
        );

        const inserts = itemInserts();
        // (order_id, service_id, item_name, quantity, unit_price, discount, subtotal, is_member_pricing, …)
        const wash = inserts.find((i) => i.params[1] === 'svc-1')!;
        expect(wash.params[5]).toBe(50000); // discounted by its full price
        expect(wash.params[6]).toBe(0);     // …so the line is free
        expect(wash.params[7]).toBe(true);  // member pricing → payment consumes one usage

        // The add-on is not "cuci reguler" and stays payable.
        const addOn = inserts.find((i) => i.params[1] === 'svc-2')!;
        expect(addOn.params[5]).toBe(0);
        expect(addOn.params[6]).toBe(25000);

        // The plan itself is a real line, so it shows on the receipt and in the
        // per-product report instead of hiding in a second order.
        const planLine = inserts.find((i) => i.params[1] === 'membership_plan' || i.params.includes('plan-1'))!;
        expect(planLine).toBeDefined();
        expect(planLine.params).toContain('Membership Bulanan');
      });

      it('creates the membership pending and points the order at it', async () => {
        setupUpsell();

        await orderService.createOrder(
          { ...validRequest, items: [{ serviceId: 'svc-1', quantity: 1 }], membershipPlanId: 'plan-1' },
          mockUser,
          { shift: { id: 'shift-1', outletId: 'outlet-1' } },
        );

        const sqls = mockClient.query.mock.calls.map(([s]) => String(s));
        const memInsert = sqls.find((s) => s.includes('INSERT INTO memberships'));
        expect(memInsert).toBeDefined();
        expect(memInsert).toContain("'pending'");
        // The order must carry the new membership, otherwise payment has nothing
        // to consume the free wash against.
        expect(sqls.some((s) => s.includes('UPDATE orders SET membership_id'))).toBe(true);
      });

      it('rejects a plan that is not sellable', async () => {
        mockPool.query.mockResolvedValueOnce({ rows: mockServices });
        mockPool.query.mockResolvedValueOnce({ rows: [] }); // inactive / other tenant

        await expect(
          orderService.createOrder(
            { ...validRequest, membershipPlanId: 'plan-gone' },
            mockUser,
            { shift: { id: 'shift-1', outletId: 'outlet-1' } },
          ),
        ).rejects.toThrow(BadRequestException);
      });
    });

    /**
     * AIRIN-121: a manual discount is a per-item permission from the dashboard.
     * The POS hides the field for items that never opted in, but the server is
     * the authority — a hand-rolled request must not be able to discount an
     * item the tenant never enabled.
     */
    describe('per-item manual discount gate', () => {
      const orderItemInserts = () =>
        mockClient.query.mock.calls
          .filter(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO order_items'))
          .map(([, params]) => params as unknown[]);

      /** order_items params: (order_id, service_id, item_name, quantity, unit_price, discount, …) */
      const discountFor = (serviceId: string) => {
        const row = orderItemInserts().find((p) => p[1] === serviceId);
        expect(row, `no order_items row for ${serviceId}`).toBeDefined();
        return row![5];
      };

      it('ignores a discount on an item that has not opted in', async () => {
        setupSuccessfulOrderCreation(); // mockServices leave the flag unset
        await orderService.createOrder(
          { ...validRequest, items: [{ serviceId: 'svc-1', quantity: 1, manualDiscount: 20000 }] },
          mockUser,
          { shift: { id: 'shift-1', outletId: 'outlet-1' } },
        );
        expect(discountFor('svc-1')).toBe(0);
      });

      it('honours a discount up to the item’s own fixed cap', async () => {
        mockPool.query.mockReset();
        mockPool.query.mockResolvedValueOnce({
          rows: [{ ...mockServices[0], dynamic_discount_enabled: true, dynamic_discount_kind: 'fixed', max_discount: '5000.00' }],
        });
        mockPool.query.mockResolvedValueOnce({ rows: [{ settings: { service_charge_pct: 0, tax_pct: 0 } }] });
        mockPool.query.mockResolvedValueOnce({ rows: [] });
        mockPool.query.mockResolvedValueOnce({ rows: [{ count: '1' }] });
        currentOrderRow = { id: 'order-1', status: 'ordered', total: '45000.00', created_at: new Date(), updated_at: new Date() };

        await orderService.createOrder(
          { ...validRequest, items: [{ serviceId: 'svc-1', quantity: 1, manualDiscount: 4000 }] },
          mockUser,
          { shift: { id: 'shift-1', outletId: 'outlet-1' } },
        );
        expect(discountFor('svc-1')).toBe(4000);
      });

      it('clamps a discount that exceeds the item’s own cap', async () => {
        mockPool.query.mockReset();
        mockPool.query.mockResolvedValueOnce({
          rows: [{ ...mockServices[0], dynamic_discount_enabled: true, dynamic_discount_kind: 'fixed', max_discount: '5000.00' }],
        });
        mockPool.query.mockResolvedValueOnce({ rows: [{ settings: { service_charge_pct: 0, tax_pct: 0 } }] });
        mockPool.query.mockResolvedValueOnce({ rows: [] });
        mockPool.query.mockResolvedValueOnce({ rows: [{ count: '1' }] });
        currentOrderRow = { id: 'order-1', status: 'ordered', total: '45000.00', created_at: new Date(), updated_at: new Date() };

        await orderService.createOrder(
          { ...validRequest, items: [{ serviceId: 'svc-1', quantity: 1, manualDiscount: 40000 }] },
          mockUser,
          { shift: { id: 'shift-1', outletId: 'outlet-1' } },
        );
        // Capped at the item's 5 000, not the requested 40 000.
        expect(discountFor('svc-1')).toBe(5000);
      });

      it('applies a percentage cap against the whole line', async () => {
        mockPool.query.mockReset();
        mockPool.query.mockResolvedValueOnce({
          rows: [{ ...mockServices[0], dynamic_discount_enabled: true, dynamic_discount_kind: 'percentage', max_discount: '10.00' }],
        });
        mockPool.query.mockResolvedValueOnce({ rows: [{ settings: { service_charge_pct: 0, tax_pct: 0 } }] });
        mockPool.query.mockResolvedValueOnce({ rows: [] });
        mockPool.query.mockResolvedValueOnce({ rows: [{ count: '1' }] });
        currentOrderRow = { id: 'order-1', status: 'ordered', total: '85000.00', created_at: new Date(), updated_at: new Date() };

        await orderService.createOrder(
          { ...validRequest, items: [{ serviceId: 'svc-1', quantity: 2, manualDiscount: 99999 }] },
          mockUser,
          { shift: { id: 'shift-1', outletId: 'outlet-1' } },
        );
        // 10% of 2 × 50 000 = 10 000.
        expect(discountFor('svc-1')).toBe(10000);
      });

      it('never writes a Rupiah member price into the DECIMAL(5,2) percentage column', async () => {
        // Regression: recording the member benefit KIND per line also wrote its
        // value, and a 'fixed' benefit's value is a Rupiah price (e.g. 30000).
        // member_discount_value is DECIMAL(5,2) — max 999.99 — so Postgres raised
        // "numeric field overflow" and the whole sale failed. Only a fraction or 1
        // may be stored; a fixed price is implied by discount/subtotal.
        setupSuccessfulOrderCreation();

        await orderService.createOrder(validRequest, mockUser, { shift: { id: 'shift-1', outletId: 'outlet-1' } });

        const itemInserts = mockClient.query.mock.calls.filter(
          (c: unknown[]) => String(c[0]).includes('INSERT INTO order_items'),
        );
        expect(itemInserts.length).toBeGreaterThan(0);
        for (const call of itemInserts) {
          const params = (call[1] as unknown[]) ?? [];
          // member_discount_value is the 11th bind (index 10) on the service insert.
          const memberValue = params[10];
          if (typeof memberValue === 'number') {
            expect(Math.abs(memberValue)).toBeLessThan(1000);
          }
        }
      });

      it('honours an item cap ABOVE the legacy tenant-wide 30% default', async () => {
        // The item's own rule is authoritative; the hardcoded 30% outlet default
        // must not clamp it further. Every earlier case sat below 30%, so this
        // stacked-cap bug survived a green suite and was only caught by driving a
        // real 50%-configured item on production (AIRIN-122/123).
        mockPool.query.mockReset();
        mockPool.query.mockResolvedValueOnce({
          rows: [{ ...mockServices[0], dynamic_discount_enabled: true, dynamic_discount_kind: 'percentage', max_discount: '50.00' }],
        });
        mockPool.query.mockResolvedValueOnce({ rows: [{ settings: { service_charge_pct: 0, tax_pct: 0 } }] });
        mockPool.query.mockResolvedValueOnce({ rows: [] });
        mockPool.query.mockResolvedValueOnce({ rows: [{ count: '1' }] });
        currentOrderRow = { id: 'order-1', status: 'ordered', total: '25000.00', created_at: new Date(), updated_at: new Date() };

        await orderService.createOrder(
          { ...validRequest, items: [{ serviceId: 'svc-1', quantity: 1, manualDiscount: 25000 }] },
          mockUser,
          { shift: { id: 'shift-1', outletId: 'outlet-1' } },
        );
        // 50% of 50 000 = 25 000 — NOT the 15 000 the 30% default would have given.
        expect(discountFor('svc-1')).toBe(25000);
      });
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
