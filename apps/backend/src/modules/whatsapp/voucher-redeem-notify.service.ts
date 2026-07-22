import { Injectable, Inject, Optional, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';
import { WhatsappService } from './whatsapp.service';

const fmtRp = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

/**
 * VoucherRedeemNotifyService — sends the customer a WhatsApp confirmation right
 * after their voucher/ticket is redeemed against an order (order.service /
 * voucher-ticket.service both emit VoucherRedeemed with no phone in the
 * payload, so this re-queries `orders` for it, mirroring PaymentNotifyService).
 */
@Injectable()
export class VoucherRedeemNotifyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VoucherRedeemNotifyService.name);
  private unsubscribes: Array<() => void> = [];

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() private readonly eventBus?: EventBusService,
    @Optional() private readonly whatsapp?: WhatsappService,
  ) {}

  onModuleInit(): void {
    if (this.eventBus) {
      this.unsubscribes.push(
        this.eventBus.on(DomainEventType.VoucherRedeemed, (e) =>
          this.safe(() => this.onVoucherRedeemed(e.tenantId!, e.outletId ?? null,
            e.payload as { orderId: string; orderNumber: string; count: number; discount: number }))),
      );
      this.logger.log('Voucher-redeem notification subscribed (voucher.redeemed)');
    }
  }

  onModuleDestroy(): void {
    this.unsubscribes.forEach((u) => u());
    this.unsubscribes = [];
  }

  private async safe(fn: () => Promise<unknown>): Promise<void> {
    try { await fn(); } catch (e) { this.logger.error(`Voucher-redeem notification failed: ${e instanceof Error ? e.message : e}`); }
  }

  private async onVoucherRedeemed(
    tenantId: string,
    payloadOutletId: string | null,
    payload: { orderId: string; orderNumber: string; count: number; discount: number },
  ): Promise<void> {
    if (!this.whatsapp) return;
    const ord = await this.pool.query<{ customer_phone: string | null; outlet_id: string | null }>(
      `SELECT customer_phone, outlet_id FROM orders WHERE id = $1 AND tenant_id = $2`,
      [payload.orderId, tenantId],
    );
    const o = ord.rows[0];
    if (!o?.customer_phone) return;

    const text =
      `Halo kak! 😊 Voucher kamu berhasil digunakan (x${payload.count}) di transaksi ${payload.orderNumber}, ` +
      `hemat ${fmtRp(Number(payload.discount))}. Terima kasih sudah cuci di AIRE! 🚗✨`;

    await this.whatsapp.sendText(tenantId, o.customer_phone, text, o.outlet_id ?? payloadOutletId ?? null);
  }
}
