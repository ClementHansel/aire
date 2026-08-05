import { Injectable, Inject, Optional, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { MembershipStatus } from '@aire/shared';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';
import { MembershipSellService } from './membership-sell.service';

/**
 * Activates a freshly-sold membership the moment its fee order is paid.
 *
 * Why this exists: a membership is created 'pending' by the sale and only
 * becomes usable on activation, which sets the term, issues the membership
 * number, and emits MembershipActivated (the event campaign bonus vouchers and
 * the welcome WhatsApp hang off). Activation used to be reachable ONLY through
 * a POS modal the cashier had to complete — and the response field that modal
 * was gated on was always null, so in practice nothing ever activated: members
 * sat 'pending' forever with no number, no plates, no benefits and no bonus
 * voucher (AIRIN-138/140/142/143).
 *
 * Payment is the correct trigger: the customer has paid for the term, so the
 * term starts, with no cashier step in between. Registering extra vehicles
 * stays a separate, optional action.
 *
 * Subscribes to OrderPaid rather than being called inline from OrderService:
 * MembershipModule already imports OrderModule, so the reverse dependency would
 * be circular — and this must never be able to roll back a settled payment.
 * Both settlement paths (POS payOrder and the gateway webhook) emit OrderPaid,
 * so QRIS sales activate too.
 */
@Injectable()
export class MembershipActivationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MembershipActivationService.name);
  private unsubscribes: Array<() => void> = [];

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly sell: MembershipSellService,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  onModuleInit(): void {
    if (!this.eventBus) return;
    this.unsubscribes.push(
      this.eventBus.on(DomainEventType.OrderPaid, (e) =>
        this.safe(() => this.onOrderPaid(e.tenantId!, (e.payload as { orderId: string }).orderId))),
    );
    this.logger.log('Membership activation-on-payment subscribed (order.paid)');
  }

  onModuleDestroy(): void {
    this.unsubscribes.forEach((u) => u());
    this.unsubscribes = [];
  }

  private async safe(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.logger.error(`Membership activation on payment failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * Activate the pending membership sold on this order, if any. A no-op for the
   * overwhelming majority of orders (no membership sold) and for a membership
   * already activated — the status filter is the idempotency guard, so a
   * duplicate OrderPaid can't restart a term.
   */
  async onOrderPaid(tenantId: string, orderId: string): Promise<boolean> {
    const res = await this.pool.query<{
      id: string;
      license_plate: string | null;
      plate_normalized: string | null;
      vehicle_brand: string | null;
      vehicle_model: string | null;
    }>(
      `SELECT m.id, o.license_plate, o.plate_normalized, o.vehicle_brand, o.vehicle_model
       FROM memberships m
       JOIN orders o ON o.id = m.order_id
       WHERE m.order_id = $1 AND m.tenant_id = $2 AND m.status = $3`,
      [orderId, tenantId, MembershipStatus.Pending],
    );
    const row = res.rows[0];
    if (!row) return false;

    // The sale already registers the order's car, so this list is normally a
    // no-op dedupe. It still matters for callers that create the membership
    // without a plate (portal/kiosk): the vehicle on the paid order is the best
    // evidence of which car the membership is for.
    const plate = row.plate_normalized ?? row.license_plate;
    const plates = plate
      ? [{ plate, brand: row.vehicle_brand ?? undefined, model: row.vehicle_model ?? undefined }]
      : [];

    await this.sell.activateMembership(row.id, { plates }, tenantId);
    this.logger.log(`Membership ${row.id} activated on payment of order ${orderId}`);
    return true;
  }
}
