import { Injectable, Inject, Optional, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';
import { NotificationService, NotificationType } from '../notification/notification.service';

/**
 * MembershipWelcomeService — sends the "welcome to the plan" WhatsApp message
 * on membership activation, when the plan has `whatsapp_welcome_enabled`.
 *
 * Subscribes to MembershipActivated rather than being called inline from
 * MembershipSellService, mirroring VoucherNotifyService/CampaignGrantService:
 * a notification failure must never roll back the activation.
 *
 * Idempotency: a `welcome_sent` membership_events row is recorded once the
 * send is queued, and checked before queueing again — so re-delivery of the
 * same MembershipActivated event never double-sends.
 *
 * Requirement 14.6 (NotificationService): "Send welcome message to customer's
 * phone on membership activation."
 */
@Injectable()
export class MembershipWelcomeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MembershipWelcomeService.name);
  private unsubscribes: Array<() => void> = [];

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() private readonly eventBus?: EventBusService,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  onModuleInit(): void {
    if (this.eventBus) {
      this.unsubscribes.push(
        this.eventBus.on(DomainEventType.MembershipActivated, (e) =>
          this.safe(() =>
            this.onMembershipActivated(e.tenantId!, e.payload as { membershipId: string; planId: string; endDate?: string }),
          )),
      );
      this.logger.log('Membership welcome message subscribed (membership.activated)');
    }
  }

  onModuleDestroy(): void {
    this.unsubscribes.forEach((u) => u());
    this.unsubscribes = [];
  }

  private async safe(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.logger.error(`Membership welcome message failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  private async onMembershipActivated(
    tenantId: string,
    payload: { membershipId: string; planId: string },
  ): Promise<void> {
    if (!this.notifications) return;

    // Idempotency: never queue the welcome message twice for the same membership.
    const already = await this.pool.query(
      `SELECT 1 FROM membership_events WHERE membership_id = $1 AND event_type = 'welcome_sent'`,
      [payload.membershipId],
    );
    if (already.rows.length > 0) return;

    const res = await this.pool.query<{
      whatsapp_welcome_enabled: boolean;
      plan_name: string;
      end_date: string;
      customer_name: string | null;
      customer_phone: string | null;
    }>(
      `SELECT mp.whatsapp_welcome_enabled, mp.name AS plan_name,
              m.end_date::text AS end_date, c.name AS customer_name, c.phone AS customer_phone
       FROM memberships m
       JOIN membership_plans mp ON mp.id = m.plan_id
       JOIN customers c ON c.id = m.customer_id
       WHERE m.id = $1 AND m.tenant_id = $2`,
      [payload.membershipId, tenantId],
    );
    const row = res.rows[0];
    if (!row?.whatsapp_welcome_enabled || !row.customer_phone) return;

    await this.notifications.queueNotification(NotificationType.MembershipWelcome, {
      phone: row.customer_phone,
      customerName: row.customer_name ?? '',
      planName: row.plan_name,
      endDate: row.end_date,
      tenantId,
    });

    // Record after enqueue so a re-delivered event never double-sends (delivery
    // itself is fire-and-forget; a failed send is logged by NotificationService).
    await this.pool.query(
      `INSERT INTO membership_events (tenant_id, membership_id, event_type, payload, actor)
       VALUES ($1, $2, 'welcome_sent', $3, NULL)`,
      [tenantId, payload.membershipId, JSON.stringify({ planId: payload.planId })],
    );
  }
}
