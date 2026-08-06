import {
  Injectable,
  Inject,
  Optional,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { randomInt } from 'node:crypto';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';
import { NotificationService } from '../notification/notification.service';
import { WhatsappService } from '../whatsapp';
import {
  CreateOrderRequest,
  OrderStatus,
  JWTPayload,
  validateOrder,
  OrderValidationInput,
  calculateCartSummary,
  applyManualDiscount,
  maxLineDiscount,
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
  Role,
  checkVoidAuthorization,
  VOID_PAID_WARNING_MESSAGE,
  normalizePlate,
  normalizePhone,
} from '@aire/shared';
import { upsertCustomerRow } from './pos-checkout.service';
import * as bcrypt from 'bcrypt';
import { OrderStateMachine, StatusLogEntry } from './order-state-machine';

/**
 * Fallback cap on a cashier's per-line manual discount (30%) used when an
 * outlet hasn't configured its own `max_manual_discount_pct` setting. Cart
 * items are always clamped to a cap — never left uncapped — so this constant
 * is the last line of defense, not just a UI hint.
 */
const DEFAULT_MAX_MANUAL_DISCOUNT_PCT = 0.3;

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
  /** Per-item manual-discount permission (AIRIN-121/122/123). */
  dynamic_discount_enabled: boolean | null;
  dynamic_discount_kind: 'fixed' | 'percentage' | null;
  max_discount: string | null;
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
  home_outlet_id: string | null;
}

interface MembershipPlanRow {
  id: string;
  free_service_ids: string[] | null;
  discounted_services: Array<{ serviceId: string; discountPct?: number; fixedPrice?: number }>;
  name: string;
  settlement_amount: string | null;
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
  /** Id of a membership SOLD on this order (null when none was). Distinct from
   *  membershipId, which is "the membership that priced this order". */
  soldMembershipId?: string | null;
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
  /** Set when a member's benefit was withheld (daily limit / lifetime quota); the
   *  POS shows this so the cashier can explain the normal-price charge. */
  membershipQuotaWarning?: string;
}

@Injectable()
export class OrderService {
  private readonly stateMachine = new OrderStateMachine();
  private readonly logger = new Logger(OrderService.name);

  /** One-time void-PIN validity window (requestVoidPin / voidOrder). */
  private static readonly VOID_PIN_TTL_MINUTES = 10;

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() private readonly eventBus?: EventBusService,
    @Optional() private readonly notification?: NotificationService,
    @Optional() private readonly whatsapp?: WhatsappService,
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
    opts: { shift?: { id: string; outletId: string } } = {},
  ): Promise<CreatedOrderResponse> {
    // A pack-only sale (membership plan / voucher pack, no wash) legitimately
    // arrives with no items at all; normalise once so every step below can keep
    // treating request.items as a list.
    if (!request.items) request = { ...request, items: [] };

    // Step 1: Look up services by ID to get prices and isMainService flags
    const serviceIds = request.items.map((item) => item.serviceId);
    const services = await this.lookupServices(serviceIds);

    // A single order can mix AIRE (car wash) and LEAD (detailing) items into one
    // receipt/payment. The order's business_unit records the payment channel; it
    // defaults to the caller's selected unit (see request.businessUnit).
    const businessUnit = request.businessUnit ?? BusinessUnit.Aire;

    // Step 1b: Packs sold on THIS order (Samuel 2026-07-30 — sell-pack merged
    // into new-order so an upsell at the counter is one transaction, not two).
    // A pack is a cart line with no services row behind it (migration 089), so
    // it is priced and inserted alongside the service lines rather than through
    // PosCheckoutService.createPackOrder. Resolved before validation because a
    // pack sale legitimises an order with no wash in it.
    const packLines = await this.resolvePackLines(user.tenant_id, request);
    const packTotal = packLines.reduce((s, p) => s + p.unitPrice, 0);
    const sellsMembershipPlan = packLines.some((p) => p.kind === 'membership_plan');

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
      sellsPack: packLines.length > 0,
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
        // Deliberately 0, NOT item.manualDiscount: the requested discount is
        // untrusted until the per-item eligibility gate in Step 5b has vetted it.
        // Seeding it here previously meant a request could carry a discount that
        // survived whenever the clamp pass declined to run (AIRIN-121).
        discount: 0,
        isMainService: service.is_main_service,
      };
    });

    // Step 5: Look up membership benefits, but DEFER applying them until after
    // voucher resolution — the Golden Rule (handbook §6.2) says a voucher WINS, so
    // when a voucher applies we must NOT also apply membership pricing (and must not
    // consume quota). We keep the benefit LOOKUP here (its queries stay in place),
    // and only apply the pricing at Step 6b once we know whether a voucher won.
    let membershipApplied = false;
    // Service ids whose discount is a membership benefit (free/percentage-off), not
    // the cashier's manual discount — the cap-clamp pass must leave these alone.
    const memberPricedServiceIds = new Set<string>();
    /** Per-service benefit kind, so each saved line records WHY it was cheaper. */
    const memberPricingKind = new Map<string, { type: 'free' | 'percentage' | 'fixed'; value: number }>();
    // Surfaced to the cashier when a member's benefit was withheld because they
    // hit their daily limit or exhausted their lifetime quota (handbook §5.2/§5.6).
    let membershipQuotaWarning: string | undefined;
    let membershipBenefits: MembershipBenefit[] = [];
    if (request.membershipId) {
      const meta = await this.getMembershipBenefits(request.membershipId);
      membershipQuotaWarning = meta.quotaWarning;
      membershipBenefits = meta.benefits;
    }


    // Every order is booked into an open cashier shift and inherits that shift's
    // branch (the branch is chosen once, at shift open — so finance never
    // diverges). Kiosk callers pass a pre-resolved branch shift via opts.shift;
    // cashiers use their own open shift.
    let shift = opts.shift;
    if (!shift) {
      const sh = await this.pool.query<{ id: string; outlet_id: string }>(
        `SELECT id, outlet_id FROM pos_shifts
         WHERE tenant_id = $1 AND operator_id = $2 AND status = 'open'
         ORDER BY opened_at DESC LIMIT 1`,
        [user.tenant_id, user.sub],
      );
      if (sh.rows.length === 0) {
        throw new BadRequestException('Open a shift before taking orders.');
      }
      shift = { id: sh.rows[0]!.id, outletId: sh.rows[0]!.outlet_id };
    }
    const operatingOutletId = shift.outletId;
    const shiftId = shift.id;

    // Step 5b: Get outlet config for charges (moved ahead of its original
    // position so discounts can be enforced below, before voucher/promo math
    // reads item.discount).
    //
    // Manual discounts are now a PER-ITEM permission set in the dashboard, not a
    // single tenant-wide percentage (AIRIN-121/122/123): an item that hasn't
    // opted in cannot be discounted at all, and one that has is capped by its own
    // max_discount. The server is the source of truth — the POS hides the field,
    // but a hand-rolled request must not be able to discount a non-eligible item.
    // Items a membership benefit already priced (their discount is the benefit
    // amount, not a manual discount) are left untouched by this pass.
    const outletConfig = await this.getOutletConfig(operatingOutletId!);
    for (const item of request.items) {
      const requestedDiscount = item.manualDiscount ?? 0;
      if (requestedDiscount <= 0 || memberPricedServiceIds.has(item.serviceId)) continue;

      const svc = services.get(item.serviceId);
      const cap = maxLineDiscount(
        {
          enabled: svc?.dynamic_discount_enabled ?? false,
          kind: svc?.dynamic_discount_kind ?? null,
          maxDiscount: svc?.max_discount != null ? parseFloat(svc.max_discount) : null,
        },
        svc ? parseFloat(svc.price) : 0,
        item.quantity,
      );
      if (cap <= 0) {
        // Not discountable — drop the discount rather than reject the whole sale,
        // so a stale POS tab can't block a customer at the counter. The receipt
        // shows the undiscounted price, which is the correct amount to charge.
        this.logger.warn(
          `Manual discount of ${requestedDiscount} ignored for service ${item.serviceId}: dynamic discount not enabled`,
        );
        continue;
      }
      // The item's OWN rule is authoritative once it has one, so the legacy
      // tenant-wide percentage is dropped here (`cap` above already bounds the
      // amount). Leaving it in stacked two caps and silently took the smaller:
      // an item the owner configured for "max 50%" was still clamped to the
      // hardcoded 30% default, so the dashboard setting quietly did not apply and
      // the POS showed a ceiling the server would never honour (AIRIN-122/123,
      // found by live-testing the percentage path). applyManualDiscount keeps the
      // tenant-wide cap for callers with no per-item rule — its documented job.
      cartItems = applyManualDiscount(
        cartItems,
        item.serviceId,
        Math.min(requestedDiscount, cap),
        { ...outletConfig, maxManualDiscountPct: undefined },
      );
    }

    // Step 6: Apply voucher discounts — resolve codes (read-only) and compute
    // the discount. Codes are atomically redeemed inside the transaction below.
    let voucherDiscount = 0;
    let resolvedVoucherHashes: string[] = [];
    let resolvedTicketCodes: string[] = [];
    if (request.voucherCodes && request.voucherCodes.length > 0) {
      const preSubtotal = cartItems.reduce(
        (sum, ci) => sum + ci.quantity * ci.unitPrice - ci.discount,
        0,
      );
      const voucherContext: VoucherEvaluationContext = {
        outletId: operatingOutletId ?? '',
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
      // Also resolve shareable digital voucher tickets (BRANCH-MMYYYY-NNNNNN).
      const digital = await this.resolveDigitalVouchers(user.tenant_id, request.voucherCodes, preSubtotal, cartItems);
      voucherDiscount = Math.min(preSubtotal, voucherDiscount + digital.discount);
      resolvedTicketCodes = digital.codes;
    }

    // Step 6b: Apply membership pricing — but ONLY when no voucher won this order.
    // Golden Rule (handbook §6.2): "if a voucher is applied, the membership is NOT
    // used up — the voucher wins, charged once." So a voucher suppresses membership
    // pricing entirely (no double discount), and quota consumption is likewise
    // skipped at payment. With no voucher, the member benefit applies as normal.
    if (membershipBenefits.length > 0 && voucherDiscount === 0) {
      const pricingResult = applyMembershipPricing(cartItems, membershipBenefits);
      cartItems = pricingResult.items;
      membershipApplied = pricingResult.appliedPricing.length > 0;
      for (const p of pricingResult.appliedPricing) {
        memberPricedServiceIds.add(p.serviceId);
        // Keep the KIND of benefit per line, so the saved row can say "free" vs
        // "20% off" vs "member price" rather than only that a member paid less.
        // order_items.member_discount_type/value have existed since the first
        // migration and were never written.
        memberPricingKind.set(p.serviceId, { type: p.discountType, value: p.discountValue });
      }
    }

    // Step 6c: Counter upsell — a membership plan bought in the SAME order as a
    // wash makes that day's wash free (Samuel 2026-07-30: "kalau dibeli secara
    // bersamaan untuk plat nomor yang sama itu jadi free yang hari itu cuci
    // regulernya, tapi tetap tercatat kalau dia itu upsale di tempat").
    //
    // Only 'car_wash' lines are freed — the wash itself. Add-ons and products
    // stay charged, which is what "cuci regulernya" means at the counter.
    // Marked as member pricing so payment consumes one usage (the customer's
    // first wash on the new plan) and the 'member' tag lands on the order, and
    // the plan line itself keeps the sale visible as an upsell.
    if (sellsMembershipPlan) {
      cartItems = cartItems.map((ci) => {
        if (services.get(ci.serviceId)?.category !== 'car_wash') return ci;
        memberPricedServiceIds.add(ci.serviceId);
        // The upsell wash is free, and saying so is what distinguishes it from a
        // plain discount when the order is read back later.
        memberPricingKind.set(ci.serviceId, { type: 'free', value: 1 });
        return { ...ci, discount: ci.quantity * ci.unitPrice };
      });
      membershipApplied = membershipApplied || cartItems.some((ci) => services.get(ci.serviceId)?.category === 'car_wash');
    }

    // Step 7: outletConfig was already fetched above (Step 5b), ahead of the
    // manual-discount clamp, so it's reused here rather than re-queried.

    // Step 7b: Resolve active promotions (discount rewards applied to the total).
    const promoSubtotal = Math.max(0, cartItems.reduce((s, ci) => s + ci.quantity * ci.unitPrice - ci.discount, 0) - voucherDiscount);
    // Promotions apply ONLY when the cashier selected them (request.promotionIds) and
    // each passes server-side gates. Member-only promos require a membership on the order.
    const promo = await this.resolvePromotions(user.tenant_id, operatingOutletId ?? undefined, cartItems, promoSubtotal, {
      hasActiveMembership: !!request.membershipId,
      selectedIds: request.promotionIds ?? [],
    });
    const promoDiscount = promo.discount;

    // Step 8: Calculate cart summary
    const serviceSummary = calculateCartSummary(
      cartItems,
      outletConfig,
      voucherDiscount,
      promoDiscount,
    );
    // Pack fees ride on top of the service math: a membership fee is not a
    // washing service, so it takes no service charge and no tax, and vouchers /
    // promos priced against the wash must not eat into it either.
    const cartSummary = {
      ...serviceSummary,
      subtotal: serviceSummary.subtotal + packTotal,
      total: serviceSummary.total + packTotal,
    };

    // Step 9: Generate order number
    const orderNumber = await this.generateOrderNumber(operatingOutletId!);

    // Plate as typed (for the receipt) plus a canonical form for matching.
    // "B 8882 CST" and "B8882CST" are the same car; storing only the raw string
    // meant a later search by either spelling missed the order (AIRIN-117).
    const rawPlate = request.customer.licensePlate ?? request.selectedPlate ?? null;
    const plateNormalized = rawPlate ? (normalizePlate(rawPlate).normalized || null) : null;

    // Step 10: Create order and items in a transaction
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Every identifiable walk-in becomes a real customer record. Without this,
      // POS orders carried only the name/phone text columns and customer_id
      // stayed NULL, so buyers never appeared in CRM (AIRIN-112) and the visit /
      // spend metrics that join on customer_id had nothing to count. Inside the
      // transaction so a failed order leaves no orphan customer.
      //
      // Gate on normalizePhone().valid, not merely "non-empty": phone is the
      // upsert key, so any value that isn't a real number — '', '0000' and other
      // walk-in sentinels the POS and older flows emit — would collide on one
      // phone_normalized and silently merge every anonymous customer into a
      // single CRM record with a fabricated visit history.
      let customerId: string | null = null;
      if (normalizePhone(request.customer.phone ?? '').valid) {
        const cust = await upsertCustomerRow(
          client,
          user.tenant_id,
          request.customer.name,
          request.customer.phone,
        );
        customerId = cust.id;
        if (cust.inserted) {
          void this.eventBus?.emit({
            type: DomainEventType.CustomerCreated,
            tenantId: user.tenant_id,
            actor: 'pos',
            payload: { customerId: cust.id, name: request.customer.name, phone: cust.phoneNormalized },
          });
        }
      }

      // Insert order
      const orderResult = await client.query<OrderRow>(
        `INSERT INTO orders
          (tenant_id, outlet_id, operator_id, order_number, status,
           customer_name, customer_phone, license_plate, plate_normalized, vehicle_brand, vehicle_model,
           subtotal, service_charge, tax, voucher_discount, promo_discount, total,
           note, membership_id, business_unit, salesperson_name, channel, shift_id,
           salesperson_employee_id, customer_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
         RETURNING *`,
        [
          user.tenant_id,
          operatingOutletId,
          user.sub,
          orderNumber,
          OrderStatus.Ordered,
          request.customer.name,
          request.customer.phone,
          rawPlate,
          plateNormalized,
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
          request.channel ?? 'pos',
          shiftId,
          request.salespersonEmployeeId ?? null,
          customerId,
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
            (order_id, service_id, item_type, item_name, quantity, unit_price, discount, subtotal,
             is_member_pricing, membership_id, member_discount_type, member_discount_value, sort_order)
           VALUES ($1, $2, 'service', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING id`,
          [
            order.id,
            cartItem.serviceId,
            cartItem.serviceName,
            cartItem.quantity,
            cartItem.unitPrice,
            cartItem.discount,
            itemSubtotal,
            isMemberPricing,
            isMemberPricing ? request.membershipId : null,
            isMemberPricing ? (memberPricingKind.get(cartItem.serviceId)?.type ?? null) : null,
            isMemberPricing ? (memberPricingKind.get(cartItem.serviceId)?.value ?? null) : null,
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

      // Pack lines (membership plan / voucher pack) sold on this same order.
      // They sort after the services so the receipt reads "wash, then the plan
      // that made it free".
      for (let p = 0; p < packLines.length; p++) {
        const pack = packLines[p]!;
        const packResult = await client.query<{ id: string }>(
          `INSERT INTO order_items
            (order_id, service_id, item_type, item_name, membership_plan_id, voucher_template_id,
             quantity, unit_price, discount, subtotal, is_member_pricing, sort_order)
           VALUES ($1, NULL, $2, $3, $4, $5, 1, $6, 0, $6, false, $7)
           RETURNING id`,
          [
            order.id,
            pack.kind,
            pack.name,
            pack.kind === 'membership_plan' ? pack.id : null,
            pack.kind === 'voucher_pack' ? pack.id : null,
            pack.unitPrice,
            cartItems.length + p,
          ],
        );
        orderItems.push({
          id: packResult.rows[0]!.id,
          serviceId: '',
          serviceName: pack.name,
          quantity: 1,
          unitPrice: pack.unitPrice,
          discount: 0,
          subtotal: pack.unitPrice,
          isMemberPricing: false,
        });
      }

      // A plan sold on this order creates its membership right here, in the same
      // transaction — MembershipSellService.sellMembership runs on its own pool
      // connection, so calling it would let the order commit with a paid plan
      // line and no membership behind it. Status stays 'pending' until payment
      // (and plate registration) exactly as the old sell-pack flow did.
      let soldMembershipId: string | null = null;
      const planLine = packLines.find((p) => p.kind === 'membership_plan');
      if (planLine?.plan) {
        const plan = planLine.plan;
        const start = new Date();
        const end = new Date(start);
        end.setMonth(end.getMonth() + (plan.duration_months ?? 1));
        const mem = await client.query<{ id: string }>(
          `INSERT INTO memberships
            (tenant_id, customer_id, plan_id, status, start_date, end_date, uses_count, max_uses, daily_limit, order_id)
           VALUES ($1, $2, $3, 'pending', $4, $5, 0, $6, $7, $8)
           RETURNING id`,
          [
            user.tenant_id,
            customerId,
            plan.id,
            start.toISOString().slice(0, 10),
            end.toISOString().slice(0, 10),
            plan.max_uses,
            plan.daily_limit,
            order.id,
          ],
        );
        soldMembershipId = mem.rows[0]!.id;
        // Point the order (and the wash lines it just made free) at the new
        // membership, so payment consumes one usage against the right record.
        await client.query(`UPDATE orders SET membership_id = $1 WHERE id = $2`, [soldMembershipId, order.id]);
        await client.query(
          `UPDATE order_items SET membership_id = $1 WHERE order_id = $2 AND is_member_pricing = true`,
          [soldMembershipId, order.id],
        );
        // The car being rung up IS the membership's first registered vehicle.
        // Capturing it here (rather than waiting for the cashier to retype it in
        // the post-payment plate modal) is what makes a first-time purchase carry
        // its vehicle data at all — that modal was reachable only via a response
        // field that was always null, so every new membership landed plateless
        // (AIRIN-139). Plate is mandatory on the POS, so this is always present
        // in practice; guard anyway for kiosk/portal callers.
        if (plateNormalized) {
          await client.query(
            `INSERT INTO membership_plates (membership_id, plate, plate_normalized, brand, model)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              soldMembershipId,
              rawPlate ?? plateNormalized,
              plateNormalized,
              request.customer.brand ?? null,
              request.customer.model ?? null,
            ],
          );
        }
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

      // Redeem shareable digital voucher tickets (single-use).
      for (const code of resolvedTicketCodes) {
        const r = await client.query(
          `UPDATE voucher_tickets SET status = 'redeemed', redeemed_at = NOW(), redeemed_order_id = $1, redeemed_outlet_id = $2
           WHERE tenant_id = $3 AND code = $4 AND status = 'active' RETURNING id`,
          [order.id, operatingOutletId ?? null, user.tenant_id, code],
        );
        if (r.rowCount === 0) throw new BadRequestException('A voucher is no longer available');
      }

      // Record promotion grants + decrement quota.
      for (const g of promo.grants) {
        await client.query(
          `INSERT INTO promotion_grants (promotion_id, order_id, outlet_id, amount) VALUES ($1, $2, $3, $4)`,
          [g.promotionId, order.id, operatingOutletId ?? null, g.amount],
        );
        await client.query(
          `UPDATE promotions SET used_quota = used_quota + 1, updated_at = NOW() WHERE id = $1`,
          [g.promotionId],
        );
      }

      // NOTE: membership usage consumption + inter-branch settlement are recorded
      // at PAYMENT, not here — an order that is created but never paid must not
      // burn a member's quota (handbook §5.2: "recorded when the order is paid").
      // See payOrder → recordMembershipConsumption. Member PRICING is still applied
      // above at order creation (so the total is correct); only the quota
      // consumption is deferred to payment.

      // Auto-deduct recipe (BOM) stock for each line and freeze a per-unit COGS
      // snapshot — inside the transaction so stock and the sale commit atomically.
      await this.applyRecipeCogs(
        client,
        { id: order.id, orderNumber: order.order_number },
        // Service lines only — a membership/voucher pack has no recipe, no stock
        // to deduct, and no services row its serviceId could resolve against.
        orderItems.filter((oi) => oi.serviceId !== ''),
        user.sub,
        user.tenant_id,
      );

      // Link this order back to its vehicle-queue entry ("order from queue"),
      // so the queue board can render it as paid/unpaid. Service status
      // (waiting/serving/done) is left untouched — payment and service are
      // independent dimensions. Scoped by tenant; a stale/foreign id is a no-op.
      if (request.queueEntryId) {
        await client.query(
          `UPDATE vehicle_queue SET order_id = $1, updated_at = NOW()
           WHERE id = $2 AND tenant_id = $3`,
          [order.id, request.queueEntryId, user.tenant_id],
        );
      }

      // Cashier activity audit: every rung-up order lands in the central audit log
      // (operator, order, totals) — not just the orders table / status logs.
      await client.query(
        `INSERT INTO audit_logs (tenant_id, user_id, operation, entity_type, entity_id, before_value, after_value)
         VALUES ($1, $2, 'order.create', 'order', $3, NULL, $4)`,
        [user.tenant_id, user.sub, order.id, JSON.stringify({
          orderNumber: order.order_number,
          outletId: operatingOutletId,
          total: parseFloat(order.total),
          itemCount: cartItems.length,
          membershipId: request.membershipId ?? null,
          voucherDiscount,
          promoDiscount,
        })],
      );

      await client.query('COMMIT');

      // Emit domain event for the AI agent / monitoring (best-effort).
      void this.eventBus?.emit({
        type: DomainEventType.OrderCreated,
        tenantId: user.tenant_id,
        outletId: operatingOutletId,
        actor: user.sub,
        payload: {
          orderId: order.id,
          orderNumber: order.order_number,
          total: parseFloat(order.total),
          voucherDiscount,
          itemCount: cartItems.length,
        },
      });

      // Voucher / ticket single-use redemptions committed with the order.
      const redeemedCount = resolvedVoucherHashes.length + resolvedTicketCodes.length;
      if (redeemedCount > 0) {
        void this.eventBus?.emit({
          type: DomainEventType.VoucherRedeemed,
          tenantId: user.tenant_id,
          outletId: operatingOutletId,
          actor: user.sub,
          payload: { orderId: order.id, orderNumber: order.order_number, count: redeemedCount, discount: voucherDiscount },
        });
      }

      // Inter-branch settlement accrual is emitted at PAYMENT alongside the
      // membership-usage recording it derives from (see recordMembershipConsumption).

      // Preview customer-type tags for the response (persisted at payment).
      // NEW_MEMBER / BUY_VOUCHER_PACK are no longer exclusive to a separate Sell
      // Pack order — a counter upsell puts the pack on this very order, and that
      // is exactly the case the owner wants to see tagged.
      const tags = assignCustomerTags({
        hasVoucherPackPurchase: packLines.some((p) => p.kind === 'voucher_pack'),
        hasNewMembership: soldMembershipId != null,
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
        // `order` is the row as first INSERTed, so its membership_id is still
        // null when a plan was sold on this very order (the UPDATE above ran
        // after it). Prefer the id we just minted.
        membershipId: soldMembershipId ?? order.membership_id,
        // Explicitly "a NEW membership was sold here", distinct from
        // membershipId's "which membership priced this order". The POS keys its
        // post-payment vehicle step off this.
        soldMembershipId,
        items: orderItems,
        tags,
        createdAt: order.created_at,
        membershipQuotaWarning,
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
   * Resolve the packs (membership plan / voucher pack) a cart is selling into
   * priced order lines. Both are looked up under the caller's tenant and must be
   * active, so a stale POS tab can't sell a retired plan at its old price.
   *
   * At most one membership plan per order — memberships.order_id is the link
   * back, and MembershipSellService already rejects a second plan on the same
   * order (ERR_MEMBERSHIP_ONE_PLAN_PER_ORDER); this keeps the merged POS path
   * honouring the same rule instead of writing a state it can't represent.
   */
  private async resolvePackLines(
    tenantId: string,
    request: CreateOrderRequest,
  ): Promise<Array<{
    kind: 'membership_plan' | 'voucher_pack';
    id: string;
    name: string;
    unitPrice: number;
    plan?: { id: string; duration_months: number; max_uses: number; daily_limit: number; max_plates: number };
  }>> {
    const lines: Array<{
      kind: 'membership_plan' | 'voucher_pack';
      id: string; name: string; unitPrice: number;
      plan?: { id: string; duration_months: number; max_uses: number; daily_limit: number; max_plates: number };
    }> = [];

    if (request.membershipPlanId) {
      const r = await this.pool.query<{
        id: string; name: string; price: string;
        duration_months: number; max_uses: number; daily_limit: number; max_plates: number;
      }>(
        `SELECT id, name, price, duration_months, max_uses, daily_limit, max_plates
         FROM membership_plans
         WHERE id = $1 AND tenant_id = $2 AND is_active = true`,
        [request.membershipPlanId, tenantId],
      );
      const plan = r.rows[0];
      if (!plan) throw new BadRequestException('Membership plan not found or inactive');
      lines.push({
        kind: 'membership_plan',
        id: plan.id,
        name: plan.name,
        unitPrice: parseFloat(plan.price),
        plan: {
          id: plan.id,
          duration_months: plan.duration_months,
          max_uses: plan.max_uses,
          daily_limit: plan.daily_limit,
          max_plates: plan.max_plates,
        },
      });
    }

    if (request.voucherPackTemplateId) {
      const r = await this.pool.query<{ id: string; name: string; sale_price: string | null }>(
        `SELECT id, name, sale_price FROM voucher_templates
         WHERE id = $1 AND tenant_id = $2 AND is_active = true`,
        [request.voucherPackTemplateId, tenantId],
      );
      const tpl = r.rows[0];
      if (!tpl) throw new BadRequestException('Voucher pack not found or inactive');
      lines.push({
        kind: 'voucher_pack',
        id: tpl.id,
        name: tpl.name,
        unitPrice: tpl.sale_price != null ? parseFloat(tpl.sale_price) : 0,
      });
    }

    return lines;
  }

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

    // Book the sale into the shift of the cashier who is taking the money, so the
    // cash lands in the drawer that received it — this is what keeps a
    // pay-at-cashier (incl. kiosk-created) order true to shift reconciliation.
    // Falls back to the order's existing shift if the cashier has none open.
    const psh = await this.pool.query<{ id: string }>(
      `SELECT id FROM pos_shifts WHERE tenant_id = $1 AND operator_id = $2 AND status = 'open'
       ORDER BY opened_at DESC LIMIT 1`,
      [user.tenant_id, user.sub],
    );
    const payShiftId = psh.rows[0]?.id ?? null;

    // Payment is the point of consumption: mark paid, record membership usage
    // (unless a voucher won — golden rule), and persist customer-type tags — all
    // in ONE transaction so the sale and its side effects commit atomically.
    const client = await this.pool.connect();
    let row: Record<string, any>;
    let itemRows: Array<Record<string, any>>;
    let persistedTags: CustomerTag[];
    let accrual: { entryId: string; owingOutletId: string; servingOutletId: string; amount: number } | null = null;
    try {
      await client.query('BEGIN');

      const updated = await client.query(
        `UPDATE orders
         SET status = 'paid',
             payment_method = $1,
             payment_reference = $2,
             amount_received = $3,
             change_amount = $4,
             payment_channel = $5,
             shift_id = COALESCE($6, shift_id),
             paid_at = NOW(),
             updated_at = NOW()
         WHERE id = $7
         RETURNING *`,
        [
          payment.method,
          payment.referenceNumber ?? null,
          payment.amountReceived ?? null,
          changeAmount,
          paymentChannel,
          payShiftId,
          orderId,
        ],
      );
      row = updated.rows[0];

      // LEFT JOIN, not JOIN: a membership-plan / voucher-pack line has no
      // services row behind it (migration 089), and an inner join would drop it
      // from the receipt and from the paid-order response entirely.
      const itemsRes = await client.query(
        `SELECT oi.*, COALESCE(s.name, oi.item_name) AS service_name
         FROM order_items oi
         LEFT JOIN services s ON s.id = oi.service_id
         WHERE oi.order_id = $1`,
        [orderId],
      );
      itemRows = itemsRes.rows;

      const voucherApplied = parseFloat(row.voucher_discount ?? '0') > 0;
      const memberPricingApplied = itemRows.some((i) => i.is_member_pricing === true);
      // Golden Rule (handbook §6.2): a voucher in the order means the membership is
      // NOT consumed this transaction — the voucher wins, quota is preserved.
      const consumeMembership = !!row.membership_id && memberPricingApplied && !voucherApplied;

      if (consumeMembership) {
        const res = await this.recordMembershipConsumption(client, {
          tenantId: user.tenant_id,
          orderId,
          membershipId: row.membership_id,
          plate: row.license_plate,
          outletId: row.outlet_id ?? null,
        });
        accrual = res.accrual;
      }

      // Persist customer-type tags for the owner's reports (handbook §8). MEMBER /
      // VOUCHER come from the wash itself; NEW_MEMBER / BUY_VOUCHER_PACK come from
      // a pack sold on this same order — the counter upsell the owner wants to
      // see. (RENEWAL is still tagged by the renewal flow, which extends an
      // existing membership rather than putting a plan line on the order.)
      persistedTags = assignCustomerTags({
        hasVoucherPackPurchase: itemRows.some((i) => i.item_type === 'voucher_pack'),
        hasNewMembership: itemRows.some((i) => i.item_type === 'membership_plan'),
        hasMembershipRenewal: false,
        hasVoucherRedemption: voucherApplied,
        hasMemberBenefitsApplied: consumeMembership,
      });
      for (const tag of persistedTags) {
        await client.query(
          `INSERT INTO order_tags (order_id, tag) VALUES ($1, $2) ON CONFLICT (order_id, tag) DO NOTHING`,
          [orderId, tag],
        );
      }

      // Cashier activity audit: the payment action (who took what, how, how much).
      await client.query(
        `INSERT INTO audit_logs (tenant_id, user_id, operation, entity_type, entity_id, before_value, after_value)
         VALUES ($1, $2, 'order.pay', 'order', $3, NULL, $4)`,
        [user.tenant_id, user.sub, orderId, JSON.stringify({
          orderNumber: row.order_number,
          method: payment.method,
          total: parseFloat(row.total),
          reference: payment.referenceNumber ?? null,
          changeAmount,
        })],
      );

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

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
    if (accrual) {
      void this.eventBus?.emit({
        type: DomainEventType.SettlementAccrued,
        tenantId: user.tenant_id,
        outletId: accrual.servingOutletId,
        actor: user.sub,
        payload: accrual,
      });
    }

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
      items: itemRows.map((i) => ({
        id: i.id,
        serviceId: i.service_id,
        serviceName: i.service_name,
        quantity: i.quantity,
        unitPrice: parseFloat(i.unit_price),
        discount: parseFloat(i.discount ?? '0'),
        subtotal: parseFloat(i.subtotal),
        isMemberPricing: i.is_member_pricing ?? false,
      })),
      tags: persistedTags,
      createdAt: row.created_at,
    };
  }

  /**
   * Record a membership's consumption of one wash at PAYMENT time: insert the
   * per-plate usage row, increment the lifetime counter (auto-expiring the
   * membership when its quota is exhausted, handbook §5.2/§5.6), and accrue an
   * inter-branch settlement when the wash is redeemed away from the home outlet.
   * Runs inside the caller's transaction. Returns the settlement accrual (if any)
   * so the caller can emit SettlementAccrued after commit.
   */
  private async recordMembershipConsumption(
    client: PoolClient,
    opts: { tenantId: string; orderId: string; membershipId: string; plate: string | null; outletId: string | null },
  ): Promise<{ accrual: { entryId: string; owingOutletId: string; servingOutletId: string; amount: number } | null }> {
    const plateNorm = (opts.plate ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const m = await client.query<{ home_outlet_id: string | null; settlement_amount: string | null }>(
      `SELECT m.home_outlet_id, p.settlement_amount
       FROM memberships m JOIN membership_plans p ON p.id = m.plan_id
       WHERE m.id = $1 AND m.tenant_id = $2`,
      [opts.membershipId, opts.tenantId],
    );
    if (m.rows.length === 0) return { accrual: null };
    const mem = m.rows[0]!;

    const usage = await client.query<{ id: string }>(
      `INSERT INTO membership_usages (membership_id, plate_normalized, order_id, outlet_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [opts.membershipId, plateNorm, opts.orderId, opts.outletId],
    );

    // Increment lifetime usage; auto-expire when the finite quota is exhausted.
    // max_uses <= 0 (or null) = unlimited → never auto-expire.
    await client.query(
      `UPDATE memberships
       SET uses_count = uses_count + 1,
           status = CASE WHEN max_uses IS NOT NULL AND max_uses > 0 AND uses_count + 1 >= max_uses
                         THEN 'expired' ELSE status END,
           updated_at = NOW()
       WHERE id = $1`,
      [opts.membershipId],
    );

    const amount = mem.settlement_amount ? parseFloat(mem.settlement_amount) : 0;
    if (mem.home_outlet_id && opts.outletId && mem.home_outlet_id !== opts.outletId && amount > 0) {
      const se = await client.query<{ id: string }>(
        `INSERT INTO settlement_entries (tenant_id, membership_id, usage_id, owing_outlet_id, serving_outlet_id, amount)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [opts.tenantId, opts.membershipId, usage.rows[0]!.id, mem.home_outlet_id, opts.outletId, amount],
      );
      return { accrual: { entryId: se.rows[0]!.id, owingOutletId: mem.home_outlet_id, servingOutletId: opts.outletId, amount } };
    }
    return { accrual: null };
  }

  /**
   * Edit limited fields of an order (customer name/phone/note). Blocked once the
   * order's shift is closed (day-lock). Writes an audit log entry.
   */
  async editOrder(
    orderId: string,
    user: JWTPayload,
    patch: { customerName?: string; customerPhone?: string; note?: string },
  ): Promise<{ id: string }> {
    const cur = await this.pool.query(
      `SELECT o.id, o.shift_id, s.status AS shift_status, o.customer_name, o.customer_phone, o.note
       FROM orders o LEFT JOIN pos_shifts s ON s.id = o.shift_id
       WHERE o.id = $1 AND o.tenant_id = $2`,
      [orderId, user.tenant_id],
    );
    const row = cur.rows[0];
    if (!row) throw new BadRequestException('Order not found');
    if (row.shift_status === 'closed') throw new BadRequestException('Order is day-locked (its shift is closed) and cannot be edited');

    const set: string[] = []; const v: unknown[] = []; let i = 1;
    if (patch.customerName !== undefined) { set.push(`customer_name = $${i++}`); v.push(patch.customerName); }
    if (patch.customerPhone !== undefined) { set.push(`customer_phone = $${i++}`); v.push(patch.customerPhone); }
    if (patch.note !== undefined) { set.push(`note = $${i++}`); v.push(patch.note); }
    if (set.length === 0) throw new BadRequestException('No fields to update');
    set.push('updated_at = NOW()'); v.push(orderId, user.tenant_id);
    await this.pool.query(`UPDATE orders SET ${set.join(', ')} WHERE id = $${i} AND tenant_id = $${i + 1}`, v);

    await this.pool.query(
      `INSERT INTO audit_logs (tenant_id, user_id, operation, entity_type, entity_id, before_value, after_value)
       VALUES ($1, $2, 'order.edit', 'order', $3, $4, $5)`,
      [user.tenant_id, user.sub, orderId,
        JSON.stringify({ customerName: row.customer_name, customerPhone: row.customer_phone, note: row.note }),
        JSON.stringify(patch)],
    );
    return { id: orderId };
  }

  /**
   * Delete (cancel) an order. Blocked once day-locked. Writes an audit log entry.
   *
   * A PAID order cannot be deleted here — money has been collected, so it must go
   * through the cashier `voidOrder` path (which requires a reason, enforces the
   * void-authorization rules, and surfaces the refund warning). deleteOrder is for
   * unpaid/draft orders only; this keeps a single audited path for reversing booked
   * revenue and prevents a silent back-office delete of a settled sale.
   */
  async deleteOrder(orderId: string, user: JWTPayload): Promise<{ id: string }> {
    const cur = await this.pool.query(
      `SELECT o.id, o.status, o.total, o.order_number, s.status AS shift_status
       FROM orders o LEFT JOIN pos_shifts s ON s.id = o.shift_id
       WHERE o.id = $1 AND o.tenant_id = $2`,
      [orderId, user.tenant_id],
    );
    const row = cur.rows[0];
    if (!row) throw new BadRequestException('Order not found');
    if (row.shift_status === 'closed') throw new BadRequestException('Order is day-locked (its shift is closed) and cannot be deleted');
    if (['paid', 'confirmed', 'completed'].includes(row.status)) {
      throw new BadRequestException('This order has been paid. Void it from the POS (a void records the reason and handles the refund) instead of deleting.');
    }

    // Full reversal in one transaction so a cancelled order never lands in a
    // half-state: restock, restore vouchers/tickets/promotions, reverse membership
    // usage + settlement (shared with voidOrder), then flip status + audit atomically.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Only reverse side-effects when transitioning OUT of a non-cancelled state,
      // so a repeated cancel never double-restocks (the restock is the one
      // non-idempotent step; the rest are self-guarding). emitStockAdjusted:true
      // preserves deleteOrder's per-line InventoryStockAdjusted on the domain bus.
      if (row.status !== 'cancelled') {
        await this.reverseOrderSideEffects(client, orderId, row.order_number, user, {
          label: 'Cancel',
          source: 'order_cancel',
          emitStockAdjusted: true,
        });
      }

      await client.query(
        `UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
        [orderId, user.tenant_id],
      );
      await client.query(
        `INSERT INTO audit_logs (tenant_id, user_id, operation, entity_type, entity_id, before_value, after_value)
         VALUES ($1, $2, 'order.delete', 'order', $3, $4, $5)`,
        [user.tenant_id, user.sub, orderId, JSON.stringify({ status: row.status, total: row.total }), JSON.stringify({ status: 'cancelled' })],
      );

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    // Surface the cancellation on the domain bus (AI feed / monitoring). Paid
    // orders are refused above, so this is always an unpaid cancellation: wasPaid
    // is false and the accounting/commission consumers of OrderVoided no-op — but
    // emitting keeps deleteOrder consistent with voidOrder's event surface.
    void this.eventBus?.emit({
      type: DomainEventType.OrderVoided,
      tenantId: user.tenant_id,
      actor: user.sub,
      payload: { orderId, wasPaid: false },
    });
    return { id: orderId };
  }

  /**
   * Fully reverse an order's side-effects inside a caller-supplied transaction:
   * restock recipe stock, restore redeemed voucher codes + roll back their packs,
   * restore shareable voucher tickets, restore promotion quota + drop grants, and
   * reverse membership usage + void its still-pending settlement entries. Shared by
   * voidOrder (POS cashier path) and deleteOrder (back-office path) so both perform
   * an identical, consistent reversal.
   *
   * Every step is idempotent EXCEPT the inventory restock (it always adds stock +
   * writes a sale_return), so callers MUST only invoke this while the order is not
   * already cancelled: voidOrder throws on a cancelled order; deleteOrder guards on
   * `status !== 'cancelled'`.
   *
   * `opts.label` distinguishes the sale_return reason ('Void' vs 'Cancel'). When
   * `opts.emitStockAdjusted` is set, an InventoryStockAdjusted domain event fires
   * once per restocked line (deleteOrder's historical behavior, surfacing the
   * movement to the AI feed / monitoring). voidOrder passes it false so its external
   * event surface stays exactly as before (it never emitted per-line adjustments).
   */
  private async reverseOrderSideEffects(
    client: PoolClient,
    orderId: string,
    orderNumber: string,
    user: JWTPayload,
    opts: { label: string; source?: string; emitStockAdjusted?: boolean },
  ): Promise<void> {
    // 1. Restock recipe stock deducted at sale.
    const moves = await client.query<{ item_id: string; quantity: string }>(
      `SELECT item_id, quantity FROM inventory_movements
       WHERE reference = $1 AND type = 'sale' AND tenant_id = $2`,
      [orderNumber, user.tenant_id],
    );
    for (const m of moves.rows) {
      const qty = parseFloat(m.quantity);
      await client.query(
        `UPDATE inventory_items SET quantity = quantity + $1, updated_at = NOW() WHERE id = $2`,
        [qty, m.item_id],
      );
      await client.query(
        `INSERT INTO inventory_movements (tenant_id, item_id, type, quantity, reason, reference, actor)
         VALUES ($1, $2, 'sale_return', $3, $4, $5, $6)`,
        [user.tenant_id, m.item_id, qty, `${opts.label} ${orderNumber}`, orderNumber, user.sub],
      );
      if (opts.emitStockAdjusted) {
        void this.eventBus?.emit({
          type: DomainEventType.InventoryStockAdjusted,
          tenantId: user.tenant_id,
          actor: user.sub,
          payload: { itemId: m.item_id, type: 'adjustment', quantity: qty, source: opts.source ?? 'order_cancel', reference: orderNumber },
        });
      }
    }

    // 2. Restore redeemed voucher codes + roll back their packs' usage.
    const restored = await client.query<{ pack_id: string }>(
      `UPDATE voucher_codes SET status = 'active', redeemed_at = NULL, order_id = NULL
       WHERE order_id = $1 RETURNING pack_id`,
      [orderId],
    );
    for (const c of restored.rows) {
      await client.query(
        `UPDATE voucher_packs
         SET uses_count = GREATEST(uses_count - 1, 0),
             status = CASE WHEN status = 'fully_redeemed' THEN 'active' ELSE status END,
             updated_at = NOW()
         WHERE id = $1`,
        [c.pack_id],
      );
    }
    // Shareable voucher tickets.
    await client.query(
      `UPDATE voucher_tickets SET status = 'active', redeemed_at = NULL, redeemed_order_id = NULL, redeemed_outlet_id = NULL
       WHERE redeemed_order_id = $1 AND tenant_id = $2`,
      [orderId, user.tenant_id],
    );

    // 3. Restore promotion quota + drop the grant rows for this order.
    const grants = await client.query<{ promotion_id: string }>(
      `SELECT promotion_id FROM promotion_grants WHERE order_id = $1`,
      [orderId],
    );
    for (const g of grants.rows) {
      await client.query(
        `UPDATE promotions SET used_quota = GREATEST(used_quota - 1, 0), updated_at = NOW() WHERE id = $1`,
        [g.promotion_id],
      );
    }
    await client.query(`DELETE FROM promotion_grants WHERE order_id = $1`, [orderId]);

    // 3b. Free the vehicle-queue entry this order was rung up for, so the car can be
    // re-picked from the POS "ambil antrian" queue (the picker hides rows with an
    // order_id). Without this, a cancelled/voided order left its car permanently
    // unpickable even though it is still 'waiting'.
    await client.query(
      `UPDATE vehicle_queue SET order_id = NULL, updated_at = NOW()
       WHERE order_id = $1 AND tenant_id = $2`,
      [orderId, user.tenant_id],
    );

    // 4. Reverse membership usage + void any still-pending settlement it accrued,
    //    and give the lifetime quota back (un-expiring a membership that was
    //    auto-expired by this very wash, as long as it hasn't date-expired).
    const usages = await client.query<{ id: string; membership_id: string }>(
      `UPDATE membership_usages SET reversed = true, reversed_at = NOW()
       WHERE order_id = $1 AND reversed = false RETURNING id, membership_id`,
      [orderId],
    );
    if (usages.rows.length > 0) {
      const ids = usages.rows.map((u) => u.id);
      await client.query(
        `UPDATE settlement_entries SET status = 'void'
         WHERE usage_id = ANY($1::uuid[]) AND status = 'pending'`,
        [ids],
      );
      // Refund one lifetime use per reversed usage, per membership.
      const perMembership = new Map<string, number>();
      for (const u of usages.rows) perMembership.set(u.membership_id, (perMembership.get(u.membership_id) ?? 0) + 1);
      for (const [membershipId, count] of perMembership) {
        await client.query(
          `UPDATE memberships
           SET uses_count = GREATEST(uses_count - $2, 0),
               status = CASE WHEN status = 'expired' AND end_date >= CURRENT_DATE THEN 'active' ELSE status END,
               updated_at = NOW()
           WHERE id = $1 AND tenant_id = $3`,
          [membershipId, count, user.tenant_id],
        );
      }
    }

    // 4b. Cancel any membership this order ACTIVATED (a membership sale/Sell Pack).
    //     Voiding the fee order must not leave a live membership behind.
    await client.query(
      `UPDATE memberships SET status = 'cancelled', updated_at = NOW()
       WHERE order_id = $1 AND tenant_id = $2 AND status <> 'cancelled'`,
      [orderId, user.tenant_id],
    );

    // 4c. Reverse an applied renewal this order performed. The renewal row doesn't
    //     store the prior end_date, so we roll the extension back by the plan's
    //     duration (best-effort; guarded not to fall before the start date).
    const renewals = await client.query<{ membership_id: string; plan_id: string }>(
      `UPDATE membership_renewals SET applied = false, applied_at = NULL
       WHERE order_id = $1 AND tenant_id = $2 AND applied = true
       RETURNING membership_id, plan_id`,
      [orderId, user.tenant_id],
    );
    for (const r of renewals.rows) {
      await client.query(
        `UPDATE memberships m
         SET end_date = GREATEST(m.start_date, (m.end_date - (p.duration_months || ' months')::interval)::date),
             updated_at = NOW()
         FROM membership_plans p
         WHERE m.id = $1 AND p.id = $2 AND m.tenant_id = $3`,
        [r.membership_id, r.plan_id, user.tenant_id],
      );
    }
  }

  /**
   * Issues a one-time 6-digit admin PIN authorizing a void of this order past
   * the free-void window, and emails it to the tenant's owner. Replaces the old
   * static preset (users.admin_pin_hash, seeded "1234") — every PIN is fresh,
   * single-use (consumed_at, set at void time), and expires in
   * VOID_PIN_TTL_MINUTES. Any prior unconsumed PIN for this order is invalidated
   * first, so only the most recently requested PIN is ever valid.
   */
  async requestVoidPin(
    orderId: string,
    user: JWTPayload,
  ): Promise<{ sent: boolean; expiresInMinutes: number }> {
    const cur = await this.pool.query<{ id: string; outlet_id: string | null; order_number: string }>(
      `SELECT id, outlet_id, order_number FROM orders WHERE id = $1 AND tenant_id = $2`,
      [orderId, user.tenant_id],
    );
    const order = cur.rows[0];
    if (!order) throw new BadRequestException('Order not found');

    // Owner delivery targets: email (any active owner) + the tenant's configured
    // WhatsApp escalation/owner line. We deliver on WHATEVER channel is available.
    const ownerRes = await this.pool.query<{ email: string }>(
      `SELECT email FROM users
       WHERE tenant_id = $1 AND role = 'tenant_owner' AND is_active = true
       ORDER BY created_at ASC LIMIT 1`,
      [user.tenant_id],
    );
    const ownerEmail = ownerRes.rows[0]?.email ?? null;
    const waRes = await this.pool.query<{ escalation_number: string | null }>(
      `SELECT escalation_number FROM agent_configs WHERE tenant_id = $1`,
      [user.tenant_id],
    );
    const ownerPhone = waRes.rows[0]?.escalation_number ?? null;

    const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const pinHash = bcrypt.hashSync(pin, 10);
    const expiresAt = new Date(Date.now() + OrderService.VOID_PIN_TTL_MINUTES * 60_000);

    // Invalidate any still-live PIN for this order first — a new request
    // supersedes it rather than leaving two valid codes at once.
    await this.pool.query(
      `UPDATE void_pin_requests SET consumed_at = NOW()
       WHERE tenant_id = $1 AND order_id = $2 AND consumed_at IS NULL`,
      [user.tenant_id, orderId],
    );
    await this.pool.query(
      `INSERT INTO void_pin_requests (tenant_id, outlet_id, order_id, pin_hash, requested_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user.tenant_id, order.outlet_id, orderId, pinHash, user.sub, expiresAt.toISOString()],
    );

    let delivered = false;
    // Primary channel: WhatsApp to the owner/escalation line via the LIVE WAHA
    // free-text integration (the same path booking approvals use) — works today
    // without an approved Business-API template. Mirrors the refund PIN flow.
    if (ownerPhone && this.whatsapp) {
      const text = `Kode PIN void untuk order ${order.order_number}: ${pin}\nBerlaku ${OrderService.VOID_PIN_TTL_MINUTES} menit. Jangan bagikan kode ini.`;
      const ok = await this.whatsapp.sendText(user.tenant_id, ownerPhone, text).catch(() => false);
      if (ok) delivered = true;
      else this.logger.warn(`Void PIN WhatsApp (WAHA) failed for order ${orderId}`);
    }
    // Secondary channel: email.
    if (ownerEmail && this.notification) {
      const em = await this.notification.sendEmail({
        to: ownerEmail,
        subject: `Kode PIN Void — Order ${order.order_number}`,
        body: `Kode PIN void untuk order ${order.order_number}: ${pin}\n\nBerlaku ${OrderService.VOID_PIN_TTL_MINUTES} menit. Jangan bagikan kode ini kepada siapa pun.`,
      });
      if (em.success) delivered = true;
      else this.logger.warn(`Void PIN email failed for order ${orderId}: ${em.error}`);
    }
    if (!ownerPhone && !ownerEmail) {
      throw new BadRequestException('No owner WhatsApp number or email is configured to receive the void PIN');
    }
    // Neither channel is wired yet (no WhatsApp template / no email vendor): log the
    // PIN so the flow still works in dev/demo, mirroring auth.forgotPassword.
    if (!delivered) {
      this.logger.warn(`Void PIN for order ${order.order_number} could not be delivered on any channel; PIN=${pin} (dev/demo fallback — configure a WhatsApp 'void_pin' template or EMAIL_API_* to deliver for real).`);
    }

    return { sent: delivered, expiresInMinutes: OrderService.VOID_PIN_TTL_MINUTES };
  }

  /**
   * Void an order from the POS. Unlike deleteOrder (back-office, OutletAdmin+),
   * this is the cashier-facing path: authorization is decided by the shared
   * void-authorization rules — a reason is always required; within the outlet's
   * free-void window (default 0 min) any cashier may void; after it, an admin PIN
   * is required (owner bypasses). The PIN is the one-time emailed code from
   * requestVoidPin (single-use — consumed here on success), not the old static
   * preset. The reversal (restock, restore vouchers, reverse membership usage +
   * settlement, restore promotion quota, cancel) runs in one transaction. Money
   * already collected is NOT auto-refunded — the caller is told to refund
   * separately (VOID_PAID_WARNING_MESSAGE).
   */
  async voidOrder(
    orderId: string,
    user: JWTPayload,
    input: { reason: string; adminPin?: string },
  ): Promise<{ id: string; showPaidWarning: boolean; paidWarningMessage?: string }> {
    const cur = await this.pool.query(
      `SELECT o.id, o.status, o.total, o.order_number, o.created_at,
              s.status AS shift_status, ot.settings AS outlet_settings
       FROM orders o
       LEFT JOIN pos_shifts s ON s.id = o.shift_id
       LEFT JOIN outlets ot ON ot.id = o.outlet_id
       WHERE o.id = $1 AND o.tenant_id = $2`,
      [orderId, user.tenant_id],
    );
    const row = cur.rows[0];
    if (!row) throw new BadRequestException('Order not found');
    if (row.status === 'cancelled') throw new BadRequestException('Order is already cancelled');
    if (row.shift_status === 'closed') {
      throw new BadRequestException('Order is day-locked (its shift is closed) and cannot be voided');
    }

    const freeWindow = Number(row.outlet_settings?.free_void_window_minutes ?? 0) || 0;

    // Verify the submitted PIN against the latest unconsumed, unexpired
    // one-time PIN issued for this order (requestVoidPin) — the static preset
    // (users.admin_pin_hash) is no longer read here.
    let pinRow: { id: string; pin_hash: string } | null = null;
    if (input.adminPin) {
      const pr = await this.pool.query<{ id: string; pin_hash: string }>(
        `SELECT id, pin_hash FROM void_pin_requests
         WHERE tenant_id = $1 AND order_id = $2 AND consumed_at IS NULL AND expires_at > NOW()
         ORDER BY created_at DESC LIMIT 1`,
        [user.tenant_id, orderId],
      );
      pinRow = pr.rows[0] ?? null;
    }

    const auth = checkVoidAuthorization(
      {
        role: user.role as Role,
        reason: input.reason,
        adminPin: input.adminPin,
        orderCreatedAt: new Date(row.created_at).toISOString(),
        currentTime: new Date().toISOString(),
        freeVoidWindowMinutes: freeWindow,
      },
      (pin) => !!pinRow && bcrypt.compareSync(pin, pinRow.pin_hash),
    );
    if (!auth.authorized) {
      // requiresPin lets the POS reveal the PIN field and retry.
      throw new BadRequestException({
        message: auth.error?.message ?? 'Void not authorized',
        code: auth.error?.code,
        requiresPin: auth.requiresPin,
      });
    }

    const paidStatuses = [OrderStatus.Paid, OrderStatus.Confirmed, OrderStatus.Completed];
    const showPaidWarning = paidStatuses.includes(row.status as OrderStatus);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Steps 1-4: restock, restore vouchers/tickets, restore promotions, reverse
      // membership usage + settlement — shared with deleteOrder. voidOrder is only
      // reached for a non-cancelled order (guarded above), so the non-idempotent
      // restock is safe. emitStockAdjusted:false keeps voidOrder's historical event
      // surface unchanged (it never emitted per-line InventoryStockAdjusted).
      await this.reverseOrderSideEffects(client, orderId, row.order_number, user, {
        label: 'Void',
        emitStockAdjusted: false,
      });

      // 5. Cancel the order.
      await client.query(
        `UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
        [orderId, user.tenant_id],
      );

      // 6. Single-use: consume the one-time PIN so it can't be replayed. Done
      // in the same transaction as the void itself, so a rollback (e.g. a
      // later step throwing) leaves the PIN valid to retry with.
      if (pinRow) {
        await client.query(`UPDATE void_pin_requests SET consumed_at = NOW() WHERE id = $1`, [pinRow.id]);
      }

      // 7. Audit (reason + whether a PIN was used).
      await client.query(
        `INSERT INTO audit_logs (tenant_id, user_id, operation, entity_type, entity_id, before_value, after_value)
         VALUES ($1, $2, 'order.void', 'order', $3, $4, $5)`,
        [
          user.tenant_id, user.sub, orderId,
          JSON.stringify({ status: row.status, total: row.total }),
          JSON.stringify({ status: 'cancelled', reason: input.reason, pinUsed: auth.requiresPin }),
        ],
      );

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    // Reverse the accounting for a voided sale (only paid orders were ever booked).
    // Best-effort, post-commit — the poster reads the order + its (now-voided)
    // settlement entries and posts mirror entries.
    void this.eventBus?.emit({
      type: DomainEventType.OrderVoided,
      tenantId: user.tenant_id,
      actor: user.sub,
      payload: { orderId, wasPaid: showPaidWarning },
    });

    return {
      id: orderId,
      showPaidWarning,
      paidWarningMessage: showPaidWarning ? VOID_PAID_WARNING_MESSAGE : undefined,
    };
  }

  /**
   * Lightweight order status lookup (for POS payment polling).
   */
  async getOrderStatus(
    orderId: string,
    user: JWTPayload,
  ): Promise<{
    id: string; orderNumber: string; status: string; total: number;
    subtotal: number; serviceCharge: number; tax: number; voucherDiscount: number;
    customerName: string | null; customerPhone: string | null;
  } | null> {
    const res = await this.pool.query(
      `SELECT id, order_number, status, total, subtotal, service_charge, tax, voucher_discount,
              customer_name, customer_phone
       FROM orders WHERE id = $1 AND tenant_id = $2`,
      [orderId, user.tenant_id],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      id: row.id, orderNumber: row.order_number, status: row.status, total: parseFloat(row.total),
      subtotal: parseFloat(row.subtotal), serviceCharge: parseFloat(row.service_charge),
      tax: parseFloat(row.tax), voucherDiscount: parseFloat(row.voucher_discount),
      customerName: row.customer_name ?? null, customerPhone: row.customer_phone ?? null,
    };
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
      `SELECT id, name, category, price, is_main_service, is_active, business_unit,
              dynamic_discount_enabled, dynamic_discount_kind, max_discount
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
   * Auto-deduct recipe (BOM) stock for each sold line and freeze a per-unit COGS
   * snapshot on the order line. Runs INSIDE the order transaction so stock and the
   * sale commit atomically. Non-physical cost components (tax/profit/utilities) are
   * folded into the snapshot but never touch inventory. Recipe quantities are
   * converted to each item's stock unit via uom_conversions. Stock may go negative
   * at the POS (allow-and-alert); the customer/kiosk out-of-stock block is separate.
   */
  private async applyRecipeCogs(
    client: PoolClient,
    order: { id: string; orderNumber: string },
    orderItems: Array<{ id: string; serviceId: string; quantity: number; unitPrice: number }>,
    actor: string,
    tenantId: string,
  ): Promise<void> {
    for (const line of orderItems) {
      // Physical components → deduct stock and accumulate per-unit material cost.
      const comps = await client.query<{
        inventory_item_id: string; quantity: string; unit: string; item_unit: string; unit_cost: string;
      }>(
        `SELECT rc.inventory_item_id, rc.quantity, rc.unit, ii.unit AS item_unit, ii.unit_cost
         FROM service_recipe_components rc
         JOIN inventory_items ii ON ii.id = rc.inventory_item_id
         WHERE rc.service_id = $1 AND rc.tenant_id = $2`,
        [line.serviceId, tenantId],
      );

      let materialPerUnit = 0;
      for (const c of comps.rows) {
        const recipeQty = parseFloat(c.quantity);
        const unitCost = parseFloat(c.unit_cost);
        let factor = 1;
        if (c.unit !== c.item_unit) {
          const conv = await client.query<{ factor: string }>(
            `SELECT factor FROM uom_conversions
             WHERE inventory_item_id = $1 AND from_unit = $2 AND to_unit = $3 LIMIT 1`,
            [c.inventory_item_id, c.unit, c.item_unit],
          );
          factor = conv.rows[0] ? parseFloat(conv.rows[0].factor) : 1;
        }
        const perUnitStockQty = recipeQty * factor; // item stock units per 1 product
        const deductQty = perUnitStockQty * line.quantity; // for the whole line
        materialPerUnit += perUnitStockQty * unitCost;

        await client.query(
          `UPDATE inventory_items SET quantity = quantity - $1, updated_at = NOW() WHERE id = $2`,
          [deductQty, c.inventory_item_id],
        );
        await client.query(
          `INSERT INTO inventory_movements (tenant_id, item_id, type, quantity, reason, reference, actor)
           VALUES ($1, $2, 'sale', $3, $4, $5, $6)`,
          [tenantId, c.inventory_item_id, deductQty, `Sale ${order.orderNumber}`, order.orderNumber, actor],
        );
      }

      // Non-physical cost components → add to per-unit COGS (no stock impact).
      const costLines = await client.query<{ value: string; kind: string }>(
        `SELECT scc.value, ct.kind
         FROM service_cost_components scc
         JOIN cost_component_types ct ON ct.id = scc.component_type_id
         WHERE scc.service_id = $1 AND scc.tenant_id = $2`,
        [line.serviceId, tenantId],
      );
      let overheadPerUnit = 0;
      for (const cl of costLines.rows) {
        const v = parseFloat(cl.value);
        overheadPerUnit += cl.kind === 'percentage' ? (line.unitPrice * v) / 100 : v;
      }

      const unitCogs = materialPerUnit + overheadPerUnit;
      await client.query(`UPDATE order_items SET cost_snapshot = $1 WHERE id = $2`, [unitCogs, line.id]);
    }
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
  ): Promise<{ benefits: MembershipBenefit[]; homeOutletId: string | null; settlementAmount: number; quotaWarning?: string }> {
    // Look up the membership and its plan. Benefits require status 'active' AND a
    // paid period that hasn't ended — a date-expired-but-stale-'active' row (or a
    // grace/revoked one) must NOT grant benefits. See MembershipLifecycleService.
    const membershipResult = await this.pool.query<MembershipRow>(
      `SELECT id, plan_id, status, uses_count, max_uses, daily_limit, home_outlet_id
       FROM memberships WHERE id = $1 AND status = 'active' AND end_date >= CURRENT_DATE`,
      [membershipId],
    );

    if (membershipResult.rows.length === 0) {
      return { benefits: [], homeOutletId: null, settlementAmount: 0 };
    }

    const membership = membershipResult.rows[0]!;

    // Quota gate (handbook §5.2): enforce the plan's daily limit and lifetime quota,
    // keyed to the Jakarta business day (resets 00:00 WIB). If the member is over
    // their daily limit or has exhausted their lifetime quota, we grant NO benefit
    // here — pricing then charges the normal price and the POS surfaces the returned
    // quotaWarning. Consumption itself is recorded at payment.
    //
    // IMPORTANT: the daily limit is PER MEMBERSHIP, not per plate. An Unlimited plan
    // covers up to `max_plates` (e.g. 3) vehicles but still allows only `daily_limit`
    // (e.g. 1) free wash PER DAY across ALL of them — washing plate B today consumes
    // the day's allowance for plates B, C and D alike. So we count today's usages for
    // the whole membership (any plate), not just the plate being rung up now.
    const maxUses = membership.max_uses && membership.max_uses > 0 ? membership.max_uses : Number.MAX_SAFE_INTEGER;
    const dailyLimit = membership.daily_limit ?? 1;

    if ((membership.uses_count ?? 0) >= maxUses) {
      return {
        benefits: [],
        homeOutletId: membership.home_outlet_id ?? null,
        settlementAmount: 0,
        quotaWarning: 'Kuota membership sudah habis. Dikenakan harga normal.',
      };
    }

    const dailyUsed = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM membership_usages
       WHERE membership_id = $1 AND reversed = false
         AND (used_at AT TIME ZONE 'Asia/Jakarta')::date = (NOW() AT TIME ZONE 'Asia/Jakarta')::date`,
      [membershipId],
    );
    if ((dailyUsed.rows[0]?.n ?? 0) >= dailyLimit) {
      return {
        benefits: [],
        homeOutletId: membership.home_outlet_id ?? null,
        settlementAmount: 0,
        quotaWarning: 'Membership ini sudah dipakai cuci hari ini — batas harian tercapai (berlaku untuk semua mobil di membership ini). Dikenakan harga normal.',
      };
    }

    // Get the plan details
    const planResult = await this.pool.query<MembershipPlanRow>(
      `SELECT id, name, free_service_ids, discounted_services, settlement_amount
       FROM membership_plans WHERE id = $1`,
      [membership.plan_id],
    );

    if (planResult.rows.length === 0) {
      return { benefits: [], homeOutletId: membership.home_outlet_id ?? null, settlementAmount: 0 };
    }

    const plan = planResult.rows[0]!;

    return {
      benefits: [
        {
          membershipId: membership.id,
          planName: plan.name,
          freeServiceIds: plan.free_service_ids ?? [],
          // Plans store the percentage as entered (1–100); the cart-calculator
          // expects a 0–1 fraction, so convert here. Fixed prices pass through
          // as-is (per-unit Rp). One benefit kind per entry.
          discountedServices: (plan.discounted_services ?? []).map((d) =>
            typeof d.fixedPrice === 'number'
              ? { serviceId: d.serviceId, fixedPrice: Number(d.fixedPrice) }
              : { serviceId: d.serviceId, discountPct: Number(d.discountPct ?? 0) / 100 },
          ),
        },
      ],
      homeOutletId: membership.home_outlet_id ?? null,
      settlementAmount: plan.settlement_amount ? parseFloat(plan.settlement_amount) : 0,
    };
  }

  /**
   * Resolve active promotions applicable to this order. Returns the total
   * discount (fixed/percentage rewards) and the grants to record. Free-product /
   * free-voucher / future-discount rewards are recorded as grants (qty tracked)
   * without altering the current total.
   */
  private async resolvePromotions(
    tenantId: string,
    outletId: string | undefined,
    cartItems: CartItem[],
    subtotal: number,
    opts?: { hasActiveMembership?: boolean; selectedIds?: string[] },
  ): Promise<{ discount: number; grants: Array<{ promotionId: string; amount: number }> }> {
    // Promotions are NO LONGER auto-applied. Apply only what the cashier chose
    // (opts.selectedIds), each re-validated against every eligibility gate here so
    // the server is the source of truth. Empty/absent selection → no promo.
    const selected = new Set(opts?.selectedIds ?? []);
    const evaluated = await this.evaluatePromotions(tenantId, outletId, cartItems, subtotal, !!opts?.hasActiveMembership);
    const chosen = evaluated.filter((e) => e.eligible && selected.has(e.id));
    if (chosen.length === 0) return { discount: 0, grants: [] };

    // Stacking rule: a non-stackable promo applies ALONE. If the cashier picked one
    // (or several) and any is non-stackable, keep only the single best-value promo.
    // Otherwise all chosen (stackable) promos combine.
    const applied = chosen.some((c) => !c.stackable)
      ? [chosen.reduce((best, c) => (c.amount > best.amount ? c : best))]
      : chosen;

    let discount = 0;
    const grants: Array<{ promotionId: string; amount: number }> = [];
    for (const p of applied) {
      const amount = Math.min(p.amount, subtotal - discount);
      discount += Math.max(0, amount);
      grants.push({ promotionId: p.id, amount: Math.max(0, amount) });
      if (discount >= subtotal) break;
    }
    return { discount: Math.min(discount, subtotal), grants };
  }

  /**
   * Evaluate every active promotion against a cart WITHOUT applying anything —
   * returns each promo's computed discount and whether the order currently
   * satisfies its gates (outlet, service trigger, min_purchase, member_only).
   * Shared by the POS promo picker (preview) and checkout (apply).
   */
  private async evaluatePromotions(
    tenantId: string,
    outletId: string | undefined,
    cartItems: CartItem[],
    subtotal: number,
    hasActiveMembership: boolean,
  ): Promise<Array<{
    id: string; name: string; rewardType: string; rewardValue: number; amount: number;
    memberOnly: boolean; stackable: boolean; minPurchase: number; eligible: boolean; reason?: string;
  }>> {
    const res = await this.pool.query<{
      id: string; name: string; reward_type: string; reward_value: string;
      outlet_ids: string[] | null; trigger_service_ids: string[] | null;
      member_only: boolean; stackable: boolean; min_purchase: string;
    }>(
      `SELECT id, name, reward_type, reward_value, outlet_ids, trigger_service_ids,
              member_only, stackable, min_purchase
       FROM promotions
       WHERE tenant_id = $1 AND is_active = true
         AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE
         AND (max_quota IS NULL OR used_quota < max_quota)`,
      [tenantId],
    );
    const cartServiceIds = cartItems.map((ci) => ci.serviceId);
    return res.rows.map((p) => {
      const rewardValue = parseFloat(p.reward_value);
      const minPurchase = parseFloat(p.min_purchase);
      let amount = 0;
      if (p.reward_type === 'discount_fixed') amount = Math.min(rewardValue, subtotal);
      else if (p.reward_type === 'discount_percentage') amount = Math.round((subtotal * rewardValue) / 100);
      let eligible = true;
      let reason: string | undefined;
      if (p.outlet_ids && outletId && !p.outlet_ids.includes(outletId)) { eligible = false; reason = 'Tidak berlaku di cabang ini'; }
      else if (p.trigger_service_ids && p.trigger_service_ids.length > 0 &&
               !p.trigger_service_ids.some((sid) => cartServiceIds.includes(sid))) { eligible = false; reason = 'Layanan tertentu belum ada di keranjang'; }
      else if (minPurchase > 0 && subtotal < minPurchase) { eligible = false; reason = `Min. belanja Rp${minPurchase.toLocaleString('id-ID')}`; }
      else if (p.member_only && !hasActiveMembership) { eligible = false; reason = 'Khusus member aktif'; }
      return {
        id: p.id, name: p.name, rewardType: p.reward_type, rewardValue, amount,
        memberOnly: p.member_only, stackable: p.stackable, minPurchase, eligible, reason,
      };
    });
  }

  /**
   * POS promo picker: given a raw cart, resolve service prices, compute the
   * pre-promo subtotal, and list every promotion with its computed discount +
   * eligibility so the cashier can CONFIRM which to apply. Nothing is written.
   */
  async previewPromotionsForCart(
    tenantId: string,
    outletId: string | undefined,
    items: Array<{ serviceId: string; quantity: number; manualDiscount?: number }>,
    membershipId?: string,
  ) {
    const serviceIds = items.map((i) => i.serviceId);
    const services = await this.lookupServices(serviceIds);
    const cartItems: CartItem[] = items.map((item) => {
      const service = services.get(item.serviceId);
      if (!service) {
        throw new BadRequestException({ statusCode: 400, error: ERR_VALIDATION_FAILED, message: `Service not found: ${item.serviceId}` });
      }
      return {
        serviceId: item.serviceId, serviceName: service.name, quantity: item.quantity,
        unitPrice: parseFloat(service.price), discount: item.manualDiscount ?? 0,
        isMainService: service.is_main_service,
      };
    });
    const subtotal = cartItems.reduce((s, ci) => s + ci.quantity * ci.unitPrice - ci.discount, 0);
    return this.evaluatePromotions(tenantId, outletId, cartItems, Math.max(0, subtotal), !!membershipId);
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

  /**
   * Resolve shareable digital voucher tickets (plaintext codes). Returns the
   * total discount and the codes to redeem. Not customer/plate bound.
   */
  private async resolveDigitalVouchers(
    tenantId: string,
    codes: string[],
    subtotal: number,
    cartItems: CartItem[],
  ): Promise<{ discount: number; codes: string[] }> {
    let discount = 0;
    const out: string[] = [];
    for (const raw of codes) {
      const code = raw.trim().toUpperCase();
      const res = await this.pool.query<{
        status: string; expiry_date: string | null; benefit_type: string;
        benefit_value: string; benefit_service_id: string | null;
      }>(
        `SELECT t.status, t.expiry_date, b.benefit_type, b.benefit_value, b.benefit_service_id
         FROM voucher_tickets t JOIN voucher_books b ON b.id = t.book_id
         WHERE t.tenant_id = $1 AND t.code = $2`,
        [tenantId, code],
      );
      const t = res.rows[0];
      if (!t || t.status !== 'active') continue;
      if (t.expiry_date && new Date(t.expiry_date) < new Date(new Date().toDateString())) continue;
      let amt = 0;
      if (t.benefit_type === 'fixed') {
        amt = Math.min(parseFloat(t.benefit_value), subtotal);
      } else if (t.benefit_type === 'percentage') {
        amt = Math.round((subtotal * parseFloat(t.benefit_value)) / 100);
      } else {
        const svc = cartItems.find((ci) => ci.serviceId === t.benefit_service_id);
        amt = svc ? svc.unitPrice * svc.quantity : parseFloat(t.benefit_value || '0');
      }
      discount += amt;
      out.push(code);
    }
    return { discount, codes: out };
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
   * Gets outlet configuration for service charge, tax percentages, and the
   * cashier's manual-discount cap.
   */
  private async getOutletConfig(outletId: string): Promise<CartConfig> {
    const result = await this.pool.query<{ settings: Record<string, unknown> }>(
      'SELECT settings FROM outlets WHERE id = $1',
      [outletId],
    );

    if (result.rows.length === 0) {
      // Default config if outlet not found
      return { serviceChargePct: 0, taxPct: 0, maxManualDiscountPct: DEFAULT_MAX_MANUAL_DISCOUNT_PCT };
    }

    const settings = result.rows[0]!.settings ?? {};
    return {
      serviceChargePct:
        typeof settings.service_charge_pct === 'number'
          ? settings.service_charge_pct
          : 0,
      taxPct: typeof settings.tax_pct === 'number' ? settings.tax_pct : 0,
      // Owner-configurable per outlet; falls back to a conservative platform
      // default so a line discount is NEVER left uncapped even when the owner
      // hasn't set one (this is the server-side source of truth — the POS UI's
      // own cap is cosmetic only).
      maxManualDiscountPct:
        typeof settings.max_manual_discount_pct === 'number'
          ? settings.max_manual_discount_pct
          : DEFAULT_MAX_MANUAL_DISCOUNT_PCT,
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
