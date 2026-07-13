import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { OrderService } from '../order/order.service';
import { MemberLookupService } from '../membership/member-lookup.service';
import { PaymentService } from '../payment/payment.service';
import { ShiftService } from '../shift/shift.service';
import { KioskService } from './kiosk.service';
import { CreateOrderRequest, JWTPayload, MemberLookupResponse, BusinessUnit } from '@aire/shared';
import { KioskContext } from './kiosk-token.guard';

/** Order payload submitted by a self-service kiosk. */
export interface KioskOrderDto {
  customer: { name: string; phone: string; licensePlate?: string; brand?: string; model?: string };
  items: { serviceId: string; quantity: number }[];
  businessUnit?: BusinessUnit;
  /** Attached when the customer identified themselves as a member (member pricing). */
  membershipId?: string;
  selectedPlate?: string;
}

/**
 * Self-service kiosk order flow. Reuses OrderService.createOrder (so pricing,
 * tax, vouchers and member pricing are IDENTICAL to the POS) by synthesizing a
 * per-tenant "Kiosk" operator, then places the car on the shared queue board.
 * Payment is either taken now (QRIS) or deferred to the cashier — in both cases
 * the order lands on the board and the paid/unpaid badge is derived from it.
 */
@Injectable()
export class KioskOrderService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly orderService: OrderService,
    private readonly memberLookup: MemberLookupService,
    private readonly paymentService: PaymentService,
    private readonly kioskService: KioskService,
    private readonly shiftService: ShiftService,
  ) {}

  /**
   * Identify a member from a scanned/typed value: license plate, phone, or
   * membership id (e.g. a QR encoding one of these). Returns null for walk-ins.
   */
  async identify(tenantId: string, q: string): Promise<MemberLookupResponse | null> {
    const value = (q ?? '').trim();
    if (!value) return null;

    // Plate (most common) → phone → 12-char membership number → membership UUID.
    const byPlate = await this.memberLookup.lookupByPlate(tenantId, value);
    if (byPlate) return byPlate;
    const byPhone = await this.memberLookup.lookupByPhone(tenantId, value);
    if (byPhone) return byPhone;
    const byNumber = await this.memberLookup.lookupByMembershipNumber(tenantId, value);
    if (byNumber) return byNumber;
    if (/^[0-9a-f-]{36}$/i.test(value)) {
      const r = await this.pool.query<{ customer_id: string }>(
        `SELECT customer_id FROM memberships WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [value, tenantId],
      );
      if (r.rows[0]) return this.memberLookup.buildMemberResponse(r.rows[0].customer_id, tenantId);
    }
    return null;
  }

  async createOrder(ctx: KioskContext, dto: KioskOrderDto) {
    // Interface-aware out-of-stock block: the kiosk cannot sell products whose
    // recipe can't be fulfilled from current stock (the POS is not gated).
    const outOfStock = await this.kioskService.getOutOfStockServiceIds(ctx.tenantId);
    const blocked = (dto.items ?? []).filter((i) => outOfStock.has(i.serviceId));
    if (blocked.length > 0) {
      throw new BadRequestException('Some selected items are out of stock. Please remove them or ask the cashier.');
    }

    // Kiosk orders must be booked into the branch's open cashier shift so they
    // stay true to finance. No open shift at this branch → the counter is closed.
    const shift = await this.shiftService.resolveBranchShift(ctx.tenantId, ctx.outletId);
    if (!shift) {
      throw new BadRequestException('The counter is closed right now. Please see the cashier.');
    }

    const operatorId = await this.ensureKioskUser(ctx.tenantId);
    const kioskUser: JWTPayload = {
      sub: operatorId,
      tenant_id: ctx.tenantId,
      outlet_id: ctx.outletId,
      role: 'cashier',
      iat: 0,
      exp: 0,
    };

    const req: CreateOrderRequest = {
      customer: dto.customer,
      items: dto.items,
      businessUnit: dto.businessUnit,
      membershipId: dto.membershipId,
      selectedPlate: dto.selectedPlate,
      operatingOutletId: ctx.outletId,
      channel: 'kiosk',
    };
    const created = await this.orderService.createOrder(req, kioskUser, { shift });

    // Put the car on the queue board (unpaid until paid at kiosk or cashier).
    const plate = dto.customer.licensePlate ?? dto.selectedPlate ?? null;
    const posRes = await this.pool.query<{ next: number }>(
      `SELECT COALESCE(MAX(position), 0) + 1 AS next FROM vehicle_queue
       WHERE outlet_id = $1 AND status IN ('waiting','serving')`,
      [ctx.outletId],
    );
    await this.pool.query(
      `INSERT INTO vehicle_queue
        (tenant_id, outlet_id, plate, brand, model, customer_name, customer_phone, business_unit, position, order_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        ctx.tenantId, ctx.outletId, plate, dto.customer.brand ?? null, dto.customer.model ?? null,
        dto.customer.name, dto.customer.phone, dto.businessUnit ?? 'AIRE',
        posRes.rows[0]?.next ?? 1, created.id,
      ],
    );

    return created;
  }

  /** Start a QRIS charge (pay-now). Webhook confirmation flips the order to paid. */
  async charge(ctx: KioskContext, orderId: string) {
    return this.paymentService.createQrisCharge(ctx.tenantId, orderId);
  }

  /** Poll order status while the kiosk waits for QRIS confirmation. */
  async status(ctx: KioskContext, orderId: string) {
    const res = await this.pool.query<{ order_number: string; status: string; total: string }>(
      `SELECT order_number, status, total FROM orders
       WHERE id = $1 AND tenant_id = $2 AND outlet_id = $3 LIMIT 1`,
      [orderId, ctx.tenantId, ctx.outletId],
    );
    const r = res.rows[0];
    if (!r) throw new NotFoundException('Order not found');
    return { orderNumber: r.order_number, status: r.status, total: parseFloat(r.total) };
  }

  /**
   * A per-tenant "Kiosk" operator user, satisfying orders.operator_id NOT NULL.
   * Login-disabled (unusable password hash). Created lazily so every tenant —
   * including ones provisioned after this feature shipped — is covered.
   */
  private async ensureKioskUser(tenantId: string): Promise<string> {
    const email = `kiosk+${tenantId}@kiosk.local`;
    const existing = await this.pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      [email],
    );
    if (existing.rows[0]) return existing.rows[0].id;

    const inserted = await this.pool.query<{ id: string }>(
      `INSERT INTO users (tenant_id, outlet_id, email, password_hash, name, role, is_active)
       VALUES ($1, NULL, $2, '!kiosk-no-login', 'Kiosk', 'cashier', true)
       ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [tenantId, email],
    );
    return inserted.rows[0]!.id;
  }
}
