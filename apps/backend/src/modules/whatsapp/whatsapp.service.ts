import { Injectable, Inject, Logger, Optional, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { DATABASE_POOL } from '../auth/database.provider';
import { AgentRuntimeService } from './agent-runtime.service';
import { PendingBookingService } from './pending-booking.service';
import { CustomerContextService, ResolvedCustomer } from './customer-context.service';
import { ChatMessage, LLMRouterService, LLMErrorResponse } from '../agent/llm-router.service';
import { JobMonitorService } from '../job-monitor';
import { normalizePhone } from '@aire/shared';
import { formatForWhatsApp } from './whatsapp-format';
import { looksLikeReasoning } from '../../common/looks-like-reasoning';
import { NotificationRendererService, renderNotification } from '../notification/notification-renderer.service';
import { WaWhitelistService } from './wa-whitelist.service';
import { AgentChatService } from '../agent/agent-chat.service';

/** Once-per-chat identity request, appended after the first reply to an unknown sender. */
const IDENTITY_ASK =
  'Oh iya, biar Irene bisa bantu lebih lengkap (cek membership, voucher, atau bikin booking), '
  + 'boleh info nomor HP yang terdaftar di Aire, nomor member, atau plat mobilnya ya kak? 😊';

interface AgentCfgRow {
  tenant_id: string; base_prompt: string | null; product_knowledge: string | null;
  skills: string | null;
  escalation_number: string | null; max_messages_per_day: number;
  wa_provider: 'waha' | 'kirim'; wa_number: string | null; waha_session: string | null;
  kirim_api_key: string | null; kirim_phone_id: string | null; ai_reply_enabled: boolean;
  // Per-tenant simulation toggle (migration 068). Effective mock = env global OR this.
  waha_mock?: boolean;
  // n8n agent-builder routing (migration 038). Present because config() does SELECT *.
  routing_mode?: 'builtin' | 'n8n'; n8n_flow_id?: string | null; bridge_token?: string | null;
  // Per-branch WhatsApp opt-in (migration 067). When true, config(tenantId, outletId)
  // overlays the branch's own connection from outlet_agent_configs.
  per_branch_wa_enabled?: boolean;
  // Transient (not a DB column): set by config() when per-branch is on for a
  // branch that has NO connection of its own — so sends become a no-op and
  // status reports not_configured, rather than falling back to the tenant line.
  wa_connection_missing?: boolean;
}

/**
 * WhatsApp integration. Connection + behavior are driven entirely by the
 * tenant's Agentic-AI config (UI): provider (WAHA self-host or kirimdev cloud),
 * session/number, daily cap, product knowledge, and escalation number.
 */
/** How often to sweep for bookings whose staff approval has gone stale. */
const APPROVAL_SLA_SWEEP_MS = 60 * 60 * 1000; // hourly

@Injectable()
export class WhatsappService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappService.name);
  private slaRunning = false;
  private readonly wahaUrl = process.env.WAHA_URL || 'http://waha:3000';
  private readonly wahaApiKey = process.env.WAHA_API_KEY || '';
  private readonly kirimUrl = process.env.KIRIM_URL || 'https://api.kirimdev.com/v1';
  /** HMAC secret for verifying kirimdev inbound webhook signatures (X-Kirim-Signature). */
  private readonly kirimWebhookSecret = process.env.KIRIM_WEBHOOK_SECRET || '';
  private kirimWebhookSecretWarned = false;
  /** Base URL n8n uses to call back into aire's bridge (internal docker network). */
  private readonly bridgeCallbackBase = process.env.BRIDGE_CALLBACK_BASE || 'http://backend:4000';

  /**
   * Simulation bypass. When active, the three seams that touch the third-party
   * gateway — outbound send, session status, and QR — are stubbed: outbound is
   * recorded to wa_mock_outbox instead of hitting WAHA/kirimdev, and status/QR
   * report "connected". This exercises the ENTIRE pipeline (webhook parse →
   * tenant resolve → cap → n8n/built-in AI → conversation log → send) without a
   * real WhatsApp number.
   *
   * It can be turned on TWO ways:
   *  - env `WAHA_MOCK=true` — a process-wide force (dev/local); mocks every tenant.
   *  - per-tenant `agent_configs.waha_mock` — lets a demo tenant simulate while
   *    other tenants on the same server use the real connection (migration 068).
   * Effective mock = env global OR the tenant flag.
   */
  private readonly wahaMock = process.env.WAHA_MOCK === 'true';

  /** Global (env) simulation force. True → every tenant is mocked. */
  isMock(): boolean { return this.wahaMock; }

  /** Effective mock for a resolved config row: env global OR the tenant flag. */
  private isMockActive(cfg?: { waha_mock?: boolean } | null): boolean {
    return this.wahaMock || !!cfg?.waha_mock;
  }

  /** Effective mock for a tenant (surfaced to the UI status endpoint). */
  async isMockEnabled(tenantId: string): Promise<boolean> {
    if (this.wahaMock) return true;
    const cfg = await this.config(tenantId);
    return !!cfg?.waha_mock;
  }

  /** Headers for WAHA requests. Recent WAHA images require the API key as X-Api-Key. */
  private wahaHeaders(json = false): Record<string, string> {
    const h: Record<string, string> = {};
    if (json) h['Content-Type'] = 'application/json';
    if (this.wahaApiKey) h['X-Api-Key'] = this.wahaApiKey;
    return h;
  }

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly runtime: AgentRuntimeService,
    @Optional() private readonly llm?: LLMRouterService,
    @Optional() private readonly pendingBooking?: PendingBookingService,
    @Optional() private readonly customerContext?: CustomerContextService,
    @Optional() private readonly jobMonitor?: JobMonitorService,
    // Optional: the many unit tests that construct this service directly fall
    // back to the catalogue defaults.
    @Optional() @Inject(NotificationRendererService) private readonly renderer?: NotificationRendererService,
    // Staff whitelist + the full business brain. Both optional so the existing
    // unit tests keep constructing this service with a short argument list;
    // without them, every inbound message simply takes the customer path.
    @Optional() private readonly whitelist?: WaWhitelistService,
    @Optional() private readonly staffChat?: AgentChatService,
  ) {}

  onModuleInit(): void {
    // Sweep stale booking approvals once at boot, then hourly. Dependency-free
    // (no @nestjs/schedule), guarded against overlap, and unref'd so it never
    // holds the process open. Skipped entirely if the booking gate isn't wired.
    if (!this.pendingBooking) return;
    void this.runApprovalSla().catch((e) => this.logger.warn(`initial approval SLA sweep failed: ${String(e)}`));
    setInterval(() => {
      void this.runApprovalSla().catch((e) => this.logger.warn(`approval SLA sweep failed: ${String(e)}`));
    }, APPROVAL_SLA_SWEEP_MS).unref?.();
  }

  /**
   * Auto-cancel bookings whose staff approval went stale and tell each customer,
   * so a confirmed-but-unapproved booking never leaves them hanging. Returns the
   * number of bookings expired. Safe to call manually (idempotent, overlap-guarded).
   */
  async runApprovalSla(): Promise<number> {
    if (!this.pendingBooking || this.slaRunning) return 0;
    this.slaRunning = true;
    const start = Date.now();
    try {
      const expired = await this.pendingBooking.sweepExpired();
      for (const e of expired) {
        const text = await renderNotification(this.renderer, e.tenantId, 'booking_expired', {
          bookingSummary: e.summary,
        });
        if (!text) continue;
        const conv = await this.upsertConversation(e.tenantId, e.customerPhone);
        await this.addMessage(e.tenantId, conv.id, 'outbound', text, true, 'Booking');
        await this.sendText(e.tenantId, e.customerPhone, text);
      }
      if (expired.length) this.logger.log(`Approval SLA: auto-cancelled ${expired.length} stale booking(s)`);
      void this.jobMonitor?.recordRun('booking-sla-sweep', {
        label: 'Booking approval SLA sweep', status: 'ok',
        detail: `${expired.length} stale booking(s) auto-cancelled`,
        durationMs: Date.now() - start, intervalMs: APPROVAL_SLA_SWEEP_MS,
      });
      return expired.length;
    } catch (e) {
      void this.jobMonitor?.recordRun('booking-sla-sweep', {
        label: 'Booking approval SLA sweep', status: 'error',
        detail: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start,
        intervalMs: APPROVAL_SLA_SWEEP_MS,
      });
      throw e;
    } finally {
      this.slaRunning = false;
    }
  }

  /**
   * The tenant's WhatsApp + AI config, optionally with a branch's connection
   * overlaid. Behaviour fields (escalation, daily cap, AI flags, prompt,
   * knowledge, n8n routing) always come from the tenant row. The CONNECTION
   * fields (provider, number, session, kirim key/phone id) are overlaid from
   * outlet_agent_configs when per-branch WhatsApp is on and an outletId is given:
   *  - branch has its own row → use the branch connection.
   *  - branch has no row ("require own number") → connection is nulled so sends
   *    become a no-op and status reports not_configured; we do NOT silently fall
   *    back to the tenant line.
   * With per-branch off, or no outletId, the tenant connection is used unchanged.
   */
  private async config(tenantId: string, outletId?: string | null): Promise<AgentCfgRow | null> {
    const r = await this.pool.query('SELECT * FROM agent_configs WHERE tenant_id = $1', [tenantId]);
    const cfg: AgentCfgRow | undefined = r.rows[0];
    if (!cfg) return null;
    if (!outletId || !cfg.per_branch_wa_enabled) return cfg;
    const b = await this.pool.query(
      'SELECT wa_provider, wa_number, waha_session, kirim_api_key, kirim_phone_id FROM outlet_agent_configs WHERE outlet_id = $1 AND tenant_id = $2',
      [outletId, tenantId],
    );
    const branch = b.rows[0];
    if (branch) {
      const hasConnection = !!(branch.waha_session || branch.kirim_api_key);
      return { ...cfg, wa_provider: branch.wa_provider, wa_number: branch.wa_number, waha_session: branch.waha_session, kirim_api_key: branch.kirim_api_key, kirim_phone_id: branch.kirim_phone_id, wa_connection_missing: !hasConnection };
    }
    // per-branch on but this branch isn't wired: no fallback to the tenant line.
    return { ...cfg, wa_number: null, waha_session: null, kirim_api_key: null, kirim_phone_id: null, wa_connection_missing: true };
  }

  /**
   * Resolve which tenant + branch owns a given WAHA session. Branch sessions
   * (outlet_agent_configs) win over the tenant session (agent_configs), so an
   * inbound message on a branch line is scoped to that outlet.
   */
  private async resolveBySession(session: string): Promise<{ tenantId: string; outletId: string | null } | null> {
    const b = await this.pool.query(
      'SELECT tenant_id, outlet_id FROM outlet_agent_configs WHERE waha_session = $1 LIMIT 1',
      [session],
    );
    if (b.rows[0]) return { tenantId: b.rows[0].tenant_id, outletId: b.rows[0].outlet_id };
    const r = await this.pool.query('SELECT tenant_id FROM agent_configs WHERE waha_session = $1 LIMIT 1', [session]);
    return r.rows[0] ? { tenantId: r.rows[0].tenant_id, outletId: null } : null;
  }

  /**
   * Resolve which tenant + branch owns a given kirimdev phone_number_id. Branch
   * numbers (outlet_agent_configs) win over the tenant number (agent_configs),
   * mirroring {@link resolveBySession} for the WAHA session discriminator.
   */
  private async resolveByPhoneId(phoneId: string): Promise<{ tenantId: string; outletId: string | null } | null> {
    const b = await this.pool.query(
      'SELECT tenant_id, outlet_id FROM outlet_agent_configs WHERE kirim_phone_id = $1 LIMIT 1',
      [phoneId],
    );
    if (b.rows[0]) return { tenantId: b.rows[0].tenant_id, outletId: b.rows[0].outlet_id };
    const r = await this.pool.query('SELECT tenant_id FROM agent_configs WHERE kirim_phone_id = $1 LIMIT 1', [phoneId]);
    return r.rows[0] ? { tenantId: r.rows[0].tenant_id, outletId: null } : null;
  }

  // ── WAHA session management (for the QR-connect UI) ─────────────────────────
  // outletId targets a specific branch line when per-branch WhatsApp is on;
  // omit it for the tenant central line.

  /** WAHA statuses from which a QR can be served / the line is already live. */
  private static readonly WAHA_HEALTHY = ['WORKING', 'SCAN_QR_CODE', 'STARTING'];

  /** One WAHA session call. Returns the parsed body, or null on transport/HTTP error. */
  private async wahaSessionCall(
    session: string, action: 'start' | 'restart' | 'logout',
  ): Promise<{ status?: string } | null> {
    try {
      const res = await fetch(
        `${this.wahaUrl}/api/sessions/${encodeURIComponent(session)}/${action}`,
        { method: 'POST', headers: this.wahaHeaders(true) },
      );
      if (!res.ok) {
        this.logger.warn(`WAHA ${action} '${session}' → HTTP ${res.status}`);
        return null;
      }
      // logout returns 201 with no useful body; start/restart return the session.
      return (await res.json().catch(() => ({}))) as { status?: string };
    } catch (e) {
      this.logger.warn(`WAHA ${action} '${session}' failed: ${String(e)}`);
      return null;
    }
  }

  /** Poll the session until it leaves STARTING, or the budget runs out. */
  private async awaitSettled(session: string, tries = 5, delayMs = 1500): Promise<string> {
    let status = await this.rawStatus(session);
    for (let i = 0; i < tries && status === 'STARTING'; i++) {
      await new Promise((r) => setTimeout(r, delayMs));
      status = await this.rawStatus(session);
    }
    return status;
  }

  /** The session's status straight from WAHA, with no tenant/mock interpretation. */
  private async rawStatus(session: string): Promise<string> {
    try {
      const res = await fetch(`${this.wahaUrl}/api/sessions/${encodeURIComponent(session)}`, { headers: this.wahaHeaders() });
      if (!res.ok) return 'stopped';
      const data = (await res.json()) as { status?: string };
      return data.status ?? 'unknown';
    } catch { return 'unreachable'; }
  }

  /**
   * Drive the session toward a state where it is either WORKING or serving a QR.
   * Self-healing, because a dead line cannot be recovered by `start` alone:
   *
   *  - WORKING / SCAN_QR_CODE / STARTING → leave it alone.
   *  - stopped / unknown                 → `start`.
   *  - FAILED                            → `restart`; if it fails AGAIN, the stored
   *    credentials have been revoked by WhatsApp (`stream:error 401` +
   *    `conflict{device_removed}`, i.e. the device was logged out on the phone), so
   *    `logout` to wipe them and `start` fresh → SCAN_QR_CODE.
   *
   * `logout` is destructive (it drops the pairing and forces a re-scan), so it is
   * reached ONLY from a twice-FAILED session whose credentials are already dead —
   * never from a healthy one.
   */
  async ensureSession(tenantId: string, outletId?: string | null): Promise<{ status: string; reason?: string }> {
    const cfg = await this.config(tenantId, outletId);
    if (this.isMockActive(cfg)) return { status: 'WORKING' };
    // Per-branch on but this branch has no line of its own yet.
    if (cfg?.wa_connection_missing) return { status: 'not_configured' };
    if (cfg?.wa_provider === 'kirim') return { status: cfg.kirim_api_key ? 'configured' : 'not_configured' };
    const session = cfg?.waha_session || 'default';

    let status = await this.rawStatus(session);
    if (status === 'unreachable') return { status, reason: 'WAHA service is not reachable.' };
    if (WhatsappService.WAHA_HEALTHY.includes(status)) return { status };

    if (status !== 'FAILED') {
      // Never started, or stopped: a plain start is enough.
      await this.wahaSessionCall(session, 'start');
      return { status: await this.awaitSettled(session) };
    }

    // FAILED: try a restart first — cheapest recovery, keeps the pairing.
    this.logger.warn(`WAHA session '${session}' is FAILED; attempting restart.`);
    await this.wahaSessionCall(session, 'restart');
    status = await this.awaitSettled(session);
    if (WhatsappService.WAHA_HEALTHY.includes(status)) return { status };

    // Still FAILED: the credentials are revoked. Wipe and re-pair from scratch.
    this.logger.warn(`WAHA session '${session}' still FAILED after restart; wiping revoked credentials to force re-pairing.`);
    await this.wahaSessionCall(session, 'logout');
    await this.wahaSessionCall(session, 'start');
    status = await this.awaitSettled(session);
    return {
      status,
      reason: WhatsappService.WAHA_HEALTHY.includes(status)
        ? 'The previous pairing was revoked (the device was logged out on the phone). Scan the QR again to reconnect.'
        : 'WhatsApp rejected the connection. The WAHA image is likely out of date — pull the latest image, then retry.',
    };
  }

  async status(tenantId: string, outletId?: string | null): Promise<{ status: string }> {
    const cfg = await this.config(tenantId, outletId);
    if (this.isMockActive(cfg)) return { status: 'WORKING' };
    if (cfg?.wa_connection_missing) return { status: 'not_configured' };
    if (cfg?.wa_provider === 'kirim') return { status: cfg.kirim_api_key ? 'configured' : 'not_configured' };
    return { status: await this.rawStatus(cfg?.waha_session || 'default') };
  }

  /**
   * Returns a data-URL QR for the WAHA session (to scan in the UI).
   *
   * Never reports a bare "no_qr": the session is healed first, and when a QR
   * genuinely can't exist the caller gets the real WAHA status plus a reason, so
   * the UI can say WHY (already connected / credentials revoked / image stale)
   * instead of a dead end.
   */
  async qr(tenantId: string, outletId?: string | null): Promise<{ qr: string | null; status: string; reason?: string }> {
    const cfg = await this.config(tenantId, outletId);
    if (this.isMockActive(cfg)) return { qr: null, status: 'WORKING' };
    if (cfg?.wa_connection_missing) return { qr: null, status: 'not_configured' };
    if (cfg?.wa_provider === 'kirim') return { qr: null, status: 'kirim' };
    const session = cfg?.waha_session || 'default';

    const ensured = await this.ensureSession(tenantId, outletId);
    // A QR only exists in SCAN_QR_CODE. Anything else: say what state we're in.
    if (ensured.status === 'WORKING') {
      return { qr: null, status: 'WORKING', reason: ensured.reason ?? 'Already connected — no QR needed.' };
    }
    if (ensured.status !== 'SCAN_QR_CODE') {
      return { qr: null, status: ensured.status, reason: ensured.reason };
    }

    try {
      const res = await fetch(`${this.wahaUrl}/api/${encodeURIComponent(session)}/auth/qr?format=image`, { headers: this.wahaHeaders() });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        this.logger.warn(`WAHA QR '${session}' → HTTP ${res.status} ${detail.slice(0, 200)}`);
        return { qr: null, status: await this.rawStatus(session), reason: `WAHA could not produce a QR (HTTP ${res.status}). Try again in a moment.` };
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return { qr: `data:image/png;base64,${buf.toString('base64')}`, status: 'qr', reason: ensured.reason };
    } catch { return { qr: null, status: 'unreachable', reason: 'WAHA service is not reachable.' }; }
  }

  // ── Outbound ────────────────────────────────────────────────────────────────
  // outletId selects the branch line (per-branch WhatsApp); omit for the tenant line.
  /**
   * Build a WhatsApp chatId from a phone/JID, normalizing Indonesian local format
   * (leading 0) to canonical 62… — WAHA cannot route "08xx@c.us". Fixes outbound
   * to any number stored in local format (payment/voucher/broadcast/booking notes).
   */
  private toChatId(to: string): string {
    if (to.includes('@')) return to;
    const { normalized, valid } = normalizePhone(to);
    const digits = valid && normalized ? normalized : to.replace(/[^0-9]/g, '');
    return `${digits}@c.us`;
  }

  /**
   * Build the E.164 recipient kirimdev's Cloud-API-compatible `to` field
   * requires (leading '+'). Normalises Indonesian local format (leading 0)
   * the same way {@link toChatId} does for WAHA; falls back to bare digits.
   */
  private toE164(to: string): string {
    const bare = to.includes('@') ? to.replace(/@.*/, '') : to;
    const { normalized, valid } = normalizePhone(bare);
    const digits = valid && normalized ? normalized : bare.replace(/[^0-9]/g, '');
    return `+${digits}`;
  }

  async sendText(tenantId: string, to: string, rawText: string, outletId?: string | null): Promise<boolean> {
    // WhatsApp doesn't render Markdown — normalise **bold**/links/headings the LLM
    // emits into WhatsApp markup (single-* bold) at this single outbound chokepoint.
    const text = formatForWhatsApp(rawText);
    // formatForWhatsApp returns '' when the payload was nothing but the model's
    // own deliberation. Refuse the send rather than deliver a scratchpad (or a
    // blank bubble) — loudly, because it means an upstream guard was bypassed.
    if (rawText.trim() !== '' && text.trim() === '') {
      this.logger.error(`Blocked an outbound WhatsApp message that was model reasoning, not a reply (tenant ${tenantId}, to ${to})`);
      return false;
    }
    const cfg = await this.config(tenantId, outletId);
    if (!cfg) return false;
    // Per-branch on but this branch has no line of its own: no-op (require own number).
    if (cfg.wa_connection_missing) return false;
    // Simulation bypass: record what WOULD be sent, skip the gateway entirely.
    if (this.isMockActive(cfg)) return this.recordMockOutbox(tenantId, cfg, to, text);
    try {
      if (cfg.wa_provider === 'kirim') {
        if (!cfg.kirim_api_key || !cfg.kirim_phone_id) return false;
        const res = await fetch(`${this.kirimUrl}/${encodeURIComponent(cfg.kirim_phone_id)}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.kirim_api_key}` },
          body: JSON.stringify({ messaging_product: 'whatsapp', to: this.toE164(to), type: 'text', text: { body: text } }),
        });
        if (!res.ok) this.logger.warn(`kirim send to ${to} failed: HTTP ${res.status}`);
        return res.ok;
      }
      const session = cfg.waha_session || 'default';
      const chatId = this.toChatId(to);
      const res = await fetch(`${this.wahaUrl}/api/sendText`, {
        method: 'POST', headers: this.wahaHeaders(true),
        body: JSON.stringify({ session, chatId, text }),
      });
      // Surface delivery failures instead of swallowing them — a locally-formatted
      // number that reaches WAHA unroutable (the old bug) used to fail silently.
      if (!res.ok) this.logger.warn(`WA send to ${chatId} failed: HTTP ${res.status}`);
      return res.ok;
    } catch (e) { this.logger.warn(`WA send failed: ${String(e)}`); return false; }
  }

  /**
   * Send a message with reply buttons where the provider supports them, else a
   * plain-text prompt listing the options. Interactive reply buttons are only
   * reliable on the official WhatsApp Business API (kirimdev, Meta-compatible);
   * WAHA (WhatsApp Web) restricts them, so it gets the text fallback. Either
   * way, tapping a button returns its title as a normal inbound message — so
   * downstream keyword gates (booking confirm YA/BATAL, staff TERIMA/TOLAK)
   * resolve it identically.
   */
  async sendButtons(tenantId: string, to: string, body: string, buttons: { id: string; title: string }[], outletId?: string | null): Promise<boolean> {
    const cfg = await this.config(tenantId, outletId);
    if (!cfg) return false;
    if (cfg.wa_connection_missing) return false;
    const textFallback = `${body}\n\n${buttons.map((b) => `• ${b.title}`).join('\n')}`;
    if (this.isMockActive(cfg)) return this.recordMockOutbox(tenantId, cfg, to, textFallback);
    try {
      if (cfg.wa_provider === 'kirim') {
        if (!cfg.kirim_api_key || !cfg.kirim_phone_id) return false;
        const res = await fetch(`${this.kirimUrl}/${encodeURIComponent(cfg.kirim_phone_id)}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.kirim_api_key}` },
          body: JSON.stringify({
            messaging_product: 'whatsapp', to: this.toE164(to), type: 'interactive',
            interactive: {
              type: 'button',
              body: { text: body },
              action: { buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })) },
            },
          }),
        });
        if (res.ok) return true;
        this.logger.warn(`kirim interactive send failed (HTTP ${res.status}); text fallback`);
        return this.sendText(tenantId, to, textFallback, outletId);
      }
      // WAHA / WhatsApp Web: buttons unreliable — send the text prompt.
      return this.sendText(tenantId, to, textFallback, outletId);
    } catch (e) {
      this.logger.warn(`sendButtons failed: ${String(e)}; text fallback`);
      return this.sendText(tenantId, to, textFallback, outletId);
    }
  }

  /**
   * Simulation bypass sink for outbound. Records the resolved payload to
   * wa_mock_outbox (so the UI can show exactly what would hit the gateway) and
   * reports success — so the rest of the pipeline behaves as if delivered.
   */
  private async recordMockOutbox(tenantId: string, cfg: AgentCfgRow, to: string, text: string): Promise<boolean> {
    const provider = cfg.wa_provider === 'kirim' ? 'kirim' : 'waha';
    const session = provider === 'waha' ? (cfg.waha_session || 'default') : null;
    const chatId = this.toChatId(to);
    try {
      await this.pool.query(
        `INSERT INTO wa_mock_outbox (tenant_id, provider, chat_id, to_phone, body, session) VALUES ($1,$2,$3,$4,$5,$6)`,
        [tenantId, provider, chatId, to, text, session],
      );
      this.logger.log(`[WAHA_MOCK] would send to ${chatId} via ${provider}: ${text.slice(0, 120)}`);
      return true;
    } catch (e) {
      this.logger.warn(`[WAHA_MOCK] failed to record outbox: ${String(e)}`);
      return false;
    }
  }

  /** Read the simulated outbound sends for the tenant (mock outbox view). */
  async listMockOutbox(tenantId: string): Promise<Record<string, unknown>[]> {
    const r = await this.pool.query(
      `SELECT id, provider, chat_id, to_phone, body, session, created_at
       FROM wa_mock_outbox WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [tenantId],
    );
    return r.rows.map((m) => ({
      id: m.id, provider: m.provider, chatId: m.chat_id, toPhone: m.to_phone,
      body: m.body, session: m.session, createdAt: m.created_at,
    }));
  }

  /**
   * Verify a kirimdev webhook request. Header shape: `X-Kirim-Signature:
   * t=<unixSeconds>,v1=<hexHmac>[,v1=...]`. The HMAC is SHA-256 over the exact
   * string `${t}.${rawBody}` using the webhook signing secret, taken over the
   * RAW body bytes (must be verified BEFORE JSON parsing). Also enforces a
   * 300s timestamp tolerance to reject replays. When no secret is configured
   * (sandbox/unconfigured), verification is skipped — logged once — so local
   * dev/testing isn't blocked on a secret that doesn't exist yet.
   */
  verifyKirimSignature(rawBody: string, header: string | undefined): boolean {
    if (!this.kirimWebhookSecret) {
      if (!this.kirimWebhookSecretWarned) {
        this.kirimWebhookSecretWarned = true;
        this.logger.warn('KIRIM_WEBHOOK_SECRET is not set; skipping kirim webhook signature verification (sandbox mode)');
      }
      return true;
    }
    if (!header) return false;
    const t = header.match(/(?:^|,)\s*t=([^,]+)/)?.[1];
    if (!t || !/^\d+$/.test(t)) return false;
    const skewSec = Math.abs(Date.now() / 1000 - Number(t));
    if (skewSec > 300) return false;
    const v1s = [...header.matchAll(/v1=([0-9a-f]+)/g)].map((m) => m[1]!);
    if (v1s.length === 0) return false;
    const expected = createHmac('sha256', this.kirimWebhookSecret).update(`${t}.${rawBody}`).digest('hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    return v1s.some((sig) => {
      const sigBuf = Buffer.from(sig, 'hex');
      return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
    });
  }

  /**
   * Process a verified kirimdev webhook payload (Meta's exact envelope):
   * entry[].changes[].value with either `messages[]` (inbound text) or
   * `statuses[]` (delivery receipts — ignored, no reply needed). Resolves the
   * owning tenant/branch by the `phone_number_id` in `value.metadata` and hands
   * each text message to the same {@link handleInbound} pipeline WAHA uses.
   * Per-message errors are caught and logged so one bad message in a batch
   * doesn't drop the rest.
   */
  async handleKirimWebhook(body: any): Promise<void> {
    const entries: any[] = Array.isArray(body?.entry) ? body.entry : [];
    for (const entry of entries) {
      const changes: any[] = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        const value = change?.value;
        if (!value) continue;
        const messages: any[] = Array.isArray(value.messages) ? value.messages : [];
        if (messages.length === 0) continue; // statuses-only change: delivery receipt, no reply
        const phoneId: string | undefined = value.metadata?.phone_number_id;
        if (!phoneId) continue;
        const resolved = await this.resolveByPhoneId(phoneId).catch(() => null);
        if (!resolved) {
          this.logger.warn(`kirim webhook: no tenant configured for phone_number_id ${phoneId}`);
          continue;
        }
        const name: string | undefined = value.contacts?.[0]?.profile?.name;
        for (const msg of messages) {
          if (msg?.type !== 'text' || !msg?.text?.body) continue;
          try {
            await this.handleInbound({
              tenantId: resolved.tenantId, outletId: resolved.outletId,
              from: msg.from, name, text: msg.text.body,
            });
          } catch (e) {
            this.logger.error(`kirim handleInbound failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }
    }
  }

  // ── Inbound (from WAHA/kirimdev webhook) ─────────────────────────────────────
  async handleInbound(params: { tenantId?: string; outletId?: string | null; session?: string; from: string; name?: string; text: string; isGroup?: boolean; author?: string | null; mentions?: string[] }): Promise<void> {
    // Resolve tenant + branch. A session on a branch line scopes to that outlet;
    // simulate-inbound may pass tenantId (+optional outletId) directly.
    let tenantId = params.tenantId ?? null;
    let outletId: string | null = params.outletId ?? null;
    if (!tenantId && params.session) {
      const resolved = await this.resolveBySession(params.session);
      if (resolved) { tenantId = resolved.tenantId; outletId = resolved.outletId; }
    }
    if (!tenantId || !params.from || !params.text) return;

    // Ignore non-conversational WhatsApp system chats: status/story updates
    // (`status@broadcast`), broadcast lists (`…@broadcast`) and channel
    // "newsletters" (`…@newsletter`) are not customers and must never get a reply.
    if (/@(broadcast|newsletter)$/i.test(params.from) || params.from.startsWith('status@')) return;

    const cfg = await this.config(tenantId, outletId);

    // GROUP GATE: in a group chat (`from` = …@g.us) the bot must stay silent
    // unless it is @mentioned — otherwise it replies to every message in the
    // group. Gate BEFORE anything is logged so ignored group chatter leaves no
    // trace. Direct messages (…@c.us) always pass through.
    const isGroup = params.isGroup ?? params.from.includes('@g.us');
    if (isGroup && !this.isBotMentioned(params.text, params.mentions, cfg?.wa_number ?? null)) {
      return;
    }
    // In a group the "customer" is the participant who wrote (bind their number),
    // but replies go back to the group thread (params.from). In a DM they match.
    const senderPhone = isGroup ? (this.digitsOf(params.author) ?? params.from) : params.from;
    const inboundText = isGroup ? this.stripBotMention(params.text) : params.text;

    const conv = await this.upsertConversation(tenantId, params.from, params.name, outletId);
    await this.addMessage(tenantId, conv.id, 'inbound', params.text, false);

    // Staff-acknowledgement branch: a reply FROM the tenant's escalation number
    // resolving a booking awaiting staff approval (TERIMA → confirm, TOLAK →
    // cancel). Runs regardless of the AI reply switch so approvals always resolve,
    // and notifies the original customer of the decision. Replies go out on the
    // same (branch or tenant) line the message arrived on. DM only — a group is
    // never the escalation line.
    if (!isGroup && this.pendingBooking && cfg?.escalation_number && this.sameNumber(params.from, cfg.escalation_number)) {
      const ack = await this.pendingBooking.tryStaffAck(tenantId, params.from, params.text);
      if (ack.handled) {
        if (ack.reply) {
          await this.addMessage(tenantId, conv.id, 'outbound', ack.reply, true, 'Booking');
          await this.sendText(tenantId, params.from, ack.reply, outletId);
        }
        // Empty text = the owner switched that notification off; skip rather than
        // sending an empty bubble.
        if (ack.notifyCustomer?.text) {
          const custConv = await this.upsertConversation(tenantId, ack.notifyCustomer.phone, undefined, outletId);
          await this.addMessage(tenantId, custConv.id, 'outbound', ack.notifyCustomer.text, true, 'Booking');
          await this.sendText(tenantId, ack.notifyCustomer.phone, ack.notifyCustomer.text, outletId);
        }
        return;
      }
    }

    // STAFF BRANCH: a whitelisted number talks to the FULL business agent, not to
    // Irene. Runs BEFORE the customer switches on purpose — `ai_reply_enabled` is
    // the customer auto-reply pause and the daily cap is customer abuse protection;
    // neither should silence the owner's own console. The per-conversation
    // `ai_enabled` toggle IS honoured, so a chat can still be handed to a human.
    // DM only: a group is a shared room, never a private staff console.
    if (!isGroup && conv.ai_enabled && this.whitelist && this.staffChat) {
      const staff = await this.whitelist.match(tenantId, senderPhone);
      if (staff) {
        await this.handleStaffInbound({
          tenantId, outletId, conv, staff, chatId: params.from, text: inboundText,
        });
        return;
      }
    }

    if (!cfg || !cfg.ai_reply_enabled || !conv.ai_enabled) return;

    // Daily per-user cap.
    const today = new Date().toISOString().slice(0, 10);

    // Customer-confirmation gate: if this customer has a booking awaiting their
    // YES/NO, resolve it deterministically BEFORE any AI runs. A clear "YA" creates
    // the booking (status 'booked') and kicks off staff approval; "BATAL" cancels.
    // Runs ahead of the n8n dispatch so the gate behaves identically per engine.
    // DM only — the propose→confirm handshake keys on the direct chat, not a group.
    if (!isGroup && this.pendingBooking) {
      const outcome = await this.pendingBooking.tryConfirm(tenantId, params.from, params.text);
      if (outcome.handled && outcome.reply) {
        await this.addMessage(tenantId, conv.id, 'outbound', outcome.reply, true, 'Booking');
        await this.sendText(tenantId, params.from, outcome.reply, outletId);
        // Two-sided approval: ask the tenant's staff to accept/reject the booking.
        if (outcome.committed && outcome.staffApproval && cfg.escalation_number) {
          await this.requestStaffApproval(tenantId, cfg.escalation_number, outcome.staffApproval, outletId);
        }
        return;
      }
    }
    const used = conv.messages_day === today ? conv.messages_today : 0;
    if (used >= (cfg.max_messages_per_day ?? 50)) {
      await this.escalate(tenantId, conv.id, cfg, params.from, 'Daily message cap reached', outletId);
      return;
    }

    // ── Who are we talking to? ──────────────────────────────────────────────────
    // WhatsApp often hides the number behind a privacy @lid, so we can't always
    // match a customer by phone. Strategy: (1) if the chat is already bound to a
    // customer, use them; (2) else try to identify from what they just typed
    // (phone / member no. / plate) or, on a real-phone DM, from their own number,
    // and BIND it to the chat; (3) if still unknown, Irene asks once (see below).
    let boundCustomer: ResolvedCustomer | null = null;
    let justIdentified = false;
    // True only when we resolved them from an identifier they TYPED (phone/member
    // no./plate) — i.e. a reply to the identity ask. When their own phone number
    // simply matched a member on a normal question, this stays false so we answer
    // the question in the same turn instead of stopping at a bare "got it" ack.
    let identifiedFromText = false;
    // Name to greet by when the sender isn't a resolved member (their WA push
    // name, or a name they typed like "I'm Hansel").
    let displayNameHint: string | null = conv.customer_name ?? null;
    if (this.customerContext && !isGroup) {
      if (conv.identified_customer_id) {
        boundCustomer = await this.customerContext.resolveById(tenantId, conv.identified_customer_id);
      }
      if (!boundCustomer) {
        const fromText = await this.customerContext.resolveIdentityFromText(tenantId, inboundText);
        const found = fromText ?? (await this.customerContext.resolveCustomer(tenantId, senderPhone));
        if (found) {
          boundCustomer = found;
          justIdentified = true;
          identifiedFromText = !!fromText;
          await this.bindConversationCustomer(conv.id, found);
        } else {
          // Not a member (yet) — but if they introduced themselves, remember the
          // name for display + greeting (does NOT link an account).
          const stated = this.extractStatedName(inboundText);
          if (stated && !displayNameHint) {
            displayNameHint = stated;
            await this.setConversationName(conv.id, stated);
          }
        }
      }
    }

    // If they REPLIED WITH AN IDENTIFIER (phone/member no./plate) to the identity
    // ask, that reply carried no real question — acknowledge warmly and stop; their
    // next message carries the question (now resolved to their account). But when
    // their own phone simply matched a member on a normal question, DON'T stop:
    // fall through so the agent answers that question in the same turn.
    if (justIdentified && boundCustomer && identifiedFromText) {
      const ack = await renderNotification(this.renderer, tenantId, 'customer_linked_ack', {
        customerName: boundCustomer.name,
      });
      if (ack) {
        await this.addMessage(tenantId, conv.id, 'outbound', ack, true, 'Irene');
        await this.sendText(tenantId, params.from, ack, outletId);
      }
      return;
    }

    // n8n routing: if this tenant points their assistant at an n8n flow, hand the
    // message off to it. n8n calls back through the bridge (send + log + cap), so
    // we stop here on success. Any failure falls through to the built-in runtime.
    // (n8n replies via agentSend use the tenant line; branch-scoped n8n is future work.)
    if (cfg.routing_mode === 'n8n' && cfg.n8n_flow_id && cfg.bridge_token) {
      const dispatched = await this.dispatchToN8n(tenantId, cfg, {
        conversationId: conv.id, from: params.from, name: params.name, text: params.text,
      });
      if (dispatched) return;
      this.logger.warn(`n8n dispatch failed for tenant ${tenantId}; falling back to built-in runtime`);
    }

    const history = await this.recentHistory(tenantId, conv.id);
    const result = await this.runtime.generate({
      tenantId,
      fromPhone: senderPhone,
      // Resolve the customer by their bound/real number, not the privacy @lid.
      resolvePhone: boundCustomer?.phone ?? boundCustomer?.normalized ?? senderPhone,
      // Address non-members by the name they gave (push name / "I'm Hansel").
      displayName: boundCustomer?.name ?? displayNameHint,
      outletId,
      text: inboundText,
      basePrompt: cfg.base_prompt,
      knowledge: cfg.product_knowledge,
      skills: cfg.skills,
      history,
    });
    if (result.escalate || !result.text) {
      await this.escalate(tenantId, conv.id, cfg, params.from, params.text, outletId);
      return;
    }
    let outText = result.text;
    // Proposed booking: DON'T trust the model's wording (it sometimes claims the
    // booking is already confirmed). Read the summary back deterministically and
    // ask for YA/BATAL — the booking is only created after the customer confirms.
    if (result.proposedBooking && result.bookingSummary) {
      outText = `Baik kak, Irene siapkan booking berikut ya:\n\n${result.bookingSummary}\n\nBalas *YA* untuk konfirmasi, atau *BATAL* untuk membatalkan. 🙏`;
    }
    // Ask for identity ONCE per chat when we still don't know the sender, so we
    // can personalise from here on (introduce → ask → bind on their reply).
    if (this.customerContext && !isGroup && !boundCustomer && !conv.identity_prompted) {
      outText = `${outText}\n\n${IDENTITY_ASK}`;
      await this.markIdentityPrompted(conv.id);
    }
    await this.addMessage(tenantId, conv.id, 'outbound', outText, true, result.agentName);
    await this.pool.query(
      `UPDATE wa_conversations SET messages_today = CASE WHEN messages_day = $2 THEN messages_today + 1 ELSE 1 END, messages_day = $2 WHERE id = $1`,
      [conv.id, today],
    );
    // When the agent just PROPOSED a booking, offer YA/BATAL as reply buttons
    // (falls back to a text prompt where buttons aren't supported). Tapping a
    // button sends its title back, which the confirmation gate resolves next turn.
    if (result.proposedBooking) {
      await this.sendButtons(tenantId, params.from, outText, [{ id: 'YA', title: 'YA' }, { id: 'BATAL', title: 'BATAL' }], outletId);
    } else {
      await this.sendText(tenantId, params.from, outText, outletId);
    }
  }

  /**
   * One turn for a WHITELISTED (staff) number: the dashboard assistant, over WhatsApp.
   *
   * The thread is bound to a real chat session (`wa_conversations.chat_session_id`),
   * so follow-ups like "and yesterday?" keep their context and the same transcript
   * shows up in the dashboard's chat history. `access_level` decides whether the
   * agent may act or only look.
   */
  private async handleStaffInbound(params: {
    tenantId: string;
    outletId: string | null;
    conv: { id: string; chat_session_id?: string | null };
    staff: { id: string; label: string; accessLevel: 'full' | 'read_only'; userId: string | null };
    chatId: string;
    text: string;
  }): Promise<void> {
    const { tenantId, outletId, conv, staff } = params;
    try {
      const result = await this.staffChat!.chat(
        tenantId,
        // A whitelist row may be bound to a real user, in which case the thread
        // lands in THAT person's dashboard history. An unbound row (a shared shop
        // phone) produces a tenant-wide thread visible to the tenant's dashboard
        // users — who can already ask the same assistant the same questions.
        staff.userId,
        outletId,
        conv.chat_session_id ?? null,
        params.text,
        {
          readOnly: staff.accessLevel === 'read_only',
          surfaceNote:
            `You are Airin AI Assistant answering ${staff.label} over WhatsApp. Keep replies SHORT (a few lines, no tables `
            + 'or markdown headings) because they are read on a phone. Use *bold* sparingly for key numbers. Reply in the '
            + 'language they wrote in.',
        },
      );

      if (result.sessionId && result.sessionId !== conv.chat_session_id) {
        await this.pool.query(`UPDATE wa_conversations SET chat_session_id = $2 WHERE id = $1`, [
          conv.id,
          result.sessionId,
        ]);
      }
      await this.whitelist!.markUsed(staff.id);

      const outText = formatForWhatsApp(result.reply);
      await this.addMessage(tenantId, conv.id, 'outbound', outText, true, 'Airin');
      await this.sendText(tenantId, params.chatId, outText, outletId);
    } catch (err) {
      // A staff console that goes silent is worse than one that admits a fault:
      // the owner is standing at the counter waiting for a number.
      this.logger.error(`staff agent turn failed: ${err instanceof Error ? err.message : String(err)}`);
      const fallback = 'Maaf, Airin sedang tidak bisa dihubungi. Coba lagi sebentar ya. / Airin AI Assistant is unavailable right now.';
      await this.addMessage(tenantId, conv.id, 'outbound', fallback, true, 'Airin');
      await this.sendText(tenantId, params.chatId, fallback, outletId);
    }
  }

  /** Normalized phone equality (ignores +, spaces, @c.us, leading-zero vs 62). */
  private sameNumber(a?: string | null, b?: string | null): boolean {
    const da = (a || '').replace(/@.*/, '').replace(/\D/g, '');
    const db = (b || '').replace(/@.*/, '').replace(/\D/g, '');
    if (!da || !db) return false;
    if (da === db) return true;
    const min = Math.min(da.length, db.length);
    return min >= 8 && da.slice(-min) === db.slice(-min);
  }

  /** Bare digits of a phone/JID (drops @suffix, +, spaces). Null when empty. */
  private digitsOf(s?: string | null): string | null {
    const d = (s || '').replace(/@.*/, '').replace(/\D/g, '');
    return d || null;
  }

  /**
   * Whether the connected bot number was @mentioned in a group message. Checks
   * the webhook's mention list (WEBJS/NOWEB shapes) and any inline "@<number>"
   * typed in the body. If the bot number is unknown we return false — the safe
   * default is to stay silent in groups rather than risk replying to everything.
   */
  private isBotMentioned(text: string, mentions: string[] | undefined, botNumber: string | null): boolean {
    if (!this.digitsOf(botNumber)) return false;
    if (mentions?.some((m) => this.sameNumber(m, botNumber))) return true;
    const inline = (text || '').match(/@\+?\d[\d\s-]{4,}/g) || [];
    // Strip the LEADING '@' first — sameNumber() drops everything after an '@',
    // which would otherwise blank out an inline "@<number>" token.
    return inline.some((tok) => this.sameNumber(tok.replace(/^@/, ''), botNumber));
  }

  /** Remove inline "@<number>" mention tokens so the agent sees the clean question. */
  private stripBotMention(text: string): string {
    const cleaned = (text || '').replace(/@\+?\d[\d\s-]{4,}/g, ' ').replace(/\s{2,}/g, ' ').trim();
    return cleaned || (text || '');
  }

  /** Store the staff-ack request on the escalation conversation and prompt staff. */
  private async requestStaffApproval(
    tenantId: string,
    staffNumber: string,
    approval: { bookingId: string; summary: string; customerPhone: string },
    outletId?: string | null,
  ): Promise<void> {
    if (!this.pendingBooking) return;
    const staffConv = await this.upsertConversation(tenantId, staffNumber, undefined, outletId);
    // Short code lets staff disambiguate when several bookings are pending at once.
    const ref = PendingBookingService.refFor(approval.bookingId);
    await this.pendingBooking.setStaffAck(staffConv.id, { ...approval, ref });
    const text = (await renderNotification(this.renderer, tenantId, 'booking_approval_request', {
      ref,
      bookingSummary: approval.summary,
      customerPhone: approval.customerPhone,
    })) ?? '';
    if (!text) return;
    await this.addMessage(tenantId, staffConv.id, 'outbound', text, true, 'Booking');
    await this.sendButtons(tenantId, staffNumber, text, [{ id: `TERIMA ${ref}`, title: `TERIMA ${ref}` }, { id: `TOLAK ${ref}`, title: `TOLAK ${ref}` }], outletId);
  }

  /** Last few turns of the conversation, mapped to LLM chat roles. */
  private async recentHistory(tenantId: string, convId: string): Promise<ChatMessage[]> {
    const r = await this.pool.query(
      `SELECT direction, body FROM wa_messages
       WHERE tenant_id = $1 AND conversation_id = $2
       ORDER BY created_at DESC LIMIT 8`,
      [tenantId, convId],
    );
    return r.rows
      .reverse()
      .map((m: { direction: string; body: string }) => ({
        role: m.direction === 'inbound' ? ('user' as const) : ('assistant' as const),
        content: m.body,
      }));
  }

  /**
   * Hand an inbound message to the tenant's selected n8n flow. Posts the message
   * plus everything a template workflow needs (bridge token, callback base, and
   * the tenant's persona so ONE flow serves all tenants). Returns true on 2xx.
   */
  private async dispatchToN8n(
    tenantId: string,
    cfg: AgentCfgRow,
    msg: { conversationId: string; from: string; name?: string; text: string },
  ): Promise<boolean> {
    const flow = await this.pool.query<{ webhook_url: string }>(
      `SELECT webhook_url FROM agent_flows WHERE id = $1 AND enabled = true AND kind = 'whatsapp'`,
      [cfg.n8n_flow_id],
    );
    const webhookUrl = flow.rows[0]?.webhook_url;
    if (!webhookUrl) return false;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'whatsapp.inbound',
          tenantId,
          bridgeToken: cfg.bridge_token,
          callbackBaseUrl: this.bridgeCallbackBase,
          conversationId: msg.conversationId,
          message: { from: msg.from, name: msg.name ?? null, text: msg.text },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.ok;
    } catch (e) {
      this.logger.warn(`n8n webhook call failed: ${String(e)}`);
      return false;
    }
  }

  /**
   * Send a reply that originated from an n8n flow (via the bridge): logs it to
   * the Conversation Log as an AI message, counts it against the daily cap, and
   * delivers it. Called by BridgeController — scoped to the resolved tenant.
   */
  async agentSend(tenantId: string, to: string, text: string, persona?: string | null): Promise<boolean> {
    const conv = await this.upsertConversation(tenantId, to);
    await this.addMessage(tenantId, conv.id, 'outbound', text, true, persona ?? null);
    const today = new Date().toISOString().slice(0, 10);
    await this.pool.query(
      `UPDATE wa_conversations SET messages_today = CASE WHEN messages_day = $2 THEN messages_today + 1 ELSE 1 END, messages_day = $2 WHERE id = $1`,
      [conv.id, today],
    );
    return this.sendText(tenantId, to, text);
  }

  private async escalate(tenantId: string, convId: string, cfg: AgentCfgRow | null, from: string, reason: string, outletId?: string | null): Promise<void> {
    await this.pool.query(`UPDATE wa_conversations SET status = 'escalated' WHERE id = $1`, [convId]);
    const ack = await renderNotification(this.renderer, tenantId, 'escalation_ack', {});
    if (ack) {
      await this.addMessage(tenantId, convId, 'outbound', ack, true, 'Escalation');
      await this.sendText(tenantId, from, ack, outletId);
    }
    // Alert the tenant's escalation number on their OWN line. This used to go
    // through NotificationService.sendWhatsApp, i.e. the unconfigured Meta
    // Business API — so the team was never actually paged when a customer got
    // escalated. sendText is right here anyway: it is this very class.
    if (cfg?.escalation_number) {
      try {
        const alert = await renderNotification(this.renderer, tenantId, 'escalation_alert', { from, reason });
        if (alert) await this.sendText(tenantId, cfg.escalation_number, alert, outletId);
      } catch { /* best-effort */ }
    }
  }

  /**
   * Escalate a conversation to a human by phone number — the entry point the n8n
   * flow calls via the bridge (`POST /api/bridge/escalate`). Resolves the
   * conversation, marks it escalated, sends the customer an acknowledgement, and
   * notifies the tenant's escalation number. Idempotent-friendly (upserts conv).
   */
  async escalateByPhone(tenantId: string, fromPhone: string, reason = 'Escalated by agent flow'): Promise<{ ok: boolean }> {
    const cfg = await this.config(tenantId);
    const conv = await this.upsertConversation(tenantId, fromPhone);
    await this.escalate(tenantId, conv.id, cfg, fromPhone, reason);
    return { ok: true };
  }

  // ── Conversation store ───────────────────────────────────────────────────────
  private async upsertConversation(tenantId: string, chatId: string, name?: string, outletId?: string | null): Promise<{ id: string; ai_enabled: boolean; messages_today: number; messages_day: string | null; identified_customer_id?: string | null; identity_prompted?: boolean; customer_name?: string | null; chat_session_id?: string | null }> {
    const phone = chatId.replace(/@.*/, '');
    // Conflict target matches uq_wa_conv_tenant_outlet_chat (migration 067): a
    // NULL outlet_id (tenant line) coalesces to the all-zero UUID sentinel, so
    // branch and tenant lines get distinct conversation rows for the same phone.
    const res = await this.pool.query(
      `INSERT INTO wa_conversations (tenant_id, chat_id, customer_phone, customer_name, outlet_id, last_message_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (tenant_id, chat_id, (COALESCE(outlet_id, '00000000-0000-0000-0000-000000000000'::uuid))) DO UPDATE SET last_message_at = NOW(),
         customer_name = COALESCE(wa_conversations.customer_name, EXCLUDED.customer_name)
       RETURNING id, ai_enabled, messages_today, messages_day::text, identified_customer_id, identity_prompted, customer_name, chat_session_id`,
      [tenantId, chatId, phone, name ?? null, outletId ?? null],
    );
    return res.rows[0];
  }

  /**
   * Pull a self-introduced name out of a message ("I'm Hansel", "nama saya Budi",
   * "aku Rina"). Returns a tidy 1–3 word name or null. This is a DISPLAY name only
   * — it does not link an account (that needs a phone / member no. / plate).
   */
  private extractStatedName(text: string): string | null {
    const m = (text || '').match(/(?:nama\s+saya|nama\s+aku|nama\s+ku|saya\s+ini|this\s+is|i\s?['’]?m|i\s+am|namaku|saya|aku)\s+([A-Za-z][A-Za-z'’.-]*(?:\s+[A-Za-z][A-Za-z'’.-]*){0,2})/i);
    if (!m || !m[1]) return null;
    // Keep only the leading name tokens, stopping at a common non-name word.
    const STOP = new Set(['mau', 'ingin', 'butuh', 'pengen', 'mo', 'minta', 'want', 'need', 'would', 'will',
      'di', 'ke', 'dari', 'ada', 'tanya', 'nanya', 'pesan', 'order', 'booking', 'cuci', 'the', 'a', 'an',
      'just', 'only', 'here', 'disini', 'cuma']);
    const kept: string[] = [];
    for (const tok of m[1].trim().split(/\s+/)) {
      if (STOP.has(tok.toLowerCase())) break;
      kept.push(tok);
      if (kept.length >= 2) break;
    }
    const name = kept.join(' ');
    if (name.length < 2 || name.length > 40) return null;
    // Title-case for display.
    return name.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /** Store a display name on the conversation if it doesn't already have one. */
  private async setConversationName(convId: string, name: string): Promise<void> {
    await this.pool.query(
      `UPDATE wa_conversations SET customer_name = $2 WHERE id = $1 AND (customer_name IS NULL OR customer_name = '')`,
      [convId, name],
    );
  }

  /** Bind a resolved customer to a conversation so later turns are personalised. */
  private async bindConversationCustomer(convId: string, customer: ResolvedCustomer): Promise<void> {
    await this.pool.query(
      `UPDATE wa_conversations
         SET identified_customer_id = $2, identified_phone = $3, customer_name = COALESCE(customer_name, $4), identity_prompted = true
       WHERE id = $1`,
      [convId, customer.id, customer.phone ?? customer.normalized ?? null, customer.name ?? null],
    );
  }

  /** Record that we've already asked this chat to identify itself (ask only once). */
  private async markIdentityPrompted(convId: string): Promise<void> {
    await this.pool.query(`UPDATE wa_conversations SET identity_prompted = true WHERE id = $1`, [convId]);
  }

  private async addMessage(tenantId: string, convId: string, direction: 'inbound' | 'outbound', body: string, fromAi: boolean, persona: string | null = null): Promise<void> {
    await this.pool.query(
      `INSERT INTO wa_messages (tenant_id, conversation_id, direction, body, from_ai, persona) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tenantId, convId, direction, body, fromAi, persona],
    );
    await this.pool.query(`UPDATE wa_conversations SET last_message_at = NOW() WHERE id = $1`, [convId]);
  }

  // ── Read/admin APIs for the Conversation Log ──────────────────────────────────
  async listConversations(tenantId: string): Promise<Record<string, unknown>[]> {
    // Match real-phone DMs to a member record so the list can show the customer's
    // name (WhatsApp-style). Groups (@g.us) and privacy IDs (@lid) have no dialable
    // phone, so they never match — they're labelled by kind instead. The customer
    // phone is normalised the same way as phone_normalized (canonical 62…).
    const r = await this.pool.query(
      `SELECT c.id, c.chat_id, c.customer_name, c.customer_phone, c.ai_enabled, c.status, c.summary,
              c.last_message_at, c.outlet_id, o.name AS outlet_name,
              idc.name AS identified_name, idc.phone AS identified_customer_phone, cust.name AS matched_name
       FROM wa_conversations c
       LEFT JOIN outlets o ON o.id = c.outlet_id
       LEFT JOIN customers idc ON idc.id = c.identified_customer_id AND idc.tenant_id = c.tenant_id
       LEFT JOIN LATERAL (
         SELECT cu.name FROM customers cu
         WHERE cu.tenant_id = c.tenant_id
           AND (c.chat_id LIKE '%@c.us' OR c.chat_id LIKE '%@s.whatsapp.net' OR c.chat_id !~ '@')
           AND cu.phone_normalized = CASE
             WHEN left(regexp_replace(c.customer_phone, '\\D', '', 'g'), 2) = '62' THEN regexp_replace(c.customer_phone, '\\D', '', 'g')
             WHEN left(regexp_replace(c.customer_phone, '\\D', '', 'g'), 1) = '0'  THEN '62' || substring(regexp_replace(c.customer_phone, '\\D', '', 'g') from 2)
             ELSE regexp_replace(c.customer_phone, '\\D', '', 'g')
           END
         LIMIT 1
       ) cust ON true
       WHERE c.tenant_id = $1 ORDER BY c.last_message_at DESC NULLS LAST LIMIT 200`,
      [tenantId],
    );
    return r.rows.map((c) => {
      const chatId: string = c.chat_id ?? '';
      const suffix = chatId.includes('@') ? chatId.split('@')[1] : '';
      const digits = String(c.customer_phone ?? '').replace(/\D/g, '');
      const kind =
        suffix === 'g.us' ? 'group'
        : suffix === 'lid' ? 'lid'
        : (suffix === 'broadcast' || chatId.startsWith('status@')) ? 'broadcast'
        : (suffix === 'c.us' || suffix === 's.whatsapp.net' || suffix === '') ? 'dm'
        : 'other';
      // A customer explicitly bound to this chat (e.g. after identifying over @lid)
      // wins over a phone match; either one means "this is a known member".
      const matchedName: string | null = c.identified_name ?? c.matched_name ?? null;
      const phone = c.identified_customer_phone
        ? String(c.identified_customer_phone).replace(/\D/g, '')
        : (kind === 'dm' && digits ? digits : null);
      const displayName =
        matchedName
        ?? c.customer_name // a name they gave / WA push name (shown even for @lid)
        ?? (kind === 'dm' ? (digits || chatId)
          : kind === 'group' ? 'Grup WhatsApp'
          : kind === 'lid' ? 'Nomor tersembunyi (privasi)'
          : kind === 'broadcast' ? 'WhatsApp Status'
          : chatId);
      return {
        id: c.id, chatId, kind, phone, displayName, isMember: !!matchedName,
        customerName: c.customer_name, customerPhone: c.customer_phone,
        aiEnabled: c.ai_enabled, status: c.status, summary: c.summary, lastMessageAt: c.last_message_at,
        outletId: c.outlet_id ?? null, outletName: c.outlet_name ?? null,
      };
    });
  }

  async listMessages(tenantId: string, convId: string): Promise<Record<string, unknown>[]> {
    const r = await this.pool.query(
      `SELECT direction, body, from_ai, persona, created_at FROM wa_messages WHERE tenant_id = $1 AND conversation_id = $2 ORDER BY created_at ASC LIMIT 500`,
      [tenantId, convId],
    );
    return r.rows.map((m) => ({ direction: m.direction, body: m.body, fromAi: m.from_ai, persona: m.persona ?? null, createdAt: m.created_at }));
  }

  async setConversation(tenantId: string, convId: string, patch: { aiEnabled?: boolean; status?: string }): Promise<void> {
    const set: string[] = []; const v: unknown[] = []; let i = 1;
    if (patch.aiEnabled !== undefined) { set.push(`ai_enabled = $${i++}`); v.push(patch.aiEnabled); }
    if (patch.status !== undefined) { set.push(`status = $${i++}`); v.push(patch.status); }
    if (set.length === 0) return;
    v.push(convId, tenantId);
    await this.pool.query(`UPDATE wa_conversations SET ${set.join(', ')} WHERE id = $${i} AND tenant_id = $${i + 1}`, v);
  }

  /** Bookings awaiting staff acknowledgement (dashboard approvals view). */
  async listPendingApprovals(tenantId: string): Promise<Record<string, unknown>[]> {
    if (!this.pendingBooking) return [];
    const rows = await this.pendingBooking.listPendingApprovals(tenantId);
    return rows.map((r) => ({
      bookingId: r.bookingId, summary: r.summary, customerPhone: r.customerPhone, proposedAt: r.proposedAt,
    }));
  }

  /**
   * Approve/reject a pending booking FROM THE DASHBOARD. Updates the booking,
   * clears the WhatsApp approval prompt, and notifies the customer — the same
   * outcome as a staff TERIMA/TOLAK reply, just triggered from the web.
   */
  async decidePendingApproval(tenantId: string, bookingId: string, accept: boolean, decidedBy: string): Promise<{ ok: boolean }> {
    if (!this.pendingBooking) return { ok: false };
    const outcome = await this.pendingBooking.resolveByBookingId(tenantId, bookingId, accept, decidedBy);
    if (!outcome) return { ok: false };
    if (outcome.notifyCustomer?.text) {
      const conv = await this.upsertConversation(tenantId, outcome.notifyCustomer.phone);
      await this.addMessage(tenantId, conv.id, 'outbound', outcome.notifyCustomer.text, true, 'Booking');
      await this.sendText(tenantId, outcome.notifyCustomer.phone, outcome.notifyCustomer.text);
    }
    return { ok: true };
  }

  /** Recent booking-approval decisions (audit trail). */
  async listApprovalHistory(tenantId: string): Promise<Record<string, unknown>[]> {
    if (!this.pendingBooking) return [];
    return this.pendingBooking.listApprovalHistory(tenantId);
  }

  /** Reset (new session): close the conversation and clear AI state. */
  async newSession(tenantId: string, convId: string): Promise<void> {
    await this.pool.query(`UPDATE wa_conversations SET status = 'closed' WHERE id = $1 AND tenant_id = $2`, [convId, tenantId]);
  }

  async manualSend(tenantId: string, convId: string, text: string): Promise<void> {
    const c = await this.pool.query('SELECT chat_id FROM wa_conversations WHERE id = $1 AND tenant_id = $2', [convId, tenantId]);
    const chatId = c.rows[0]?.chat_id;
    if (!chatId) return;
    await this.addMessage(tenantId, convId, 'outbound', text, false);
    await this.sendText(tenantId, chatId, text);
  }

  /**
   * Summarize a conversation. Uses the tenant's own LLM to produce a short,
   * useful recap (intent, outcome, whether follow-up is needed) grounded in the
   * transcript. Falls back to a deterministic counts string if the LLM is
   * unavailable, not configured, or errors — so the button always returns
   * something. The summary is persisted on the conversation.
   */
  async summarize(tenantId: string, convId: string): Promise<string> {
    const msgs = await this.pool.query<{ direction: string; body: string; from_ai: boolean }>(
      `SELECT direction, body, from_ai FROM wa_messages
       WHERE tenant_id = $1 AND conversation_id = $2 ORDER BY created_at ASC LIMIT 60`,
      [tenantId, convId],
    );
    const rows = msgs.rows;
    const inbound = rows.filter((m) => m.direction === 'inbound').length;
    const outbound = rows.filter((m) => m.direction === 'outbound').length;
    const fallback = `Conversation with ${inbound} customer message(s) and ${outbound} reply(ies).`;

    let summary = fallback;
    if (this.llm && rows.length > 0) {
      try {
        const transcript = rows
          .map((m) => `${m.direction === 'inbound' ? 'Customer' : m.from_ai ? 'AI' : 'Staff'}: ${m.body}`)
          .join('\n');
        const res = await this.llm.chat(
          tenantId,
          [
            {
              role: 'system',
              content:
                'You summarize a customer WhatsApp chat for a car-wash business owner. ' +
                'In 2-3 short sentences (Bahasa Indonesia), state what the customer wanted, ' +
                'how it was resolved, and whether a human follow-up is still needed. Plain text only.',
            },
            { role: 'user', content: transcript },
          ],
          { temperature: 0.2, max_tokens: 180 },
        );
        const isError = 'error' in res && (res as LLMErrorResponse).error === true;
        const content = res.content?.trim();
        // 180 tokens is a tight budget, so this one truncates readily — and a
        // truncated or self-talking summary is worse than the deterministic
        // count, which at least reads as a sentence.
        const usable = !!content && !res.truncated && !looksLikeReasoning(content);
        if (!isError && usable) summary = content;
      } catch (e) {
        this.logger.warn(`AI summary failed for conv ${convId}: ${String(e)}; using fallback`);
      }
    }

    await this.pool.query(`UPDATE wa_conversations SET summary = $3 WHERE id = $1 AND tenant_id = $2`, [convId, tenantId, summary]);
    return summary;
  }
}
