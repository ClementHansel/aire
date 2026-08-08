import {
  Injectable,
  Inject,
  Optional,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  NotFoundException,
  BadRequestException,
  GoneException,
  ConflictException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';
import { WhatsappService } from '../whatsapp';
import { NotificationRendererService, renderNotification } from '../notification/notification-renderer.service';

export type FeedbackQuestionType = 'rating' | 'nps' | 'text';
/** A single survey question shown on the public form. */
export interface FeedbackQuestion {
  id: string;
  type: FeedbackQuestionType;
  label: string;
  enabled: boolean;
}

/** Enable toggle + capture behaviour, stored in tenants.settings.feedback (default OFF). */
export interface FeedbackConfig {
  enabled: boolean;
  /** When true, a feedback request is created + sent automatically on order.paid. */
  sendOnPaid: boolean;
  /** WhatsApp message that precedes the feedback link. */
  thanksMessage: string;
  /** How many days the survey link stays valid. */
  expiryDays: number;
  /** Minutes to wait after payment before sending (0 = immediately). */
  sendDelayMinutes: number;
  /** Raise a feedback.alert when a rating is at or below this (1..5); null = off. */
  alertThresholdRating: number | null;
  /** Raise a feedback.alert on an NPS detractor (score 0..6). */
  alertOnDetractor: boolean;
  /** The survey questions shown to the customer (in order). */
  questions: FeedbackQuestion[];
}

/** Default question set — mirrors the three questions the form used to hardcode. */
const DEFAULT_QUESTIONS: FeedbackQuestion[] = [
  { id: 'rating', type: 'rating', label: 'Your rating', enabled: true },
  { id: 'nps', type: 'nps', label: 'How likely are you to recommend us?', enabled: true },
  { id: 'comment', type: 'text', label: 'Anything else?', enabled: true },
];

const DEFAULT_CONFIG: FeedbackConfig = {
  enabled: false,
  sendOnPaid: true,
  thanksMessage: 'Thanks! How was your service?',
  expiryDays: 7,
  sendDelayMinutes: 0,
  alertThresholdRating: null,
  alertOnDetractor: false,
  questions: DEFAULT_QUESTIONS,
};

/** How often the delayed-send sweep runs. */
const FEEDBACK_SWEEP_INTERVAL_MS = 60_000;

export interface SubmitFeedbackDto {
  rating: number;
  nps?: number | null;
  comment?: string | null;
  /** Full answer map keyed by question id (custom questions included). */
  answers?: Record<string, string | number | null>;
}

export interface FeedbackReportFilter {
  from?: string;
  to?: string;
  outletId?: string;
}

/**
 * FeedbackService — post-service customer satisfaction capture (rating / NPS).
 *
 * On order.paid (when enabled) it creates a `feedback_requests` row carrying a
 * random public token and best-effort sends the customer a WhatsApp link to a
 * public form. The customer submits a 1..5 rating (+ optional 0..10 NPS and a
 * comment) which lands in `feedback_responses`. Aggregates (avg rating,
 * NPS = %promoters − %detractors, rating distribution, daily trend) are computed
 * on read. The enable toggle lives in tenants.settings.feedback (default OFF).
 */
@Injectable()
export class FeedbackService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FeedbackService.name);
  private unsubscribes: Array<() => void> = [];

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() private readonly eventBus?: EventBusService,
    @Optional() private readonly whatsapp?: WhatsappService,
    @Optional() @Inject(NotificationRendererService) private readonly renderer?: NotificationRendererService,
  ) {}

  private sweepTimer?: ReturnType<typeof setInterval>;

  onModuleInit(): void {
    if (this.eventBus) {
      this.unsubscribes.push(
        this.eventBus.on(DomainEventType.OrderPaid, (e) =>
          this.safe(() => this.onOrderPaid(e.tenantId!, (e.payload as { orderId: string }).orderId))),
      );
      this.logger.log('Feedback request subscribed (order.paid)');
    }
    // Delayed-send sweep: dispatch surveys whose configured send delay has elapsed.
    // Dependency-free interval (mirrors membership-lifecycle); overlapping runs are guarded.
    this.sweepTimer = setInterval(() => {
      void this.dispatchDue().catch((e) => this.logger.warn(`feedback sweep failed: ${e instanceof Error ? e.message : e}`));
    }, FEEDBACK_SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  onModuleDestroy(): void {
    this.unsubscribes.forEach((u) => u());
    this.unsubscribes = [];
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  private async safe(fn: () => Promise<unknown>): Promise<void> {
    try { await fn(); } catch (e) { this.logger.error(`Feedback request failed: ${e instanceof Error ? e.message : e}`); }
  }

  // ─── Config ──────────────────────────────────────────────────────────────

  async getConfig(tenantId: string): Promise<FeedbackConfig> {
    const r = await this.pool.query<{ cfg: FeedbackConfig | null }>(
      `SELECT settings->'feedback' AS cfg FROM tenants WHERE id = $1`,
      [tenantId],
    );
    const cfg = r.rows[0]?.cfg;
    return cfg ? { ...DEFAULT_CONFIG, ...cfg } : { ...DEFAULT_CONFIG };
  }

  /** Validate + normalize the configurable question set. Always keeps exactly one
   *  enabled rating question (the response's rating column is NOT NULL). */
  private normalizeQuestions(input: unknown): FeedbackQuestion[] {
    if (!Array.isArray(input)) return DEFAULT_QUESTIONS;
    const seen = new Set<string>();
    const out: FeedbackQuestion[] = [];
    for (const raw of input) {
      const q = raw as Partial<FeedbackQuestion>;
      const type = q.type;
      if (type !== 'rating' && type !== 'nps' && type !== 'text') continue;
      const label = typeof q.label === 'string' && q.label.trim() ? q.label.trim() : type;
      let id = typeof q.id === 'string' && q.id.trim() ? q.id.trim() : type;
      while (seen.has(id)) id = `${id}_`;
      seen.add(id);
      out.push({ id, type, label, enabled: q.enabled !== false });
    }
    // Guarantee a rating question exists and is enabled.
    const rating = out.find((q) => q.type === 'rating');
    if (!rating) out.unshift({ id: 'rating', type: 'rating', label: 'Your rating', enabled: true });
    else rating.enabled = true;
    return out;
  }

  async setConfig(tenantId: string, patch: Partial<FeedbackConfig>): Promise<FeedbackConfig> {
    const current = await this.getConfig(tenantId);
    const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));
    let threshold = current.alertThresholdRating;
    if (patch.alertThresholdRating !== undefined) {
      threshold = patch.alertThresholdRating == null ? null : clamp(Number(patch.alertThresholdRating), 1, 5);
    }
    const next: FeedbackConfig = {
      enabled: patch.enabled ?? current.enabled,
      sendOnPaid: patch.sendOnPaid ?? current.sendOnPaid,
      thanksMessage:
        typeof patch.thanksMessage === 'string' && patch.thanksMessage.trim()
          ? patch.thanksMessage.trim()
          : current.thanksMessage,
      expiryDays: patch.expiryDays !== undefined ? clamp(Number(patch.expiryDays), 1, 90) : current.expiryDays,
      sendDelayMinutes: patch.sendDelayMinutes !== undefined ? clamp(Number(patch.sendDelayMinutes), 0, 10080) : current.sendDelayMinutes,
      alertThresholdRating: threshold,
      alertOnDetractor: patch.alertOnDetractor ?? current.alertOnDetractor,
      questions: patch.questions !== undefined ? this.normalizeQuestions(patch.questions) : current.questions,
    };
    await this.pool.query(
      `UPDATE tenants
       SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{feedback}', $2::jsonb, true),
           updated_at = NOW()
       WHERE id = $1`,
      [tenantId, JSON.stringify(next)],
    );
    return next;
  }

  // ─── Auto-request on order.paid ────────────────────────────────────────────

  async onOrderPaid(tenantId: string, orderId: string): Promise<boolean> {
    const cfg = await this.getConfig(tenantId);
    if (!cfg.enabled || !cfg.sendOnPaid) return false;

    const ord = await this.pool.query<{ customer_phone: string | null; customer_id: string | null; outlet_id: string | null; order_number: string }>(
      `SELECT customer_phone, customer_id, outlet_id, order_number FROM orders WHERE id = $1 AND tenant_id = $2`,
      [orderId, tenantId],
    );
    const o = ord.rows[0];
    if (!o) return false;

    // Idempotent: one feedback request per order.
    const exists = await this.pool.query(
      `SELECT 1 FROM feedback_requests WHERE order_id = $1 AND tenant_id = $2 LIMIT 1`,
      [orderId, tenantId],
    );
    if ((exists.rowCount ?? 0) > 0) return false;

    const delayMin = Math.max(0, Math.round(cfg.sendDelayMinutes || 0));
    const expiryDays = Math.max(1, Math.round(cfg.expiryDays || 7));
    // sent_at is stamped now only for immediate sends; delayed ones are picked up
    // by dispatchDue() once send_after passes.
    const ins = await this.pool.query<{ id: string; token: string }>(
      `INSERT INTO feedback_requests (tenant_id, outlet_id, order_id, customer_id, customer_phone, channel, status, sent_at, send_after, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'whatsapp', 'pending',
               CASE WHEN $6 = 0 THEN NOW() ELSE NULL END,
               NOW() + make_interval(mins => $6),
               NOW() + make_interval(days => $7))
       RETURNING id, token`,
      [tenantId, o.outlet_id, orderId, o.customer_id, o.customer_phone, delayMin, expiryDays],
    );
    const { id: requestId, token } = ins.rows[0]!;

    // Immediate send only; delayed sends are dispatched by the sweep.
    if (delayMin === 0 && o.customer_phone && this.whatsapp) {
      await this.sendLink(tenantId, o.customer_phone, token, cfg.thanksMessage, orderId);
    }

    void this.eventBus?.emit({
      type: DomainEventType.FeedbackRequested,
      tenantId,
      outletId: o.outlet_id,
      payload: { requestId, orderId, token },
    });
    return true;
  }

  /** Best-effort WhatsApp send of the feedback link — must never throw. */
  private async sendLink(tenantId: string, phone: string, token: string, thanksMessage: string, orderId?: string): Promise<void> {
    if (!this.whatsapp) return;
    const base = process.env.PUBLIC_APP_URL || '';
    const link = `${base}/feedback/${token}`;
    // `thanksMessage` (from the Feedback page) stays a variable rather than being
    // absorbed into the template, so the two settings keep working together: the
    // Feedback page still owns the opening line, the notification editor owns how
    // it is laid out around the link.
    const text = await renderNotification(this.renderer, tenantId, 'feedback_request', {
      thanksMessage,
      feedbackUrl: link,
    });
    if (!text) return;
    try {
      await this.whatsapp.sendText(tenantId, phone, text);
    } catch (e) {
      this.logger.warn(`Feedback WA send failed${orderId ? ` for order ${orderId}` : ''}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // ─── Delayed-send sweep ─────────────────────────────────────────────────────

  private sweeping = false;

  /** Dispatch pending surveys whose configured send delay has elapsed. Marks each
   *  sent (best-effort) so it is not retried, mirroring the immediate-send path. */
  async dispatchDue(): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    try {
      const due = await this.pool.query<{ id: string; tenant_id: string; token: string; customer_phone: string | null }>(
        `SELECT id, tenant_id, token, customer_phone
         FROM feedback_requests
         WHERE status = 'pending' AND sent_at IS NULL
           AND send_after IS NOT NULL AND send_after <= NOW()
           AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY send_after ASC
         LIMIT 100`,
      );
      const msgCache = new Map<string, string>();
      let sent = 0;
      for (const row of due.rows) {
        if (row.customer_phone && this.whatsapp) {
          let msg = msgCache.get(row.tenant_id);
          if (msg === undefined) { msg = (await this.getConfig(row.tenant_id)).thanksMessage; msgCache.set(row.tenant_id, msg); }
          await this.sendLink(row.tenant_id, row.customer_phone, row.token, msg);
        }
        // Stamp sent regardless (best-effort) so it is not swept again.
        await this.pool.query(`UPDATE feedback_requests SET sent_at = NOW(), updated_at = NOW() WHERE id = $1`, [row.id]);
        sent++;
      }
      return sent;
    } finally {
      this.sweeping = false;
    }
  }

  // ─── Public (no-auth) form ─────────────────────────────────────────────────

  /**
   * The token column is a `uuid`, so a non-UUID string in the URL would make
   * Postgres raise "invalid input syntax for type uuid" — surfacing as a 500.
   * A malformed/unknown link is simply "not found".
   */
  private assertTokenShape(token: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
      throw new NotFoundException('Feedback link not found');
    }
  }

  /** Public context for the token'd form. 404 when unknown; auto-expires past deadline. */
  async getPublic(token: string): Promise<{ outletName: string | null; orderNumber: string | null; status: string; questions: FeedbackQuestion[] }> {
    this.assertTokenShape(token);
    const r = await this.pool.query<{ id: string; tenant_id: string; status: string; expires_at: string | null; outlet_name: string | null; order_number: string | null }>(
      `SELECT fr.id, fr.tenant_id, fr.status, fr.expires_at, ou.name AS outlet_name, o.order_number
       FROM feedback_requests fr
       LEFT JOIN outlets ou ON ou.id = fr.outlet_id
       LEFT JOIN orders o ON o.id = fr.order_id
       WHERE fr.token = $1`,
      [token],
    );
    const row = r.rows[0];
    if (!row) throw new NotFoundException('Feedback link not found');

    let status = row.status;
    if (status === 'pending' && row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      await this.pool.query(`UPDATE feedback_requests SET status = 'expired', updated_at = NOW() WHERE id = $1`, [row.id]);
      status = 'expired';
    }
    const cfg = await this.getConfig(row.tenant_id);
    const questions = cfg.questions.filter((q) => q.enabled);
    return { outletName: row.outlet_name, orderNumber: row.order_number, status, questions };
  }

  /** Submit the customer's response. Guards against double-submit + expiry. */
  async submit(token: string, dto: SubmitFeedbackDto): Promise<{ ok: true }> {
    this.assertTokenShape(token);
    const answers = dto.answers && typeof dto.answers === 'object' ? dto.answers : {};
    // The standard rating/nps/comment fields keep the aggregates working; when a
    // client only sends `answers`, derive them from the standard question ids.
    const ratingRaw = dto.rating ?? answers.rating;
    const rating = Math.round(Number(ratingRaw));
    if (!(rating >= 1 && rating <= 5)) throw new BadRequestException('rating must be between 1 and 5');
    let nps: number | null = null;
    const npsRaw = dto.nps ?? answers.nps;
    if (npsRaw !== undefined && npsRaw !== null && npsRaw !== ('' as unknown)) {
      nps = Math.round(Number(npsRaw));
      if (!(nps >= 0 && nps <= 10)) throw new BadRequestException('nps must be between 0 and 10');
    }
    const commentRaw = dto.comment ?? answers.comment;
    const comment = typeof commentRaw === 'string' && commentRaw.trim() ? commentRaw.trim() : null;
    // Persist the full answer map (standard values included) for custom questions.
    const answersToStore = Object.keys(answers).length ? answers : { rating, nps, comment };

    const r = await this.pool.query<{ id: string; tenant_id: string; outlet_id: string | null; status: string; expires_at: string | null }>(
      `SELECT id, tenant_id, outlet_id, status, expires_at FROM feedback_requests WHERE token = $1`,
      [token],
    );
    const req = r.rows[0];
    if (!req) throw new NotFoundException('Feedback link not found');
    if (req.status === 'completed') throw new ConflictException('This feedback has already been submitted.');
    if (req.status === 'expired' || (req.expires_at && new Date(req.expires_at).getTime() < Date.now())) {
      if (req.status !== 'expired') {
        await this.pool.query(`UPDATE feedback_requests SET status = 'expired', updated_at = NOW() WHERE id = $1`, [req.id]);
      }
      throw new GoneException('This feedback link has expired.');
    }

    try {
      await this.pool.query(
        `INSERT INTO feedback_responses (tenant_id, outlet_id, request_id, rating, nps, comment, answers)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [req.tenant_id, req.outlet_id, req.id, rating, nps, comment, JSON.stringify(answersToStore)],
      );
    } catch (e) {
      // uq_feedback_resp_request — a response already exists for this request.
      if ((e as { code?: string }).code === '23505') {
        await this.pool.query(`UPDATE feedback_requests SET status = 'completed', updated_at = NOW() WHERE id = $1`, [req.id]);
        throw new ConflictException('This feedback has already been submitted.');
      }
      throw e;
    }

    await this.pool.query(`UPDATE feedback_requests SET status = 'completed', updated_at = NOW() WHERE id = $1`, [req.id]);

    void this.eventBus?.emit({
      type: DomainEventType.FeedbackReceived,
      tenantId: req.tenant_id,
      outletId: req.outlet_id,
      payload: { requestId: req.id, rating, nps },
    });

    // Threshold alert: low rating or NPS detractor, per the tenant's setup.
    const cfg = await this.getConfig(req.tenant_id);
    const lowRating = cfg.alertThresholdRating != null && rating <= cfg.alertThresholdRating;
    const detractor = cfg.alertOnDetractor && nps != null && nps <= 6;
    if (lowRating || detractor) {
      void this.eventBus?.emit({
        type: DomainEventType.FeedbackAlert,
        tenantId: req.tenant_id,
        outletId: req.outlet_id,
        payload: { requestId: req.id, rating, nps, reason: lowRating ? 'low_rating' : 'detractor', comment },
      });
    }
    return { ok: true };
  }

  // ─── Authed reads ───────────────────────────────────────────────────────────

  private rangeConds(tenantId: string, f: FeedbackReportFilter, alias = 'fr') {
    const conds = [`${alias}.tenant_id = $1`];
    const params: unknown[] = [tenantId];
    if (f.from) { params.push(f.from); conds.push(`${alias}.created_at >= $${params.length}`); }
    if (f.to) { params.push(f.to); conds.push(`${alias}.created_at <= $${params.length}`); }
    if (f.outletId) { params.push(f.outletId); conds.push(`${alias}.outlet_id = $${params.length}`); }
    return { where: conds.join(' AND '), params };
  }

  async summary(tenantId: string, f: FeedbackReportFilter = {}) {
    const { where, params } = this.rangeConds(tenantId, f);
    const agg = await this.pool.query<{
      response_count: string; avg_rating: string | null;
      promoters: string; detractors: string; nps_total: string;
      r1: string; r2: string; r3: string; r4: string; r5: string;
    }>(
      `SELECT
         COUNT(*) AS response_count,
         AVG(rating)::float AS avg_rating,
         COUNT(*) FILTER (WHERE nps BETWEEN 9 AND 10) AS promoters,
         COUNT(*) FILTER (WHERE nps BETWEEN 0 AND 6) AS detractors,
         COUNT(*) FILTER (WHERE nps IS NOT NULL) AS nps_total,
         COUNT(*) FILTER (WHERE rating = 1) AS r1,
         COUNT(*) FILTER (WHERE rating = 2) AS r2,
         COUNT(*) FILTER (WHERE rating = 3) AS r3,
         COUNT(*) FILTER (WHERE rating = 4) AS r4,
         COUNT(*) FILTER (WHERE rating = 5) AS r5
       FROM feedback_responses fr WHERE ${where}`,
      params,
    );
    const a = agg.rows[0]!;
    const npsTotal = parseInt(a.nps_total, 10) || 0;
    const promoters = parseInt(a.promoters, 10) || 0;
    const detractors = parseInt(a.detractors, 10) || 0;
    const npsScore = npsTotal > 0 ? Math.round(((promoters - detractors) / npsTotal) * 100) : 0;

    const trend = await this.pool.query<{ day: string; count: string; avg_rating: string | null }>(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
              COUNT(*) AS count, AVG(rating)::float AS avg_rating
       FROM feedback_responses fr WHERE ${where}
       GROUP BY 1 ORDER BY 1`,
      params,
    );

    return {
      responseCount: parseInt(a.response_count, 10) || 0,
      avgRating: a.avg_rating != null ? Math.round(parseFloat(a.avg_rating) * 100) / 100 : 0,
      npsScore,
      npsResponseCount: npsTotal,
      ratingDistribution: {
        1: parseInt(a.r1, 10) || 0,
        2: parseInt(a.r2, 10) || 0,
        3: parseInt(a.r3, 10) || 0,
        4: parseInt(a.r4, 10) || 0,
        5: parseInt(a.r5, 10) || 0,
      },
      trend: trend.rows.map((r) => ({
        day: r.day,
        count: parseInt(r.count, 10) || 0,
        avgRating: r.avg_rating != null ? Math.round(parseFloat(r.avg_rating) * 100) / 100 : 0,
      })),
    };
  }

  async responses(tenantId: string, f: FeedbackReportFilter = {}) {
    const { where, params } = this.rangeConds(tenantId, f);
    const rows = await this.pool.query<{
      id: string; rating: number; nps: number | null; comment: string | null;
      created_at: string; outlet_name: string | null; order_number: string | null;
    }>(
      `SELECT fr.id, fr.rating, fr.nps, fr.comment, fr.created_at,
              ou.name AS outlet_name, o.order_number
       FROM feedback_responses fr
       LEFT JOIN outlets ou ON ou.id = fr.outlet_id
       LEFT JOIN feedback_requests req ON req.id = fr.request_id
       LEFT JOIN orders o ON o.id = req.order_id
       WHERE ${where}
       ORDER BY fr.created_at DESC LIMIT 500`,
      params,
    );
    return rows.rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      nps: r.nps,
      comment: r.comment,
      createdAt: r.created_at,
      outletName: r.outlet_name,
      orderNumber: r.order_number,
    }));
  }
}
