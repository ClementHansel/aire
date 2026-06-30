import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { NotificationService } from '../notification';

interface AgentCfgRow {
  tenant_id: string; base_prompt: string | null; product_knowledge: string | null;
  escalation_number: string | null; max_messages_per_day: number;
  wa_provider: 'waha' | 'kapso'; wa_number: string | null; waha_session: string | null;
  kapso_api_key: string | null; ai_reply_enabled: boolean;
}

/**
 * WhatsApp integration. Connection + behavior are driven entirely by the
 * tenant's Agentic-AI config (UI): provider (WAHA self-host or Kapso cloud),
 * session/number, daily cap, product knowledge, and escalation number.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly wahaUrl = process.env.WAHA_URL || 'http://waha:3000';
  private readonly kapsoUrl = process.env.KAPSO_URL || 'https://app.kapso.ai/api/v1';

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  private async config(tenantId: string): Promise<AgentCfgRow | null> {
    const r = await this.pool.query('SELECT * FROM agent_configs WHERE tenant_id = $1', [tenantId]);
    return r.rows[0] ?? null;
  }

  /** Resolve the tenant that owns a given WAHA session (single-pilot friendly). */
  private async tenantBySession(session: string): Promise<string | null> {
    const r = await this.pool.query('SELECT tenant_id FROM agent_configs WHERE waha_session = $1 LIMIT 1', [session]);
    return r.rows[0]?.tenant_id ?? null;
  }

  // ── WAHA session management (for the QR-connect UI) ─────────────────────────
  async ensureSession(tenantId: string): Promise<{ status: string }> {
    const cfg = await this.config(tenantId);
    const session = cfg?.waha_session || 'default';
    try {
      await fetch(`${this.wahaUrl}/api/sessions/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: session }),
      });
    } catch (e) { this.logger.warn(`WAHA start session failed: ${String(e)}`); }
    return this.status(tenantId);
  }

  async status(tenantId: string): Promise<{ status: string }> {
    const cfg = await this.config(tenantId);
    if (cfg?.wa_provider === 'kapso') return { status: cfg.kapso_api_key ? 'configured' : 'not_configured' };
    const session = cfg?.waha_session || 'default';
    try {
      const res = await fetch(`${this.wahaUrl}/api/sessions/${encodeURIComponent(session)}`);
      if (!res.ok) return { status: 'stopped' };
      const data = (await res.json()) as { status?: string };
      return { status: data.status ?? 'unknown' };
    } catch { return { status: 'unreachable' }; }
  }

  /** Returns a data-URL QR for the WAHA session (to scan in the UI). */
  async qr(tenantId: string): Promise<{ qr: string | null; status: string }> {
    const cfg = await this.config(tenantId);
    if (cfg?.wa_provider === 'kapso') return { qr: null, status: 'kapso' };
    const session = cfg?.waha_session || 'default';
    await this.ensureSession(tenantId);
    try {
      const res = await fetch(`${this.wahaUrl}/api/${encodeURIComponent(session)}/auth/qr?format=image`);
      if (!res.ok) return { qr: null, status: 'no_qr' };
      const buf = Buffer.from(await res.arrayBuffer());
      return { qr: `data:image/png;base64,${buf.toString('base64')}`, status: 'qr' };
    } catch { return { qr: null, status: 'unreachable' }; }
  }

  // ── Outbound ────────────────────────────────────────────────────────────────
  async sendText(tenantId: string, to: string, text: string): Promise<boolean> {
    const cfg = await this.config(tenantId);
    if (!cfg) return false;
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session, chatId, text }),
      });
      return res.ok;
    } catch (e) { this.logger.warn(`WA send failed: ${String(e)}`); return false; }
  }

  // ── Inbound (from WAHA/Kapso webhook) ────────────────────────────────────────
  async handleInbound(params: { tenantId?: string; session?: string; from: string; name?: string; text: string }): Promise<void> {
    const tenantId = params.tenantId ?? (params.session ? await this.tenantBySession(params.session) : null);
    if (!tenantId || !params.from || !params.text) return;
    const cfg = await this.config(tenantId);
    const conv = await this.upsertConversation(tenantId, params.from, params.name);
    await this.addMessage(tenantId, conv.id, 'inbound', params.text, false);

    if (!cfg || !cfg.ai_reply_enabled || !conv.ai_enabled) return;

    // Daily per-user cap.
    const today = new Date().toISOString().slice(0, 10);
    const used = conv.messages_day === today ? conv.messages_today : 0;
    if (used >= (cfg.max_messages_per_day ?? 50)) {
      await this.escalate(tenantId, conv.id, cfg, params.from, 'Daily message cap reached');
      return;
    }

    const reply = this.buildReply(cfg, params.text);
    if (reply.escalate) {
      await this.escalate(tenantId, conv.id, cfg, params.from, params.text);
      return;
    }
    await this.addMessage(tenantId, conv.id, 'outbound', reply.text, true);
    await this.pool.query(
      `UPDATE wa_conversations SET messages_today = CASE WHEN messages_day = $2 THEN messages_today + 1 ELSE 1 END, messages_day = $2 WHERE id = $1`,
      [conv.id, today],
    );
    await this.sendText(tenantId, params.from, reply.text);
  }

  /** Knowledge-grounded reply. Escalates when the question is outside the KB. */
  private buildReply(cfg: AgentCfgRow, text: string): { text: string; escalate: boolean } {
    const t = text.toLowerCase();
    const kb = cfg.product_knowledge ?? '';
    const wantsHuman = /(komplain|complaint|manusia|human|agent|bicara|lapor)/i.test(t);
    if (wantsHuman) return { text: '', escalate: true };
    if (kb) {
      // Naive KB match: return the KB line most relevant to the query keywords.
      const lines = kb.split(/\n+/).filter(Boolean);
      const hit = lines.find((l) => t.split(/\s+/).some((w) => w.length > 3 && l.toLowerCase().includes(w)));
      if (hit) return { text: hit.trim(), escalate: false };
    }
    const greeting = cfg.base_prompt?.trim()
      ? `Halo! ${cfg.base_prompt.split('\n')[0]}`
      : 'Halo! Terima kasih sudah menghubungi kami. Ada yang bisa kami bantu?';
    // Outside KB → escalate so a human follows up.
    return /(halo|hi|hai|pagi|siang|malam|thanks|terima kasih)/i.test(t)
      ? { text: greeting, escalate: false }
      : { text: '', escalate: true };
  }

  private async escalate(tenantId: string, convId: string, cfg: AgentCfgRow | null, from: string, reason: string): Promise<void> {
    await this.pool.query(`UPDATE wa_conversations SET status = 'escalated' WHERE id = $1`, [convId]);
    const ack = 'Mohon menunggu, pertanyaan Anda kami teruskan ke tim kami.';
    await this.addMessage(tenantId, convId, 'outbound', ack, true);
    await this.sendText(tenantId, from, ack);
    if (cfg?.escalation_number && this.notifications) {
      try {
        await this.notifications.sendWhatsApp({ to: cfg.escalation_number, templateName: 'escalation', params: { from, reason } } as never);
      } catch { /* best-effort */ }
    }
  }

  // ── Conversation store ───────────────────────────────────────────────────────
  private async upsertConversation(tenantId: string, chatId: string, name?: string): Promise<{ id: string; ai_enabled: boolean; messages_today: number; messages_day: string | null }> {
    const phone = chatId.replace(/@.*/, '');
    const res = await this.pool.query(
      `INSERT INTO wa_conversations (tenant_id, chat_id, customer_phone, customer_name, last_message_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (tenant_id, chat_id) DO UPDATE SET last_message_at = NOW(),
         customer_name = COALESCE(wa_conversations.customer_name, EXCLUDED.customer_name)
       RETURNING id, ai_enabled, messages_today, messages_day::text`,
      [tenantId, chatId, phone, name ?? null],
    );
    return res.rows[0];
  }

  private async addMessage(tenantId: string, convId: string, direction: 'inbound' | 'outbound', body: string, fromAi: boolean): Promise<void> {
    await this.pool.query(
      `INSERT INTO wa_messages (tenant_id, conversation_id, direction, body, from_ai) VALUES ($1,$2,$3,$4,$5)`,
      [tenantId, convId, direction, body, fromAi],
    );
    await this.pool.query(`UPDATE wa_conversations SET last_message_at = NOW() WHERE id = $1`, [convId]);
  }

  // ── Read/admin APIs for the Conversation Log ──────────────────────────────────
  async listConversations(tenantId: string): Promise<Record<string, unknown>[]> {
    const r = await this.pool.query(
      `SELECT id, chat_id, customer_name, customer_phone, ai_enabled, status, summary, last_message_at
       FROM wa_conversations WHERE tenant_id = $1 ORDER BY last_message_at DESC NULLS LAST LIMIT 200`,
      [tenantId],
    );
    return r.rows.map((c) => ({
      id: c.id, chatId: c.chat_id, customerName: c.customer_name, customerPhone: c.customer_phone,
      aiEnabled: c.ai_enabled, status: c.status, summary: c.summary, lastMessageAt: c.last_message_at,
    }));
  }

  async listMessages(tenantId: string, convId: string): Promise<Record<string, unknown>[]> {
    const r = await this.pool.query(
      `SELECT direction, body, from_ai, created_at FROM wa_messages WHERE tenant_id = $1 AND conversation_id = $2 ORDER BY created_at ASC LIMIT 500`,
      [tenantId, convId],
    );
    return r.rows.map((m) => ({ direction: m.direction, body: m.body, fromAi: m.from_ai, createdAt: m.created_at }));
  }

  async setConversation(tenantId: string, convId: string, patch: { aiEnabled?: boolean; status?: string }): Promise<void> {
    const set: string[] = []; const v: unknown[] = []; let i = 1;
    if (patch.aiEnabled !== undefined) { set.push(`ai_enabled = $${i++}`); v.push(patch.aiEnabled); }
    if (patch.status !== undefined) { set.push(`status = $${i++}`); v.push(patch.status); }
    if (set.length === 0) return;
    v.push(convId, tenantId);
    await this.pool.query(`UPDATE wa_conversations SET ${set.join(', ')} WHERE id = $${i} AND tenant_id = $${i + 1}`, v);
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

  /** Deterministic conversation summary (counts + status). */
  async summarize(tenantId: string, convId: string): Promise<string> {
    const r = await this.pool.query(
      `SELECT direction, COUNT(*)::int AS n FROM wa_messages WHERE tenant_id = $1 AND conversation_id = $2 GROUP BY direction`,
      [tenantId, convId],
    );
    const inbound = r.rows.find((x) => x.direction === 'inbound')?.n ?? 0;
    const outbound = r.rows.find((x) => x.direction === 'outbound')?.n ?? 0;
    const summary = `Conversation with ${inbound} customer message(s) and ${outbound} reply(ies).`;
    await this.pool.query(`UPDATE wa_conversations SET summary = $3 WHERE id = $1 AND tenant_id = $2`, [convId, tenantId, summary]);
    return summary;
  }
}
