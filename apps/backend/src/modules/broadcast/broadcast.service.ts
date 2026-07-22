import {
  Injectable,
  Inject,
  Optional,
  Logger,
  BadRequestException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { JobMonitorService } from '../job-monitor';

/* eslint-disable @typescript-eslint/no-non-null-assertion */

/** Auto-broadcast scheduler sweep cadence — at boot, then every minute. */
const SCHEDULE_SWEEP_MS = 60 * 1000;

export type AudienceSegment = 'all' | 'members_active' | 'members_expired' | 'tag';

export interface AudienceFilter {
  segment: AudienceSegment;
  tag?: string | null;
  outletId?: string | null;
}

export interface CreateCampaignDto {
  name: string;
  message: string;
  audienceFilter: AudienceFilter;
  throttlePerMin?: number;
  scheduledAt?: string | null;
}

export interface UpdateCampaignDto {
  name?: string;
  message?: string;
  audienceFilter?: AudienceFilter;
  throttlePerMin?: number;
  scheduledAt?: string | null;
}

export interface StartCampaignDto {
  acknowledgedRisk: boolean;
  includeNoConsent?: boolean;
}

interface ResolvedRecipient {
  customerId: string;
  name: string | null;
  phone: string;
  waConsent: boolean;
}

const CAMPAIGN_COLS = `id, tenant_id, name, message, audience_filter, status, scheduled_at,
  throttle_per_min, include_no_consent, acknowledged_risk, total_recipients,
  sent_count, failed_count, skipped_count, created_by, created_at, updated_at,
  started_at, completed_at`;

/**
 * BroadcastService — WhatsApp marketing campaign blast.
 *
 * Resolves an opt-in audience from customers (deduped by normalized phone),
 * materializes a per-recipient queue, and sends through WhatsappService at a
 * paced throttle (messages/min). WhatsappService already honours WAHA_MOCK, so
 * a dry-run records to wa_mock_outbox instead of hitting the gateway.
 *
 * Ban-risk safeguards (consent filter, throttle, must-acknowledge) are enforced
 * here; the paced async sender never blocks the request and is resilient
 * (per-recipient try/catch) and pausable (it stops when status leaves 'sending').
 */
@Injectable()
export class BroadcastService implements OnModuleInit {
  private readonly logger = new Logger(BroadcastService.name);
  /** Campaign ids with an in-flight sender loop (double-start guard). */
  private readonly running = new Set<string>();
  /** Overlap guard for the scheduled-campaign sweep. */
  private schedulerSweeping = false;

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly whatsapp: WhatsappService,
    @Optional() private readonly eventBus?: EventBusService,
    @Optional() private readonly jobMonitor?: JobMonitorService,
  ) {}

  onModuleInit(): void {
    // Promote due 'scheduled' campaigns to 'sending' at boot, then every minute.
    // Dependency-free (no @nestjs/schedule), overlap-guarded, and unref'd so it
    // never holds the process open — mirrors WhatsappService's approval SLA sweep.
    void this.runScheduledSweep().catch((e) => this.logger.warn(`initial broadcast scheduler sweep failed: ${String(e)}`));
    setInterval(() => {
      void this.runScheduledSweep().catch((e) => this.logger.warn(`broadcast scheduler sweep failed: ${String(e)}`));
    }, SCHEDULE_SWEEP_MS).unref?.();
  }

  /**
   * Auto-broadcast scheduler: promotes every 'scheduled' campaign whose
   * scheduled_at has arrived (any tenant) to 'sending' via the same
   * materialize-recipients-then-runSender flow startCampaign uses. Safe to call
   * manually (idempotent, overlap-guarded — re-checks each row's status is still
   * 'scheduled' right before starting it, so a manual start/cancel always wins a race).
   */
  async runScheduledSweep(): Promise<number> {
    if (this.schedulerSweeping) return 0;
    this.schedulerSweeping = true;
    const start = Date.now();
    let started = 0;
    try {
      const due = await this.pool.query<{ id: string; tenant_id: string }>(
        `SELECT id, tenant_id FROM broadcast_campaigns
         WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= NOW()`,
      );
      for (const d of due.rows) {
        if (this.running.has(d.id)) continue; // already has a sender loop somehow
        try {
          const row = await this.loadCampaign(d.tenant_id, d.id);
          if (row.status !== 'scheduled') continue; // raced with a manual start/cancel
          const includeNoConsent = String(row.include_no_consent) === 'true';
          await this.beginSending(d.tenant_id, d.id, row, includeNoConsent);
          started++;
        } catch (e) {
          this.logger.warn(`Broadcast auto-start failed for campaign ${d.id}: ${e instanceof Error ? e.message : e}`);
        }
      }
      if (started) this.logger.log(`Auto-broadcast scheduler: started ${started} campaign(s)`);
      void this.jobMonitor?.recordRun('broadcast-scheduler', {
        label: 'Auto-broadcast scheduler', status: 'ok',
        detail: `${started} campaign(s) started`,
        durationMs: Date.now() - start, intervalMs: SCHEDULE_SWEEP_MS,
      });
      return started;
    } catch (e) {
      void this.jobMonitor?.recordRun('broadcast-scheduler', {
        label: 'Auto-broadcast scheduler', status: 'error',
        detail: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - start, intervalMs: SCHEDULE_SWEEP_MS,
      });
      throw e;
    } finally {
      this.schedulerSweeping = false;
    }
  }

  // ─── CRUD ───────────────────────────────────────────────────────────────────

  async createCampaign(tenantId: string, dto: CreateCampaignDto, actor?: string): Promise<Record<string, unknown>> {
    const name = (dto.name ?? '').trim();
    const message = (dto.message ?? '').trim();
    if (!name) throw new BadRequestException('name is required');
    if (!message) throw new BadRequestException('message is required');
    const filter = this.normalizeFilter(dto.audienceFilter);
    const throttle = this.normalizeThrottle(dto.throttlePerMin);
    const status = dto.scheduledAt ? 'scheduled' : 'draft';
    const res = await this.pool.query(
      `INSERT INTO broadcast_campaigns (tenant_id, name, message, audience_filter, status, scheduled_at, throttle_per_min, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${CAMPAIGN_COLS}`,
      [tenantId, name, message, JSON.stringify(filter), status, dto.scheduledAt ?? null, throttle, actor ?? null],
    );
    return this.mapCampaign(res.rows[0]!);
  }

  async listCampaigns(tenantId: string): Promise<Record<string, unknown>[]> {
    const res = await this.pool.query(
      `SELECT ${CAMPAIGN_COLS} FROM broadcast_campaigns WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [tenantId],
    );
    return res.rows.map((r) => this.mapCampaign(r));
  }

  async getCampaign(tenantId: string, id: string): Promise<Record<string, unknown>> {
    const row = await this.loadCampaign(tenantId, id);
    // Live recipient status counts (authoritative once materialized).
    const counts = await this.pool.query<{ status: string; n: string }>(
      `SELECT status, COUNT(*) AS n FROM broadcast_recipients WHERE campaign_id = $1 GROUP BY status`,
      [id],
    );
    const byStatus: Record<string, number> = { queued: 0, sent: 0, failed: 0, skipped_no_consent: 0 };
    let total = 0;
    for (const c of counts.rows) {
      const n = parseInt(c.n, 10) || 0;
      byStatus[c.status] = n;
      total += n;
    }
    return { ...this.mapCampaign(row), recipientCounts: { ...byStatus, total } };
  }

  async updateCampaign(tenantId: string, id: string, dto: UpdateCampaignDto): Promise<Record<string, unknown>> {
    const row = await this.loadCampaign(tenantId, id);
    if (row.status !== 'draft' && row.status !== 'scheduled') {
      throw new BadRequestException('Only draft/scheduled campaigns can be edited');
    }
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (dto.name !== undefined) {
      if (!dto.name.trim()) throw new BadRequestException('name cannot be empty');
      set('name', dto.name.trim());
    }
    if (dto.message !== undefined) {
      if (!dto.message.trim()) throw new BadRequestException('message cannot be empty');
      set('message', dto.message.trim());
    }
    if (dto.audienceFilter !== undefined) set('audience_filter', JSON.stringify(this.normalizeFilter(dto.audienceFilter)));
    if (dto.throttlePerMin !== undefined) set('throttle_per_min', this.normalizeThrottle(dto.throttlePerMin));
    if (dto.scheduledAt !== undefined) {
      set('scheduled_at', dto.scheduledAt ?? null);
      set('status', dto.scheduledAt ? 'scheduled' : 'draft');
    }
    if (sets.length === 0) throw new BadRequestException('Nothing to update');
    sets.push('updated_at = NOW()');
    params.push(id, tenantId);
    const res = await this.pool.query(
      `UPDATE broadcast_campaigns SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND tenant_id = $${params.length} RETURNING ${CAMPAIGN_COLS}`,
      params,
    );
    return this.mapCampaign(res.rows[0]!);
  }

  async cancelCampaign(tenantId: string, id: string): Promise<Record<string, unknown>> {
    const row = await this.loadCampaign(tenantId, id);
    if (row.status === 'completed' || row.status === 'cancelled') {
      throw new BadRequestException(`Campaign already ${row.status}`);
    }
    const res = await this.pool.query(
      `UPDATE broadcast_campaigns SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING ${CAMPAIGN_COLS}`,
      [id, tenantId],
    );
    this.running.delete(id); // sender loop will observe status != 'sending' and stop
    return this.mapCampaign(res.rows[0]!);
  }

  // ─── Audience ─────────────────────────────────────────────────────────────

  async previewAudience(
    tenantId: string,
    filter: AudienceFilter,
    includeNoConsent = false,
  ): Promise<{ total: number; consented: number; excludedNoConsent: number }> {
    const recipients = await this.resolveAudience(tenantId, this.normalizeFilter(filter));
    const total = recipients.length;
    const consented = recipients.filter((r) => r.waConsent).length;
    const excludedNoConsent = includeNoConsent ? 0 : total - consented;
    return { total, consented, excludedNoConsent };
  }

  /** Resolve recipients from customers for a segment, deduped by normalized phone. */
  private async resolveAudience(tenantId: string, filter: AudienceFilter): Promise<ResolvedRecipient[]> {
    const where: string[] = ['c.tenant_id = $1', "COALESCE(c.phone_normalized, '') <> ''"];
    const params: unknown[] = [tenantId];

    if (filter.segment === 'members_active') {
      where.push(
        `EXISTS (SELECT 1 FROM memberships m WHERE m.customer_id = c.id AND m.status = 'active' AND m.end_date >= CURRENT_DATE)`,
      );
    } else if (filter.segment === 'members_expired') {
      where.push(`EXISTS (SELECT 1 FROM memberships m WHERE m.customer_id = c.id)`);
      where.push(
        `NOT EXISTS (SELECT 1 FROM memberships m WHERE m.customer_id = c.id AND m.status = 'active' AND m.end_date >= CURRENT_DATE)`,
      );
    } else if (filter.segment === 'tag') {
      if (!filter.tag) throw new BadRequestException('tag is required for the tag segment');
      params.push(filter.tag);
      // Customer-level tags do not exist; a customer matches if any of their
      // (non-cancelled) orders carries the tag.
      where.push(
        `EXISTS (SELECT 1 FROM orders o JOIN order_tags ot ON ot.order_id = o.id
                 WHERE o.customer_id = c.id AND o.status <> 'cancelled' AND ot.tag = $${params.length})`,
      );
    }

    if (filter.outletId) {
      params.push(filter.outletId);
      where.push(
        `EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.outlet_id = $${params.length} AND o.status <> 'cancelled')`,
      );
    }

    const res = await this.pool.query<{ id: string; name: string | null; phone: string; phone_normalized: string; wa_consent: boolean }>(
      `SELECT c.id, c.name, c.phone, c.phone_normalized, c.wa_consent
       FROM customers c WHERE ${where.join(' AND ')}`,
      params,
    );

    // Dedupe by normalized phone; prefer a consented row so opt-in isn't lost.
    const byPhone = new Map<string, ResolvedRecipient>();
    for (const r of res.rows) {
      const key = r.phone_normalized;
      const existing = byPhone.get(key);
      if (!existing || (!existing.waConsent && r.wa_consent)) {
        byPhone.set(key, { customerId: r.id, name: r.name, phone: r.phone, waConsent: r.wa_consent });
      }
    }
    return [...byPhone.values()];
  }

  // ─── Start / pause / resume ─────────────────────────────────────────────────

  async startCampaign(tenantId: string, id: string, dto: StartCampaignDto): Promise<Record<string, unknown>> {
    if (dto?.acknowledgedRisk !== true) {
      throw new BadRequestException('You must acknowledge the WhatsApp policy & ban risk before sending');
    }
    const row = await this.loadCampaign(tenantId, id);
    if (row.status === 'sending') throw new BadRequestException('Campaign is already sending');
    if (row.status === 'completed' || row.status === 'cancelled') {
      throw new BadRequestException(`Campaign already ${row.status}`);
    }
    if (this.running.has(id)) throw new BadRequestException('Campaign is already sending');

    const includeNoConsent = dto.includeNoConsent === true;
    await this.beginSending(tenantId, id, row, includeNoConsent);
    return this.getCampaign(tenantId, id);
  }

  /**
   * Resolve the audience, materialize the recipient queue, flip the campaign to
   * 'sending', emit BroadcastStarted, and fire off the paced sender. Shared by
   * the manual /start endpoint and the auto-broadcast scheduler sweep so both
   * paths promote a campaign through the exact same machinery.
   */
  private async beginSending(
    tenantId: string,
    id: string,
    row: Record<string, string>,
    includeNoConsent: boolean,
  ): Promise<void> {
    const filter = this.normalizeFilter(row.audience_filter);
    const recipients = await this.resolveAudience(tenantId, filter);

    let skipped = 0;
    // Materialize the recipient queue from the resolved audience.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM broadcast_recipients WHERE campaign_id = $1`, [id]);
      for (const r of recipients) {
        const status = r.waConsent || includeNoConsent ? 'queued' : 'skipped_no_consent';
        if (status === 'skipped_no_consent') skipped++;
        await client.query(
          `INSERT INTO broadcast_recipients (campaign_id, tenant_id, customer_id, name, phone, status)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [id, tenantId, r.customerId, r.name, r.phone, status],
        );
      }
      await client.query(
        `UPDATE broadcast_campaigns
         SET status = 'sending', acknowledged_risk = true, include_no_consent = $2,
             total_recipients = $3, sent_count = 0, failed_count = 0, skipped_count = $4,
             started_at = NOW(), completed_at = NULL, updated_at = NOW()
         WHERE id = $1`,
        [id, includeNoConsent, recipients.length, skipped],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    void this.eventBus?.emit({
      type: DomainEventType.BroadcastStarted,
      tenantId,
      payload: { campaignId: id, totalRecipients: recipients.length, queued: recipients.length - skipped, skipped },
    });

    // Fire-and-forget paced sender — must NOT block the request.
    void this.runSender(tenantId, id, String(row.message), Number(row.throttle_per_min));
  }

  async pauseCampaign(tenantId: string, id: string): Promise<Record<string, unknown>> {
    const row = await this.loadCampaign(tenantId, id);
    if (row.status !== 'sending') throw new BadRequestException('Only a sending campaign can be paused');
    await this.pool.query(
      `UPDATE broadcast_campaigns SET status = 'paused', updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    // The sender loop re-reads status each iteration and stops on its own.
    return this.getCampaign(tenantId, id);
  }

  async resumeCampaign(tenantId: string, id: string): Promise<Record<string, unknown>> {
    const row = await this.loadCampaign(tenantId, id);
    if (row.status !== 'paused') throw new BadRequestException('Only a paused campaign can be resumed');
    if (this.running.has(id)) throw new BadRequestException('Campaign sender already running');
    await this.pool.query(
      `UPDATE broadcast_campaigns SET status = 'sending', updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    void this.runSender(tenantId, id, String(row.message), Number(row.throttle_per_min));
    return this.getCampaign(tenantId, id);
  }

  /**
   * Paced background sender. Concurrency is capped to 1 with a delay of
   * 60000/throttle ms between sends. Re-reads campaign status each iteration so
   * pause/cancel stop it. Each recipient is sent inside try/catch — a failed
   * send marks that recipient failed and the loop continues.
   */
  private async runSender(tenantId: string, id: string, message: string, throttlePerMin: number): Promise<void> {
    if (this.running.has(id)) return;
    this.running.add(id);
    const delayMs = Math.max(1, Math.round(60000 / this.normalizeThrottle(throttlePerMin)));
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const statusRes = await this.pool.query<{ status: string }>(
          `SELECT status FROM broadcast_campaigns WHERE id = $1 AND tenant_id = $2`,
          [id, tenantId],
        );
        const status = statusRes.rows[0]?.status;
        if (status !== 'sending') break; // paused / cancelled / gone

        const next = await this.pool.query<{ id: string; name: string | null; phone: string }>(
          `SELECT id, name, phone FROM broadcast_recipients
           WHERE campaign_id = $1 AND status = 'queued' ORDER BY created_at ASC LIMIT 1`,
          [id],
        );
        const recipient = next.rows[0];
        if (!recipient) break; // nothing left to send

        const text = message.replace(/\{name\}/g, recipient.name ?? '');
        let ok = false;
        let error: string | null = null;
        try {
          ok = await this.whatsapp.sendText(tenantId, recipient.phone, text);
          if (!ok) error = 'send returned false';
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
          this.logger.warn(`Broadcast ${id} send to ${recipient.phone} failed: ${error}`);
        }

        if (ok) {
          await this.pool.query(
            `UPDATE broadcast_recipients SET status = 'sent', sent_at = NOW(), error = NULL WHERE id = $1`,
            [recipient.id],
          );
          await this.pool.query(`UPDATE broadcast_campaigns SET sent_count = sent_count + 1, updated_at = NOW() WHERE id = $1`, [id]);
        } else {
          await this.pool.query(
            `UPDATE broadcast_recipients SET status = 'failed', error = $2 WHERE id = $1`,
            [recipient.id, error],
          );
          await this.pool.query(`UPDATE broadcast_campaigns SET failed_count = failed_count + 1, updated_at = NOW() WHERE id = $1`, [id]);
        }

        const progress = await this.pool.query<{ sent_count: string; failed_count: string; total_recipients: string }>(
          `SELECT sent_count, failed_count, total_recipients FROM broadcast_campaigns WHERE id = $1`,
          [id],
        );
        const p = progress.rows[0];
        if (p) {
          void this.eventBus?.emit({
            type: DomainEventType.BroadcastProgress,
            tenantId,
            payload: {
              campaignId: id,
              sent: parseInt(p.sent_count, 10) || 0,
              failed: parseInt(p.failed_count, 10) || 0,
              total: parseInt(p.total_recipients, 10) || 0,
            },
          });
        }

        // Pace the next send (throttle). Skip the wait if none remain.
        const remaining = await this.pool.query<{ n: string }>(
          `SELECT COUNT(*) AS n FROM broadcast_recipients WHERE campaign_id = $1 AND status = 'queued'`,
          [id],
        );
        if ((parseInt(remaining.rows[0]?.n ?? '0', 10) || 0) === 0) break;
        await this.sleep(delayMs);
      }

      // Complete only when the queue is drained AND we're still in 'sending'
      // (i.e. not paused/cancelled by the operator).
      const finalStatus = await this.pool.query<{ status: string }>(
        `SELECT status FROM broadcast_campaigns WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      if (finalStatus.rows[0]?.status === 'sending') {
        const left = await this.pool.query<{ n: string }>(
          `SELECT COUNT(*) AS n FROM broadcast_recipients WHERE campaign_id = $1 AND status = 'queued'`,
          [id],
        );
        if ((parseInt(left.rows[0]?.n ?? '0', 10) || 0) === 0) {
          const done = await this.pool.query<{ sent_count: string; failed_count: string; skipped_count: string; total_recipients: string }>(
            `UPDATE broadcast_campaigns SET status = 'completed', completed_at = NOW(), updated_at = NOW()
             WHERE id = $1 RETURNING sent_count, failed_count, skipped_count, total_recipients`,
            [id],
          );
          const d = done.rows[0];
          void this.eventBus?.emit({
            type: DomainEventType.BroadcastCompleted,
            tenantId,
            payload: {
              campaignId: id,
              sent: parseInt(d?.sent_count ?? '0', 10) || 0,
              failed: parseInt(d?.failed_count ?? '0', 10) || 0,
              skipped: parseInt(d?.skipped_count ?? '0', 10) || 0,
              total: parseInt(d?.total_recipients ?? '0', 10) || 0,
            },
          });
        }
      }
    } catch (e) {
      this.logger.error(`Broadcast sender ${id} crashed: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.running.delete(id);
    }
  }

  // ─── Recipients ─────────────────────────────────────────────────────────────

  async listRecipients(tenantId: string, id: string): Promise<Record<string, unknown>[]> {
    await this.loadCampaign(tenantId, id); // tenant scope check
    const res = await this.pool.query(
      `SELECT id, customer_id, name, phone, status, error, sent_at, created_at
       FROM broadcast_recipients WHERE campaign_id = $1 AND tenant_id = $2
       ORDER BY created_at ASC LIMIT 5000`,
      [id, tenantId],
    );
    return res.rows.map((r) => ({
      id: r.id,
      customerId: r.customer_id,
      name: r.name,
      phone: r.phone,
      status: r.status,
      error: r.error,
      sentAt: r.sent_at,
      createdAt: r.created_at,
    }));
  }

  // ─── Consent ─────────────────────────────────────────────────────────────────

  async setConsent(
    tenantId: string,
    body: { phone?: string; customerId?: string; consent: boolean },
  ): Promise<{ updated: number; consent: boolean }> {
    const consent = body?.consent === true;
    const at = consent ? 'NOW()' : 'NULL';
    let res;
    if (body.customerId) {
      res = await this.pool.query(
        `UPDATE customers SET wa_consent = $1, wa_consent_at = ${at}, updated_at = NOW()
         WHERE id = $2 AND tenant_id = $3`,
        [consent, body.customerId, tenantId],
      );
    } else if (body.phone) {
      const normalized = String(body.phone).replace(/[^0-9]/g, '');
      res = await this.pool.query(
        `UPDATE customers SET wa_consent = $1, wa_consent_at = ${at}, updated_at = NOW()
         WHERE tenant_id = $2 AND (phone_normalized = $3 OR phone = $4)`,
        [consent, tenantId, normalized, body.phone],
      );
    } else {
      throw new BadRequestException('phone or customerId is required');
    }
    if ((res.rowCount ?? 0) === 0) throw new NotFoundException('Customer not found');
    return { updated: res.rowCount ?? 0, consent };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private normalizeThrottle(v: unknown): number {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n <= 0) return 20;
    return Math.min(n, 600); // hard cap: 10/sec
  }

  private normalizeFilter(raw: unknown): AudienceFilter {
    const f = (raw ?? {}) as Record<string, unknown>;
    const segment = f.segment as AudienceSegment;
    if (!['all', 'members_active', 'members_expired', 'tag'].includes(segment)) {
      throw new BadRequestException('invalid audience segment');
    }
    return {
      segment,
      tag: (f.tag as string) ?? null,
      outletId: (f.outletId as string) ?? null,
    };
  }

  private async loadCampaign(tenantId: string, id: string): Promise<Record<string, string>> {
    const res = await this.pool.query(
      `SELECT ${CAMPAIGN_COLS} FROM broadcast_campaigns WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    if (res.rows.length === 0) throw new NotFoundException('Campaign not found');
    return res.rows[0]!;
  }

  private mapCampaign(r: Record<string, unknown>): Record<string, unknown> {
    return {
      id: r.id,
      name: r.name,
      message: r.message,
      audienceFilter: r.audience_filter,
      status: r.status,
      scheduledAt: r.scheduled_at,
      throttlePerMin: r.throttle_per_min,
      includeNoConsent: r.include_no_consent,
      acknowledgedRisk: r.acknowledged_risk,
      totalRecipients: r.total_recipients,
      sentCount: r.sent_count,
      failedCount: r.failed_count,
      skippedCount: r.skipped_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      startedAt: r.started_at,
      completedAt: r.completed_at,
    };
  }
}
