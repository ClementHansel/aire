import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WhatsappService } from './whatsapp.service';
import type { AgentRuntimeService } from './agent-runtime.service';

/**
 * Inbound routing for WHITELISTED (staff) numbers.
 *
 * A whitelisted number must reach the FULL business assistant — the same brain as
 * the dashboard — while everyone else keeps getting the customer bot. The
 * behaviours worth pinning down are the ones a future change could quietly break:
 *
 *  - the split itself (staff → business agent, stranger → customer agent);
 *  - that the CUSTOMER auto-reply pause and the CUSTOMER daily cap do not gag the
 *    owner's own console (they are customer protections, not staff ones);
 *  - that the per-conversation AI pause DOES still apply (a human took over);
 *  - that a group chat is never a private staff console;
 *  - that the thread is bound to a chat session, so follow-ups keep context;
 *  - that a broken assistant says so instead of going silent.
 */

const TENANT_ID = 'tenant-staff-001';
const OWNER = '628111111111';
const STRANGER = '628999999999';
const today = new Date().toISOString().slice(0, 10);

interface Conv {
  id: string; chat_id: string; ai_enabled: boolean; status: string;
  messages_today: number; messages_day: string | null; chat_session_id: string | null;
}

function createPool(overrides?: Partial<{ aiReplyEnabled: boolean; maxPerDay: number; seedCount: number; convAiEnabled: boolean }>) {
  const cfg = {
    tenant_id: TENANT_ID, base_prompt: 'You are the AIRE assistant.', product_knowledge: null,
    escalation_number: '628999', max_messages_per_day: overrides?.maxPerDay ?? 50,
    wa_provider: 'waha', wa_number: '628000', waha_session: 'staff-session',
    kirim_api_key: null, kirim_phone_id: null, ai_reply_enabled: overrides?.aiReplyEnabled ?? true,
    routing_mode: 'builtin', n8n_flow_id: null, bridge_token: null,
  };
  const convs = new Map<string, Conv>();
  const messages: { direction: string; body: string; from_ai: boolean; persona: string | null }[] = [];
  const outbox: Record<string, unknown>[] = [];
  const sessionWrites: (string | null)[] = [];

  const pool = {
    convs, messages, outbox, sessionWrites,
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('SELECT * FROM agent_configs')) return { rows: [cfg], rowCount: 1 };

      if (sql.includes('INSERT INTO wa_conversations')) {
        const chatId = params[1] as string;
        let c = convs.get(chatId);
        if (!c) {
          c = {
            id: `conv-${convs.size + 1}`, chat_id: chatId,
            ai_enabled: overrides?.convAiEnabled ?? true, status: 'open',
            messages_today: overrides?.seedCount ?? 0,
            messages_day: overrides?.seedCount ? today : null,
            chat_session_id: null,
          };
          convs.set(chatId, c);
        }
        return {
          rows: [{
            id: c.id, ai_enabled: c.ai_enabled, messages_today: c.messages_today,
            messages_day: c.messages_day, chat_session_id: c.chat_session_id,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('SET chat_session_id')) {
        const c = [...convs.values()].find((x) => x.id === params[0]);
        if (c) c.chat_session_id = params[1] as string;
        sessionWrites.push(params[1] as string);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('SELECT direction, body FROM wa_messages')) {
        return { rows: messages.map((m) => ({ direction: m.direction, body: m.body })), rowCount: messages.length };
      }
      if (sql.includes('INSERT INTO wa_messages')) {
        messages.push({
          direction: params[2] as string, body: params[3] as string,
          from_ai: params[4] as boolean, persona: (params[5] as string) ?? null,
        });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO wa_mock_outbox')) {
        outbox.push({ chat_id: params[2], to_phone: params[3], body: params[4] });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("SET status = 'escalated'")) {
        const c = [...convs.values()].find((x) => x.id === params[0]);
        if (c) c.status = 'escalated';
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
  return pool;
}

const stubRuntime = (reply = 'Halo kak, Irene di sini.') =>
  ({ generate: vi.fn(async () => ({ text: reply, escalate: false, mode: 'fluid' as const, agentName: 'Irene' })) }) as unknown as AgentRuntimeService;

/** Whitelist stub: only OWNER is on the list. */
const stubWhitelist = (accessLevel: 'full' | 'read_only' = 'full') => ({
  match: vi.fn(async (_t: string, address: string) =>
    address.replace(/@.*/, '') === OWNER
      ? { id: 'wl-1', label: 'Pak Samuel (owner)', accessLevel, userId: 'user-owner', phone: OWNER, isActive: true }
      : null,
  ),
  markUsed: vi.fn(async () => {}),
});

const stubStaffChat = (reply = 'Omzet hari ini Rp 4.500.000.') => ({
  chat: vi.fn(async () => ({ sessionId: 'sess-1', reply, toolsUsed: [{ tool: 'get_revenue', ok: true }] })),
});

describe('WhatsApp staff whitelist routing', () => {
  const prev = process.env.WAHA_MOCK;
  beforeEach(() => { process.env.WAHA_MOCK = 'true'; });
  afterEach(() => { process.env.WAHA_MOCK = prev; vi.restoreAllMocks(); });

  const build = (pool: ReturnType<typeof createPool>, wl = stubWhitelist(), staff = stubStaffChat(), runtime = stubRuntime()) => ({
    svc: new WhatsappService(pool as never, runtime, undefined, undefined, undefined, undefined, undefined, wl as never, staff as never),
    runtime, wl, staff,
  });

  it('routes a whitelisted number to the business agent, not the customer bot', async () => {
    const pool = createPool();
    const { svc, runtime, staff } = build(pool);

    await svc.handleInbound({ tenantId: TENANT_ID, from: OWNER, text: 'omzet hari ini?' });

    expect(staff.chat).toHaveBeenCalledTimes(1);
    expect(runtime.generate).not.toHaveBeenCalled();
    expect(pool.outbox[0]!.body).toContain('4.500.000');
    // The Conversation Log labels the turn 'Airin' — the agent's own name, so a
    // staff thread is distinguishable from Irene's customer replies at a glance.
    expect(pool.messages.find((m) => m.direction === 'outbound')?.persona).toBe('Airin');
  });

  it('leaves a stranger on the customer agent', async () => {
    const pool = createPool();
    const { svc, runtime, staff } = build(pool);

    await svc.handleInbound({ tenantId: TENANT_ID, from: STRANGER, text: 'harga cuci?' });

    expect(staff.chat).not.toHaveBeenCalled();
    expect(runtime.generate).toHaveBeenCalledTimes(1);
  });

  // `ai_reply_enabled` pauses replies to CUSTOMERS. Silencing the owner's console
  // with it would make the whitelist mysteriously dead.
  it('answers staff even when customer auto-reply is paused', async () => {
    const pool = createPool({ aiReplyEnabled: false });
    const { svc, staff } = build(pool);

    await svc.handleInbound({ tenantId: TENANT_ID, from: OWNER, text: 'omzet?' });

    expect(staff.chat).toHaveBeenCalledTimes(1);
    expect(pool.outbox).toHaveLength(1);
  });

  // The daily cap is customer abuse protection; staff must not be escalated for
  // asking a fifth question.
  it('ignores the customer daily cap for staff', async () => {
    const pool = createPool({ maxPerDay: 3, seedCount: 3 });
    const { svc, staff } = build(pool);

    await svc.handleInbound({ tenantId: TENANT_ID, from: OWNER, text: 'lagi' });

    expect(staff.chat).toHaveBeenCalledTimes(1);
    expect([...pool.convs.values()][0]!.status).toBe('open');
  });

  // The per-chat toggle means "a human is handling this thread" — that must win.
  it('stays silent when the conversation AI toggle is off', async () => {
    const pool = createPool({ convAiEnabled: false });
    const { svc, staff, runtime } = build(pool);

    await svc.handleInbound({ tenantId: TENANT_ID, from: OWNER, text: 'omzet?' });

    expect(staff.chat).not.toHaveBeenCalled();
    expect(runtime.generate).not.toHaveBeenCalled();
    expect(pool.outbox).toHaveLength(0);
  });

  it('never treats a group as a staff console', async () => {
    const pool = createPool();
    const { svc, staff } = build(pool);

    await svc.handleInbound({
      tenantId: TENANT_ID, from: '120363000000000000@g.us', author: OWNER,
      isGroup: true, text: '@628000 omzet hari ini?', mentions: ['628000@c.us'],
    });

    expect(staff.chat).not.toHaveBeenCalled();
  });

  it('binds the thread to a chat session so follow-ups keep context', async () => {
    const pool = createPool();
    const { svc, staff } = build(pool);

    await svc.handleInbound({ tenantId: TENANT_ID, from: OWNER, text: 'omzet hari ini?' });
    expect(pool.sessionWrites).toEqual(['sess-1']);

    await svc.handleInbound({ tenantId: TENANT_ID, from: OWNER, text: 'kalau kemarin?' });
    // Second turn passes the bound session id through as the 4th argument.
    expect(staff.chat.mock.calls[1]![3]).toBe('sess-1');
    // …and does not rewrite the same id.
    expect(pool.sessionWrites).toEqual(['sess-1']);
  });

  it('passes read-only access through to the agent', async () => {
    const pool = createPool();
    const { svc, staff } = build(pool, stubWhitelist('read_only'));

    await svc.handleInbound({ tenantId: TENANT_ID, from: OWNER, text: 'kasih diskon 50%' });

    expect(staff.chat.mock.calls[0]![5]).toMatchObject({ readOnly: true });
  });

  it('stamps last-used so revoked-but-unused grants are visible', async () => {
    const pool = createPool();
    const { svc, wl } = build(pool);

    await svc.handleInbound({ tenantId: TENANT_ID, from: OWNER, text: 'omzet?' });

    expect(wl.markUsed).toHaveBeenCalledWith('wl-1');
  });

  // Silence is the worst outcome: the owner is standing at the counter waiting.
  it('admits a fault instead of going quiet when the agent throws', async () => {
    const pool = createPool();
    const broken = { chat: vi.fn(async () => { throw new Error('LLM down'); }) };
    const { svc } = build(pool, stubWhitelist(), broken as never);

    await svc.handleInbound({ tenantId: TENANT_ID, from: OWNER, text: 'omzet?' });

    expect(pool.outbox).toHaveLength(1);
    expect(String(pool.outbox[0]!.body)).toMatch(/unavailable|tidak bisa dihubungi/i);
  });

  // Without the whitelist wired (the many unit tests that build the service with
  // a short argument list), every message must still take the customer path.
  it('falls back to the customer agent when the whitelist is not wired', async () => {
    const pool = createPool();
    const runtime = stubRuntime();
    const svc = new WhatsappService(pool as never, runtime);

    await svc.handleInbound({ tenantId: TENANT_ID, from: OWNER, text: 'omzet?' });

    expect(runtime.generate).toHaveBeenCalledTimes(1);
  });
});
