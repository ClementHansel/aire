import { Injectable, Inject, Logger, Optional, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { NotificationService } from '../notification';
import { AgentRuntimeService } from './agent-runtime.service';
import { PendingBookingService } from './pending-booking.service';
import { ChatMessage, LLMRouterService, LLMErrorResponse } from '../agent/llm-router.service';

interface AgentCfgRow {
  tenant_id: string; base_prompt: string | null; product_knowledge: string | null;
  escalation_number: string | null; max_messages_per_day: number;
  wa_provider: 'waha' | 'kapso'; wa_number: string | null; waha_session: string | null;
  kapso_api_key: string | null; ai_reply_enabled: boolean;
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
 * tenant's Agentic-AI config (UI): provider (WAHA self-host or Kapso cloud),
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
  private readonly kapsoUrl = process.env.KAPSO_URL || 'https://app.kapso.ai/api/v1';
  /** Base URL n8n uses to call back into aire's bridge (internal docker network). */
  private readonly bridgeCallbackBase = process.env.BRIDGE_CALLBACK_BASE || 'http://backend:4000';

  /**
   * Simulation bypass. When active, the three seams that touch the third-party
   * gateway — outbound send, session status, and QR — are stubbed: outbound is
   * recorded to wa_mock_outbox instead of hitting WAHA/Kapso, and status/QR
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
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly llm?: LLMRouterService,
    @Optional() private readonly pendingBooking?: PendingBookingService,
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
    try {
      const expired = await this.pendingBooking.sweepExpired();
      for (const e of expired) {
        const text = `Mohon maaf, permintaan booking Anda (${e.summary}) belum sempat kami konfirmasi dan telah kedaluwarsa. Silakan hubungi kami untuk menjadwalkan ulang. 🙏`;
        const conv = await this.upsertConversation(e.tenantId, e.customerPhone);
        await this.addMessage(e.tenantId, conv.id, 'outbound', text, true, 'Booking');
        await this.sendText(e.tenantId, e.customerPhone, text);
      }
      if (expired.length) this.logger.log(`Approval SLA: auto-cancelled ${expired.length} stale booking(s)`);
      return expired.length;
    } finally {
      this.slaRunning = false;
    }
  }

  /**
   * The tenant's WhatsApp + AI config, optionally with a branch's connection
   * overlaid. Behaviour fields (escalation, daily cap, AI flags, prompt,
   * knowledge, n8n routing) always come from the tenant row. The CONNECTION
   * fields (provider, number, session, Kapso key) are overlaid from
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
      'SELECT wa_provider, wa_number, waha_session, kapso_api_key FROM outlet_agent_configs WHERE outlet_id = $1 AND tenant_id = $2',
      [outletId, tenantId],
    );
    const branch = b.rows[0];
    if (branch) {
      const hasConnection = !!(branch.waha_session || branch.kapso_api_key);
      return { ...cfg, wa_provider: branch.wa_provider, wa_number: branch.wa_number, waha_session: branch.waha_session, kapso_api_key: branch.kapso_api_key, wa_connection_missing: !hasConnection };
    }
    // per-branch on but this branch isn't wired: no fallback to the tenant line.
    return { ...cfg, wa_number: null, waha_session: null, kapso_api_key: null, wa_connection_missing: true };
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

  // ── WAHA session management (for the QR-connect UI) ─────────────────────────
  // outletId targets a specific branch line when per-branch WhatsApp is on;
  // omit it for the tenant central line.
  async ensureSession(tenantId: string, outletId?: string | null): Promise<{ status: string }> {
    const cfg = await this.config(tenantId, outletId);
    if (this.isMockActive(cfg)) return { status: 'WORKING' };
    // Per-branch on but this branch has no line of its own yet.
    if (cfg?.wa_connection_missing) return { status: 'not_configured' };
    const session = cfg?.waha_session || 'default';
    try {
      await fetch(`${this.wahaUrl}/api/sessions/start`, {
        method: 'POST', headers: this.wahaHeaders(true),
        body: JSON.stringify({ name: session }),
      });
    } catch (e) { this.logger.warn(`WAHA start session failed: ${String(e)}`); }
    return this.status(tenantId, outletId);
  }

  async status(tenantId: string, outletId?: string | null): Promise<{ status: string }> {
    const cfg = await this.config(tenantId, outletId);
    if (this.isMockActive(cfg)) return { status: 'WORKING' };
    if (cfg?.wa_connection_missing) return { status: 'not_configured' };
    if (cfg?.wa_provider === 'kapso') return { status: cfg.kapso_api_key ? 'configured' : 'not_configured' };
    const session = cfg?.waha_session || 'default';
    try {
      const res = await fetch(`${this.wahaUrl}/api/sessions/${encodeURIComponent(session)}`, { headers: this.wahaHeaders() });
      if (!res.ok) return { status: 'stopped' };
      const data = (await res.json()) as { status?: string };
      return { status: data.status ?? 'unknown' };
    } catch { return { status: 'unreachable' }; }
  }

  /** Returns a data-URL QR for the WAHA session (to scan in the UI). */
  async qr(tenantId: string, outletId?: string | null): Promise<{ qr: string | null; status: string }> {
    const cfg = await this.config(tenantId, outletId);
    if (this.isMockActive(cfg)) return { qr: null, status: 'WORKING' };
    if (cfg?.wa_connection_missing) return { qr: null, status: 'not_configured' };
    if (cfg?.wa_provider === 'kapso') return { qr: null, status: 'kapso' };
    const session = cfg?.waha_session || 'default';
    await this.ensureSession(tenantId, outletId);
    try {
      const res = await fetch(`${this.wahaUrl}/api/${encodeURIComponent(session)}/auth/qr?format=image`, { headers: this.wahaHeaders() });
      if (!res.ok) return { qr: null, status: 'no_qr' };
      const buf = Buffer.from(await res.arrayBuffer());
      return { qr: `data:image/png;base64,${buf.toString('base64')}`, status: 'qr' };
    } catch { return { qr: null, status: 'unreachable' }; }
  }

  // ── Outbound ────────────────────────────────────────────────────────────────
  // outletId selects the branch line (per-branch WhatsApp); omit for the tenant line.
  async sendText(tenantId: string, to: string, text: string, outletId?: string | null): Promise<boolean> {
    const cfg = await this.config(tenantId, outletId);
    if (!cfg) return false;
    // Per-branch on but this branch has no line of its own: no-op (require own number).
    if (cfg.wa_connection_missing) return false;
    // Simulation bypass: record what WOULD be sent, skip the gateway entirely.
    if (this.isMockActive(cfg)) return this.recordMockOutbox(tenantId, cfg, to, text);
    try {
      if (cfg.wa_provider === 'kapso') {
        if (!cfg.kapso_api_key) return false;
        const res = await fetch(`${this.kapsoUrl}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': cfg.kapso_api_key },
          body: JSON.stringify({ to, text, from: cfg.wa_number }),
        });
        return res.ok;
      }
      const session = cfg.waha_session || 'default';
      const chatId = to.includes('@') ? to : `${to.replace(/[^0-9]/g, '')}@c.us`;
      const res = await fetch(`${this.wahaUrl}/api/sendText`, {
        method: 'POST', headers: this.wahaHeaders(true),
        body: JSON.stringify({ session, chatId, text }),
      });
      return res.ok;
    } catch (e) { this.logger.warn(`WA send failed: ${String(e)}`); return false; }
  }

  /**
   * Send a message with reply buttons where the provider supports them, else a
   * plain-text prompt listing the options. Interactive reply buttons are only
   * reliable on the official WhatsApp Business API (Kapso); WAHA (WhatsApp Web)
   * restricts them, so it gets the text fallback. Either way, tapping a button
   * returns its title as a normal inbound message — so downstream keyword gates
   * (booking confirm YA/BATAL, staff TERIMA/TOLAK) resolve it identically.
   */
  async sendButtons(tenantId: string, to: string, body: string, buttons: { id: string; title: string }[], outletId?: string | null): Promise<boolean> {
    const cfg = await this.config(tenantId, outletId);
    if (!cfg) return false;
    if (cfg.wa_connection_missing) return false;
    const textFallback = `${body}\n\n${buttons.map((b) => `• ${b.title}`).join('\n')}`;
    if (this.isMockActive(cfg)) return this.recordMockOutbox(tenantId, cfg, to, textFallback);
    try {
      if (cfg.wa_provider === 'kapso') {
        if (!cfg.kapso_api_key) return false;
        const res = await fetch(`${this.kapsoUrl}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': cfg.kapso_api_key },
          body: JSON.stringify({
            to, from: cfg.wa_number, type: 'interactive',
            interactive: {
              type: 'button',
              body: { text: body },
              action: { buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })) },
            },
          }),
        });
        if (res.ok) return true;
        this.logger.warn(`Kapso interactive send failed (HTTP ${res.status}); text fallback`);
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
    const provider = cfg.wa_provider === 'kapso' ? 'kapso' : 'waha';
    const session = provider === 'waha' ? (cfg.waha_session || 'default') : null;
    const chatId = to.includes('@') ? to : `${to.replace(/[^0-9]/g, '')}@c.us`;
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

  // ── Inbound (from WAHA/Kapso webhook) ────────────────────────────────────────
  async handleInbound(params: { tenantId?: string; outletId?: string | null; session?: string; from: string; name?: string; text: string }): Promise<void> {
    // Resolve tenant + branch. A session on a branch line scopes to that outlet;
    // simulate-inbound may pass tenantId (+optional outletId) directly.
    let tenantId = params.tenantId ?? null;
    let outletId: string | null = params.outletId ?? null;
    if (!tenantId && params.session) {
      const resolved = await this.resolveBySession(params.session);
      if (resolved) { tenantId = resolved.tenantId; outletId = resolved.outletId; }
    }
    if (!tenantId || !params.from || !params.text) return;
    const cfg = await this.config(tenantId, outletId);
    const conv = await this.upsertConversation(tenantId, params.from, params.name, outletId);
    await this.addMessage(tenantId, conv.id, 'inbound', params.text, false);

    // Staff-acknowledgement branch: a reply FROM the tenant's escalation number
    // resolving a booking awaiting staff approval (TERIMA → confirm, TOLAK →
    // cancel). Runs regardless of the AI reply switch so approvals always resolve,
    // and notifies the original customer of the decision. Replies go out on the
    // same (branch or tenant) line the message arrived on.
    if (this.pendingBooking && cfg?.escalation_number && this.sameNumber(params.from, cfg.escalation_number)) {
      const ack = await this.pendingBooking.tryStaffAck(tenantId, params.from, params.text);
      if (ack.handled) {
        if (ack.reply) {
          await this.addMessage(tenantId, conv.id, 'outbound', ack.reply, true, 'Booking');
          await this.sendText(tenantId, params.from, ack.reply, outletId);
        }
        if (ack.notifyCustomer) {
          const custConv = await this.upsertConversation(tenantId, ack.notifyCustomer.phone, undefined, outletId);
          await this.addMessage(tenantId, custConv.id, 'outbound', ack.notifyCustomer.text, true, 'Booking');
          await this.sendText(tenantId, ack.notifyCustomer.phone, ack.notifyCustomer.text, outletId);
        }
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
    if (this.pendingBooking) {
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
      fromPhone: params.from,
      outletId,
      text: params.text,
      basePrompt: cfg.base_prompt,
      knowledge: cfg.product_knowledge,
      history,
    });
    if (result.escalate || !result.text) {
      await this.escalate(tenantId, conv.id, cfg, params.from, params.text, outletId);
      return;
    }
    await this.addMessage(tenantId, conv.id, 'outbound', result.text, true, result.agentName);
    await this.pool.query(
      `UPDATE wa_conversations SET messages_today = CASE WHEN messages_day = $2 THEN messages_today + 1 ELSE 1 END, messages_day = $2 WHERE id = $1`,
      [conv.id, today],
    );
    // When the agent just PROPOSED a booking, offer YA/BATAL as reply buttons
    // (falls back to a text prompt where buttons aren't supported). Tapping a
    // button sends its title back, which the confirmation gate resolves next turn.
    if (result.proposedBooking) {
      await this.sendButtons(tenantId, params.from, result.text, [{ id: 'YA', title: 'YA' }, { id: 'BATAL', title: 'BATAL' }], outletId);
    } else {
      await this.sendText(tenantId, params.from, result.text, outletId);
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
    const text = `🆕 Booking baru menunggu persetujuan [${ref}]:\n${approval.summary}\nPelanggan: ${approval.customerPhone}\n\nBalas TERIMA ${ref} untuk konfirmasi atau TOLAK ${ref} untuk menolak.`;
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
    const ack = 'Mohon menunggu, pertanyaan Anda kami teruskan ke tim kami.';
    await this.addMessage(tenantId, convId, 'outbound', ack, true, 'Escalation');
    await this.sendText(tenantId, from, ack, outletId);
    if (cfg?.escalation_number && this.notifications) {
      try {
        await this.notifications.sendWhatsApp({ to: cfg.escalation_number, templateName: 'escalation', params: { from, reason } } as never);
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
  private async upsertConversation(tenantId: string, chatId: string, name?: string, outletId?: string | null): Promise<{ id: string; ai_enabled: boolean; messages_today: number; messages_day: string | null }> {
    const phone = chatId.replace(/@.*/, '');
    // Conflict target matches uq_wa_conv_tenant_outlet_chat (migration 067): a
    // NULL outlet_id (tenant line) coalesces to the all-zero UUID sentinel, so
    // branch and tenant lines get distinct conversation rows for the same phone.
    const res = await this.pool.query(
      `INSERT INTO wa_conversations (tenant_id, chat_id, customer_phone, customer_name, outlet_id, last_message_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (tenant_id, chat_id, (COALESCE(outlet_id, '00000000-0000-0000-0000-000000000000'::uuid))) DO UPDATE SET last_message_at = NOW(),
         customer_name = COALESCE(wa_conversations.customer_name, EXCLUDED.customer_name)
       RETURNING id, ai_enabled, messages_today, messages_day::text`,
      [tenantId, chatId, phone, name ?? null, outletId ?? null],
    );
    return res.rows[0];
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
    const r = await this.pool.query(
      `SELECT c.id, c.chat_id, c.customer_name, c.customer_phone, c.ai_enabled, c.status, c.summary,
              c.last_message_at, c.outlet_id, o.name AS outlet_name
       FROM wa_conversations c
       LEFT JOIN outlets o ON o.id = c.outlet_id
       WHERE c.tenant_id = $1 ORDER BY c.last_message_at DESC NULLS LAST LIMIT 200`,
      [tenantId],
    );
    return r.rows.map((c) => ({
      id: c.id, chatId: c.chat_id, customerName: c.customer_name, customerPhone: c.customer_phone,
      aiEnabled: c.ai_enabled, status: c.status, summary: c.summary, lastMessageAt: c.last_message_at,
      outletId: c.outlet_id ?? null, outletName: c.outlet_name ?? null,
    }));
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
    if (outcome.notifyCustomer) {
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
        if (!isError && content) summary = content;
      } catch (e) {
        this.logger.warn(`AI summary failed for conv ${convId}: ${String(e)}; using fallback`);
      }
    }

    await this.pool.query(`UPDATE wa_conversations SET summary = $3 WHERE id = $1 AND tenant_id = $2`, [convId, tenantId, summary]);
    return summary;
  }
}
