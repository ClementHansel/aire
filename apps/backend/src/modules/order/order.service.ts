import {
  Injectable,
  Inject,
  Optional,
  BadRequestException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';
import {
  CreateOrderRequest,
  OrderStatus,
  JWTPayload,
  validateOrder,
  OrderValidationInput,
  calculateCartSummary,
  CartItem,
  CartConfig,
  applyMembershipPricing,
  MembershipBenefit,
  assignCustomerTags,
  CustomerTag,
  ERR_VALIDATION_FAILED,
  VoucherType,
  VoucherData,
  VoucherEvaluationContext,
  evaluateVoucher,
  hashVoucherCode,
  MAX_VOUCHER_CODES_PER_ORDER,
  BusinessUnit,
} from '@aire/shared';
import { OrderStateMachine, StatusLogEntry } from './order-state-machine';

/**
 * Database row shape for orders table.
 */
interface OrderRow {
  id: string;
  tenant_id: string;
  outlet_id: string;
  operator_id: string;
  customer_id: string | null;
  order_number: string;
  status: string;
  customer_name: string;
  customer_phone: string;
  license_plate: string | null;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  subtotal: string;
  service_charge: string;
  tax: string;
  voucher_discount: string;
  promo_discount: string;
  total: string;
  payment_method: string | null;
  payment_reference: string | null;
  amount_received: string | null;
  change_amount: string | null;
  note: string | null;
  membership_id: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Database row shape for services table.
 */
interface ServiceRow {
  id: string;
  name: string;
  category: string;
  price: string;
  is_main_service: boolean;
  is_active: boolean;
  business_unit: string;
}

/**
 * Database row shape for membership with benefits.
 */
interface MembershipRow {
  id: string;
  plan_id: string;
  status: string;
  uses_count: number;
  max_uses: number;
  daily_limit: number;
}

interface MembershipPlanRow {
  id: string;
  free_service_ids: string[] | null;
  discounted_services: Array<{ serviceId: string; discountPct: number }>;
  name: string;
}

/**
 * Represents the created order response returned to the client.
 */
export interface CreatedOrderResponse {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  customerName: string;
  customerPhone: string;
  licensePlate: string | null;
  vehicleBrand: string | null;
  vehicleModel: string | null;
  subtotal: number;
  serviceCharge: number;
  tax: number;
  voucherDiscount: number;
  promoDiscount: number;
  total: number;
  note: string | null;
  membershipId: string | null;
  items: Array<{
    id: string;
    serviceId: string;
    serviceName: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    subtotal: number;
    isMemberPricing: boolean;
  }>;
  tags: CustomerTag[];
  createdAt: Date;
}

@Injectable()
export class OrderService {
  private readonly stateMachine = new OrderStateMachine();

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  /**
   * Creates a new order.
   *
   * 1. Validates input using shared validateOrder
   * 2. Looks up services by ID to get prices and isMainService flags
   * 3. Applies membership pricing if membershipId is provided
   * 4. Applies voucher discounts (placeholder - voucher resolution is in voucher module)
   * 5. Calculates cart summary
   * 6. Creates order record with status 'ordered'
   * 7. Creates order_items records
   * 8. Returns the created order with ID and calculated totals
   */
  async createOrder(
    request: CreateOrderRequest,
    user: JWTPayload,
  ): Promise<CreatedOrderResponse> {
    // Step 1: Look up services by ID to get prices and isMainService flags
    const serviceIds = request.items.map((item) => item.serviceId);
    const services = await this.lookupServices(serviceIds);

    // A transaction belongs to exactly one business unit (AIRE car wash / LEAD
    // detailing). Every line item must belong to that same unit.
    const businessUnit = request.businessUnit ?? BusinessUnit.Aire;
    for (const item of request.items) {
      const svc = services.get(item.serviceId);
      if (svc && svc.business_unit && svc.business_unit !== businessUnit) {
        throw new BadRequestException({
          statusCode: 400,
          error: ERR_VALIDATION_FAILED,
          message: `All items must belong to the ${businessUnit} business unit. "${svc.name}" belongs to ${svc.business_unit}.`,
        });
      }
    }

    // Step 2: Build validation input
    const validationInput: OrderValidationInput = {
      customerName: request.customer.name,
      customerPhone: request.customer.phone,
      items: request.items.map((item) => {
        const service = services.get(item.serviceId);
        return {
          serviceId: item.serviceId,
          quantity: item.quantity,
          isMainService: service?.is_main_service ?? false,
        };
      }),
      voucherCodes: request.voucherCodes,
    };

    // If membership is provided, look up plates for validation
    if (request.membershipId) {
      const memberPlates = await this.getMembershipPlates(request.membershipId);
      validationInput.memberPlates = memberPlates;
      validationInput.selectedPlate = request.selectedPlate;
    }

    // Step 3: Run validation
    const validationResult = validateOrder(validationInput);
    if (!validationResult.valid) {
      throw new BadRequestException({
        statusCode: 400,
        error: ERR_VALIDATION_FAILED,
        message: 'Order validation failed',
        details: validationResult.errors,
      });
    }

    // Step 4: Build cart items from services
    let cartItems: CartItem[] = request.items.map((item) => {
      const service = services.get(item.serviceId);
      if (!service) {
        throw new BadRequestException({
          statusCode: 400,
          error: ERR_VALIDATION_FAILED,
          message: `Service not found: ${item.serviceId}`,
        });
      }
      return {
        serviceId: item.serviceId,
        serviceName: service.name,
        quantity: item.quantity,
        unitPrice: parseFloat(service.price),
        discount: item.manualDiscount ?? 0,
        isMainService: service.is_main_service,
      };
    });

    // Step 5: Apply membership pricing if membershipId is provided
    let membershipApplied = false;
    if (request.membershipId) {
      const benefits = await this.getMembershipBenefits(request.membershipId);
      if (benefits.length > 0) {
        const pricingResult = applyMembershipPricing(cartItems, benefits);
        cartItems = pricingResult.items;
        membershipApplied = pricingResult.appliedPricing.length > 0;
      }
    }

    // Step 6: Apply voucher discounts — resolve codes (read-only) and compute
    // the discount. Codes are atomically redeemed inside the transaction below.
    let voucherDiscount = 0;
    let resolvedVoucherHashes: string[] = [];
    if (request.voucherCodes && request.voucherCodes.length > 0) {
      const preSubtotal = cartItems.reduce(
        (sum, ci) => sum + ci.quantity * ci.unitPrice - ci.discount,
        0,
      );
      const voucherContext: VoucherEvaluationContext = {
        outletId: user.outlet_id ?? '',
        vehicleBrand: request.customer.brand,
        serviceIdsInCart: cartItems.map((ci) => ci.serviceId),
        orderSubtotal: preSubtotal,
        currentDate: new Date().toISOString().slice(0, 10),
      };
      const resolved = await this.resolveVouchers(
        user.tenant_id,
        request.voucherCodes,
        voucherContext,
        cartItems,
      );
      voucherDiscount = resolved.discount;
      resolvedVoucherHashes = resolved.codeHashes;
    }

    // Step 7: Get outlet config for charges
    const outletConfig = await this.getOutletConfig(user.outlet_id!);

    // Step 8: Calculate cart summary
    const cartSummary = calculateCartSummary(
      cartItems,
      outletConfig,
      voucherDiscount,
      0, // promo discount (campaigns handled separately)
    );

    // Step 9: Generate order number
    const orderNumber = await this.generateOrderNumber(user.outlet_id!);

    // Step 10: Create order and items in a transaction
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Insert order
      const orderResult = await client.query<OrderRow>(
        `INSERT INTO orders
          (tenant_id, outlet_id, operator_id, order_number, status,
           customer_name, customer_phone, license_plate, vehicle_brand, vehicle_model,
           subtotal, service_charge, tax, voucher_discount, promo_discount, total,
           note, membership_id, business_unit, salesperson_name, shift_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
           (SELECT id FROM pos_shifts WHERE tenant_id = $1 AND operator_id = $3 AND status = 'open' ORDER BY opened_at DESC LIMIT 1))
         RETURNING *`,
        [
          user.tenant_id,
          user.outlet_id,
          user.sub,
          orderNumber,
          OrderStatus.Ordered,
          request.customer.name,
          request.customer.phone,
          request.customer.licensePlate ?? request.selectedPlate ?? null,
          request.customer.brand ?? null,
          request.customer.model ?? null,
          cartSummary.subtotal,
          cartSummary.serviceCharge,
          cartSummary.tax,
          cartSummary.voucherDiscount,
          cartSummary.promoDiscount,
          cartSummary.total,
          request.note ?? null,
          request.membershipId ?? null,
          businessUnit,
          request.salespersonName ?? null,
        ],
      );

      const order = orderResult.rows[0]!;

      // Insert order items
      const orderItems: Array<{
        id: string;
        serviceId: string;
        serviceName: string;
        quantity: number;
        unitPrice: number;
        discount: number;
        subtotal: number;
        isMemberPricing: boolean;
      }> = [];

      for (let i = 0; i < cartItems.length; i++) {
        const cartItem = cartItems[i]!;
        const itemSubtotal = Math.max(
          0,
          cartItem.quantity * cartItem.unitPrice - cartItem.discount,
        );
        const originalItem = request.items[i]!;
        const isMemberPricing =
          membershipApplied && cartItem.discount > (originalItem.manualDiscount ?? 0);

        const itemResult = await client.query<{ id: string }>(
          `INSERT INTO order_items
            (order_id, service_id, quantity, unit_price, discount, subtotal,
             is_member_pricing, membership_id, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            order.id,
            cartItem.serviceId,
            cartItem.quantity,
            cartItem.unitPrice,
            cartItem.discount,
            itemSubtotal,
            isMemberPricing,
            isMemberPricing ? request.membershipId : null,
            i,
          ],
        );

        orderItems.push({
          id: itemResult.rows[0]!.id,
          serviceId: cartItem.serviceId,
          serviceName: cartItem.serviceName,
          quantity: cartItem.quantity,
          unitPrice: cartItem.unitPrice,
          discount: cartItem.discount,
          subtotal: itemSubtotal,
          isMemberPricing,
        });
      }

      // Record initial status log entry
      const logEntry: StatusLogEntry = this.stateMachine.createLogEntry(
        order.id,
        OrderStatus.Ordered,
        OrderStatus.Ordered,
        user.sub,
      );

      await client.query(
        `INSERT INTO order_status_logs (order_id, from_status, to_status, operator_id, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          logEntry.orderId,
          logEntry.fromStatus,
          logEntry.toStatus,
          logEntry.operatorId,
          logEntry.timestamp,
        ],
      );

      // Atomically redeem any applied voucher codes (single-use guard). If a
      // code was consumed concurrently, the redeem fails and the order rolls back.
      for (const codeHash of resolvedVoucherHashes) {
        const redeemed = await client.query<{ pack_id: string }>(
          `UPDATE voucher_codes vc
           SET status = 'redeemed', redeemed_at = NOW(), order_id = $1
           FROM voucher_packs vp
           WHERE vc.code_hash = $2
             AND vc.pack_id = vp.id
             AND vp.tenant_id = $3
             AND vc.status = 'active'
           RETURNING vc.pack_id`,
          [order.id, codeHash, user.tenant_id],
        );
        if (redeemed.rowCount === 0) {
          throw new BadRequestException('A voucher code is no longer available');
        }
        await client.query(
          `UPDATE voucher_packs
           SET uses_count = uses_count + 1,
               status = CASE WHEN uses_count + 1 >= total_uses THEN 'fully_redeemed' ELSE status END,
               updated_at = NOW()
           WHERE id = $1`,
          [redeemed.rows[0]!.pack_id],
        );
      }

      await client.query('COMMIT');

      // Emit domain event for the AI agent / monitoring (best-effort).
      void this.eventBus?.emit({
        type: DomainEventType.OrderCreated,
        tenantId: user.tenant_id,
        outletId: user.outlet_id,
        actor: user.sub,
        payload: {
          orderId: order.id,
          orderNumber: order.order_number,
          total: parseFloat(order.total),
          voucherDiscount,
          itemCount: cartItems.length,
        },
      });

      // Determine customer type tags (will be persisted on payment)
      const tags = assignCustomerTags({
        hasVoucherPackPurchase: false,
        hasNewMembership: false,
        hasMembershipRenewal: false,
        hasVoucherRedemption:
          (request.voucherCodes?.length ?? 0) > 0 && voucherDiscount > 0,
        hasMemberBenefitsApplied: membershipApplied,
      });

      return {
        id: order.id,
        orderNumber: order.order_number,
        status: OrderStatus.Ordered,
        customerName: order.customer_name,
        customerPhone: order.customer_phone,
        licensePlate: order.license_plate,
        vehicleBrand: order.vehicle_brand,
        vehicleModel: order.vehicle_model,
        subtotal: parseFloat(order.subtotal),
        serviceCharge: parseFloat(order.service_charge),
        tax: parseFloat(order.tax),
        voucherDiscount: parseFloat(order.voucher_discount),
        promoDiscount: parseFloat(order.promo_discount),
        total: parseFloat(order.total),
        note: order.note,
        membershipId: order.membership_id,
        items: orderItems,
        tags,
        createdAt: order.created_at,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────

  /**
   * Marks an order as paid. Records the payment method, reference,
   * amount received and change, and transitions status ordered → paid.
   *
   * Used by POS for cash/EDC/transfer/QRIS-static settlement.
   */
  async payOrder(
    orderId: string,
    user: JWTPayload,
    payment: {
      method: 'cash' | 'qris_static' | 'qris_dynamic' | 'edc' | 'cc' | 'transfer';
      paymentChannel?: BusinessUnit;
      amountReceived?: number;
      referenceNumber?: string;
    },
  ): Promise<CreatedOrderResponse> {
    const orderRes = await this.pool.query(
      `SELECT * FROM orders WHERE id = $1 AND tenant_id = $2`,
      [orderId, user.tenant_id],
    );
    const order = orderRes.rows[0];
    if (!order) {
      throw new BadRequestException({
        statusCode: 404,
        error: 'ORDER_NOT_FOUND',
        message: `Order ${orderId} not found`,
      });
    }
    if (order.status !== OrderStatus.Ordered) {
      throw new BadRequestException({
        statusCode: 400,
        error: ERR_VALIDATION_FAILED,
        message: `Order cannot be paid from status "${order.status}"`,
      });
    }

    const total = parseFloat(order.total);
    let changeAmount: number | null = null;
    if (payment.method === 'cash') {
      const received = payment.amountReceived ?? 0;
      if (received < total) {
        throw new BadRequestException({
          statusCode: 400,
          error: ERR_VALIDATION_FAILED,
          message: 'Amount received is less than the order total',
        });
      }
      changeAmount = received - total;
    }

    // Cash is unit-agnostic (single drawer); electronic channels settle to the
    // business unit's own account, defaulting to the order's business unit.
    const paymentChannel =
      payment.method === 'cash'
        ? null
        : (payment.paymentChannel ?? order.business_unit ?? BusinessUnit.Aire);

    const updated = await this.pool.query(
      `UPDATE orders
       SET status = 'paid',
           payment_method = $1,
           payment_reference = $2,
           amount_received = $3,
           change_amount = $4,
           payment_channel = $5,
           paid_at = NOW(),
           updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [
        payment.method,
        payment.referenceNumber ?? null,
        payment.amountReceived ?? null,
        changeAmount,
        paymentChannel,
        orderId,
      ],
    );

    const itemsRes = await this.pool.query(
      `SELECT oi.*, s.name AS service_name
       FROM order_items oi
       JOIN services s ON s.id = oi.service_id
       WHERE oi.order_id = $1`,
      [orderId],
    );

    const row = updated.rows[0];

    void this.eventBus?.emit({
      type: DomainEventType.OrderPaid,
      tenantId: user.tenant_id,
      outletId: row.outlet_id,
      actor: user.sub,
      payload: {
        orderId: row.id,
        orderNumber: row.order_number,
        total: parseFloat(row.total),
        paymentMethod: payment.method,
      },
    });

    return {
      id: row.id,
      orderNumber: row.order_number,
      status: row.status as OrderStatus,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      licensePlate: row.license_plate,
      vehicleBrand: row.vehicle_brand,
      vehicleModel: row.vehicle_model,
      subtotal: parseFloat(row.subtotal),
      serviceCharge: parseFloat(row.service_charge),
      tax: parseFloat(row.tax),
      voucherDiscount: parseFloat(row.voucher_discount),
      promoDiscount: parseFloat(row.promo_discount),
      total: parseFloat(row.total),
      note: row.note,
      membershipId: row.membership_id,
      items: itemsRes.rows.map((i) => ({
        id: i.id,
        serviceId: i.service_id,
        serviceName: i.service_name,
        quantity: i.quantity,
        unitPrice: parseFloat(i.unit_price),
        discount: parseFloat(i.discount ?? '0'),
        subtotal: parseFloat(i.subtotal),
        isMemberPricing: i.is_member_pricing ?? false,
      })),
      tags: [],
      createdAt: row.created_at,
    };
  }

  /**
   * Lightweight order status lookup (for POS payment polling).
   */
  async getOrderStatus(
    orderId: string,
    user: JWTPayload,
  ): Promise<{ id: string; orderNumber: string; status: string; total: number } | null> {
    const res = await this.pool.query(
      'SELECT id, order_number, status, total FROM orders WHERE id = $1 AND tenant_id = $2',
      [orderId, user.tenant_id],
    );
    const row = res.rows[0];
    if (!row) return null;
    return { id: row.id, orderNumber: row.order_number, status: row.status, total: parseFloat(row.total) };
  }

  /**
   * Looks up services by their IDs and returns a map of serviceId → ServiceRow.
   */
  private async lookupServices(
    serviceIds: string[],
  ): Promise<Map<string, ServiceRow>> {
    if (serviceIds.length === 0) {
      return new Map();
    }

    const placeholders = serviceIds.map((_, i) => `$${i + 1}`).join(', ');
    const result = await this.pool.query<ServiceRow>(
      `SELECT id, name, category, price, is_main_service, is_active, business_unit
       FROM services
       WHERE id IN (${placeholders})`,
      serviceIds,
    );

    const map = new Map<string, ServiceRow>();
    for (const row of result.rows) {
      map.set(row.id, row);
    }
    return map;
  }

  /**
   * Gets membership plates for validation (multi-plate selection check).
   */
  private async getMembershipPlates(membershipId: string): Promise<string[]> {
    const result = await this.pool.query<{ plate_normalized: string }>(
      'SELECT plate_normalized FROM membership_plates WHERE membership_id = $1',
      [membershipId],
    );
    return result.rows.map((r) => r.plate_normalized);
  }

  /**
   * Gets membership benefits for applying pricing.
   */
  private async getMembershipBenefits(
    membershipId: string,
  ): Promise<MembershipBenefit[]> {
    // Look up the membership and its plan
    const membershipResult = await this.pool.query<MembershipRow>(
      `SELECT id, plan_id, status, uses_count, max_uses, daily_limit
       FROM memberships WHERE id = $1 AND status = 'active'`,
      [membershipId],
    );

    if (membershipResult.rows.length === 0) {
      return [];
    }

    const membership = membershipResult.rows[0]!;

    // Get the plan details
    const planResult = await this.pool.query<MembershipPlanRow>(
      `SELECT id, name, free_service_ids, discounted_services
       FROM membership_plans WHERE id = $1`,
      [membership.plan_id],
    );

    if (planResult.rows.length === 0) {
      return [];
    }

    const plan = planResult.rows[0]!;

    return [
      {
        membershipId: membership.id,
        planName: plan.name,
        freeServiceIds: plan.free_service_ids ?? [],
        discountedServices: plan.discounted_services ?? [],
      },
    ];
  }

  /**
   * Resolve voucher codes for an order (read-only). Returns the total discount
   * and the hashes of the codes to redeem. Enforces one voucher per type
   * (stacking limit, Requirement 17.2) and caps total discount at the subtotal.
   */
  private async resolveVouchers(
    tenantId: string,
    codes: string[],
    context: VoucherEvaluationContext,
    cartItems: CartItem[],
  ): Promise<{ discount: number; codeHashes: string[] }> {
    const typesSeen = new Set<VoucherType>();
    const codeHashes: string[] = [];
    let discount = 0;

    for (const raw of codes.slice(0, MAX_VOUCHER_CODES_PER_ORDER)) {
      const codeHash = hashVoucherCode(raw.trim());
      const data = await this.lookupVoucher(tenantId, codeHash);
      const state = evaluateVoucher(data, context);
      if (state.status !== 'valid_applicable') continue;
      if (typesSeen.has(state.type)) continue; // max 1 voucher per type
      typesSeen.add(state.type);

      let amount = 0;
      if (state.type === VoucherType.Fixed) {
        amount = Math.min(state.discountValue, context.orderSubtotal);
      } else if (state.type === VoucherType.Percentage) {
        amount = Math.round((context.orderSubtotal * state.discountValue) / 100);
      } else {
        // service_pack: discount equals the price of covered services in the cart
        const ids = data?.serviceIds ?? null;
        amount = cartItems
          .filter((ci) => ids === null || ids.includes(ci.serviceId))
          .reduce((sum, ci) => sum + ci.quantity * ci.unitPrice, 0);
      }
      discount += amount;
      codeHashes.push(codeHash);
    }

    return { discount: Math.min(discount, context.orderSubtotal), codeHashes };
  }

  /** Look up a child voucher code and assemble VoucherData; null if not found. */
  private async lookupVoucher(tenantId: string, codeHash: string): Promise<VoucherData | null> {
    const res = await this.pool.query<{
      code_status: string;
      pack_status: string;
      pack_expiry: string | null;
      type: VoucherType;
      value: string;
      template_start: string | null;
      template_expiry: string | null;
      outlet_ids: string[] | null;
      brand_scope: string[] | null;
      service_ids: string[] | null;
      min_order_amount: string;
      template_active: boolean;
      is_parent: boolean;
    }>(
      `SELECT vc.status AS code_status, vp.status AS pack_status, vp.expiry_date AS pack_expiry,
              vt.type, vt.value::text AS value,
              vt.start_date AS template_start, vt.expiry_date AS template_expiry,
              vt.outlet_ids, vt.brand_scope, vt.service_ids,
              vt.min_order_amount::text AS min_order_amount, vt.is_active AS template_active,
              false AS is_parent
       FROM voucher_codes vc
       JOIN voucher_packs vp ON vp.id = vc.pack_id
       JOIN voucher_templates vt ON vt.id = vp.template_id
       WHERE vc.code_hash = $1 AND vp.tenant_id = $2`,
      [codeHash, tenantId],
    );
    const row = res.rows[0];
    if (!row) return null;

    return {
      type: row.type,
      value: parseFloat(row.value),
      maxUses: 1,
      currentUses: row.code_status === 'active' ? 0 : 1,
      startDate: row.template_start,
      expiryDate: row.pack_expiry ?? row.template_expiry,
      outletIds: row.outlet_ids,
      brandScope: row.brand_scope,
      serviceIds: row.service_ids,
      minOrderAmount: parseFloat(row.min_order_amount),
      isActive: row.template_active && row.pack_status === 'active' && row.code_status === 'active',
      isParentCode: false,
    };
  }

  /**
   * Gets outlet configuration for service charge and tax percentages.
   */
  private async getOutletConfig(outletId: string): Promise<CartConfig> {
    const result = await this.pool.query<{ settings: Record<string, unknown> }>(
      'SELECT settings FROM outlets WHERE id = $1',
      [outletId],
    );

    if (result.rows.length === 0) {
      // Default config if outlet not found
      return { serviceChargePct: 0, taxPct: 0 };
    }

    const settings = result.rows[0]!.settings ?? {};
    return {
      serviceChargePct:
        typeof settings.service_charge_pct === 'number'
          ? settings.service_charge_pct
          : 0,
      taxPct: typeof settings.tax_pct === 'number' ? settings.tax_pct : 0,
    };
  }

  /**
   * Generates a sequential order number for the outlet per day.
   * Format: ORD-YYYYMMDD-NNN
   */
  private async generateOrderNumber(outletId: string): Promise<string> {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');

    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM orders
       WHERE outlet_id = $1
       AND DATE(created_at) = CURRENT_DATE`,
      [outletId],
    );

    const count = parseInt(result.rows[0]!.count, 10) + 1;
    const paddedCount = count.toString().padStart(3, '0');

    return `ORD-${dateStr}-${paddedCount}`;
  }
}
