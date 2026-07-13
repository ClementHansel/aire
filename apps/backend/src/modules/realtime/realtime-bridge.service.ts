import { Injectable, Optional, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Bridges the domain EventBus to the Socket.IO gateway.
 *
 * Historically the two lived in parallel: services emitted domain events while
 * the gateway's order/payment push methods had no callers, so live dashboards
 * never saw order/payment activity. This subscriber re-broadcasts the relevant
 * domain events into the outlet rooms, making those gateway methods live.
 *
 * Only events that carry a reliable outletId are bridged (room targeting needs
 * it). Failures are swallowed — a push is telemetry, never part of a business
 * transaction.
 */
@Injectable()
export class RealtimeBridge implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeBridge.name);
  private unsubscribes: Array<() => void> = [];

  constructor(
    private readonly gateway: RealtimeGateway,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  onModuleInit(): void {
    if (!this.eventBus) return;
    this.unsubscribes.push(
      this.eventBus.on(DomainEventType.OrderPaid, (e) => {
        const outletId = e.outletId;
        if (!outletId) return;
        const p = e.payload as { orderId: string; paymentMethod?: string };
        this.gateway.emitOrderStatusChanged(outletId, {
          orderId: p.orderId,
          status: 'paid',
          updatedAt: e.createdAt ?? '',
        });
        this.gateway.emitPaymentConfirmed(outletId, {
          orderId: p.orderId,
          method: p.paymentMethod ?? 'unknown',
        });
      }),
      this.eventBus.on(DomainEventType.InventoryLowStock, (e) => {
        const outletId = e.outletId;
        if (!outletId) return; // low-stock alerts without an outlet are skipped
        const p = e.payload as { name: string; quantity: number; reorderLevel: number };
        this.gateway.emitNotificationAlert(outletId, {
          type: 'low_stock',
          message: `Low stock: ${p.name} (${p.quantity} left, reorder at ${p.reorderLevel})`,
          severity: 'warning',
        });
      }),
    );
    this.logger.log('Realtime bridge subscribed (order.paid → socket, inventory.low_stock → socket)');
  }

  onModuleDestroy(): void {
    this.unsubscribes.forEach((u) => u());
    this.unsubscribes = [];
  }
}
