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
      this.eventBus.on(DomainEventType.FeedbackAlert, (e) => {
        const outletId = e.outletId;
        if (!outletId) return;
        const p = e.payload as { rating?: number; nps?: number; reason?: string };
        this.gateway.emitNotificationAlert(outletId, {
          type: 'feedback_alert',
          message: p.reason === 'detractor'
            ? `Detractor feedback received (NPS ${p.nps ?? '?'})`
            : `Low rating received (${p.rating ?? '?'}★)`,
          severity: 'warning',
        });
      }),
      this.eventBus.on(DomainEventType.DeviceOffline, (e) => {
        const outletId = e.outletId;
        if (!outletId) return;
        const p = e.payload as { bridgeId: string };
        this.gateway.emitNotificationAlert(outletId, {
          type: 'device_offline',
          message: `Branch bridge went offline (${p.bridgeId})`,
          severity: 'error',
        });
      }),
      this.eventBus.on(DomainEventType.DeviceOnline, (e) => {
        const outletId = e.outletId;
        if (!outletId) return;
        const p = e.payload as { bridgeId: string };
        this.gateway.emitNotificationAlert(outletId, {
          type: 'device_online',
          message: `Branch bridge back online (${p.bridgeId})`,
          severity: 'info',
        });
      }),
      this.eventBus.on(DomainEventType.BookingCreated, (e) => {
        const outletId = e.outletId;
        if (!outletId) return;
        const p = e.payload as { customerName?: string; scheduledAt?: string };
        const when = p.scheduledAt ? new Date(p.scheduledAt).toLocaleString('id-ID') : '';
        this.gateway.emitNotificationAlert(outletId, {
          type: 'booking_created',
          message: `New booking: ${p.customerName ?? 'customer'}${when ? ` @ ${when}` : ''}`,
          severity: 'info',
        });
      }),
      this.eventBus.on(DomainEventType.BookingCancelled, (e) => {
        const outletId = e.outletId;
        if (!outletId) return; // deletes carry no outlet; only status→cancelled updates do
        const p = e.payload as { bookingId: string };
        this.gateway.emitNotificationAlert(outletId, {
          type: 'booking_cancelled',
          message: `Booking cancelled (${p.bookingId})`,
          severity: 'warning',
        });
      }),
    );
    this.logger.log('Realtime bridge subscribed (order.paid, low_stock, feedback_alert, device on/offline, booking created/cancelled → socket)');
  }

  onModuleDestroy(): void {
    this.unsubscribes.forEach((u) => u());
    this.unsubscribes = [];
  }
}
