import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WhatsappService } from './whatsapp.service';
import type { AgentRuntimeService } from './agent-runtime.service';

/**
 * End-to-end pipeline test for the WhatsApp channel in SIMULATION MODE (WAHA_MOCK).
 *
 * Purpose: prove that everything BETWEEN the third-party seams works without a
 * real WhatsApp number — webhook parse → tenant resolve → daily cap → built-in
 * AI runtime → conversation log → outbound. In mock mode the only thing stubbed
 * is the raw HTTP call to WAHA/kirimdev (captured in wa_mock_outbox instead).
 *
 * If this passes but production doesn't deliver messages with WAHA_MOCK off, the
 * fault is isolated to the WAHA↔WhatsApp segment (the third party).
 */

const TENANT_ID = 'tenant-e2e-001';
const SESSION = 'e2e-session';
const CUSTOMER = '628123456789';
const today = new Date().toISOString().slice(0, 10);

interface Conv {
  id: string; chat_id: string; ai_enabled: boolean; status: string;
  messages_today: number; messages_day: string | null;
}

/** Stateful in-memory pool that mimics the tables the pipeline touches. */
function createPool(overrides?: Partial<{ aiReplyEnabled: boolean; maxPerDay: number; seedCount: number }>) {
  const cfg = {
    tenant_id: TENANT_ID, base_prompt: 'You are the AIRE assistant.', product_knowledge: 'Hours 08-20.',
    escalation_number: '628999', max_messages_per_day: overrides?.maxPerDay ?? 50,
    wa_provider: 'waha', wa_number: '628000', waha_session: SESSION,
    kirim_api_key: null, kirim_phone_id: null, ai_reply_enabled: overrides?.aiReplyEnabled ?? true,
    routing_mode: 'builtin', n8n_flow_id: null, bridge_token: null,
  };
  const convs = new Map<string, Conv>();
  const messages: { direction: string; body: string; from_ai: boolean; persona: string | null }[] = [];
  const outbox: Record<string, unknown>[] = [];

  const pool = {
    convs, messages, outbox, // exposed for assertions
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      // config()
      if (sql.includes('SELECT * FROM agent_configs')) return { rows: [cfg], rowCount: 1 };
      // tenantBySession()
      if (sql.includes('SELECT tenant_id FROM agent_configs WHERE waha_session')) return { rows: [{ tenant_id: TENANT_ID }], rowCount: 1 };

      // upsertConversation()
      if (sql.includes('INSERT INTO wa_conversations')) {
        const chatId = params[1] as string;
        let c = convs.get(chatId);
        if (!c) {
          c = {
            id: `conv-${convs.size + 1}`, chat_id: chatId, ai_enabled: true, status: 'open',
            messages_today: overrides?.seedCount ?? 0, messages_day: overrides?.seedCount ? today : null,
          };
          convs.set(chatId, c);
        }
        return { rows: [{ id: c.id, ai_enabled: c.ai_enabled, messages_today: c.messages_today, messages_day: c.messages_day }], rowCount: 1 };
      }

      // recentHistory()
      if (sql.includes('SELECT direction, body FROM wa_messages')) {
        return { rows: messages.map((m) => ({ direction: m.direction, body: m.body })), rowCount: messages.length };
      }
      // addMessage()
      if (sql.includes('INSERT INTO wa_messages')) {
        messages.push({ direction: params[2] as string, body: params[3] as string, from_ai: params[4] as boolean, persona: (params[5] as string) ?? null });
        return { rows: [], rowCount: 1 };
      }
      // daily-cap counter bump
      if (sql.includes('UPDATE wa_conversations SET messages_today')) {
        const c = [...convs.values()].find((x) => x.id === params[0]);
        if (c) { c.messages_today = c.messages_day === today ? c.messages_today + 1 : 1; c.messages_day = today; }
        return { rows: [], rowCount: 1 };
      }
      // escalate() → mark escalated
      if (sql.includes("SET status = 'escalated'")) {
        const c = [...convs.values()].find((x) => x.id === params[0]);
        if (c) c.status = 'escalated';
        return { rows: [], rowCount: 1 };
      }
      // recordMockOutbox()
      if (sql.includes('INSERT INTO wa_mock_outbox')) {
        outbox.push({ tenant_id: params[0], provider: params[1], chat_id: params[2], to_phone: params[3], body: params[4], session: params[5] });
        return { rows: [], rowCount: 1 };
      }
      // listMockOutbox()
      if (sql.includes('FROM wa_mock_outbox')) {
        return { rows: outbox.map((o, i) => ({ id: `ob-${i}`, provider: o.provider, chat_id: o.chat_id, to_phone: o.to_phone, body: o.body, session: o.session, created_at: new Date() })), rowCount: outbox.length };
      }
      // last_message_at bumps & everything else
      return { rows: [], rowCount: 0 };
    }),
  };
  return pool;
}

function stubRuntime(reply = 'Halo! Kami buka 08:00–20:00.'): AgentRuntimeService {
  return { generate: vi.fn(async () => ({ text: reply, escalate: false, mode: 'fluid' as const, agentName: 'CS' })) } as unknown as AgentRuntimeService;
}

describe('WhatsApp pipeline e2e (WAHA_MOCK bypass)', () => {
  const prev = process.env.WAHA_MOCK;
  beforeEach(() => { process.env.WAHA_MOCK = 'true'; });
  afterEach(() => { process.env.WAHA_MOCK = prev; vi.restoreAllMocks(); });

  it('runs the full inbound → AI reply → captured outbound path without a live number', async () => {
    const pool = createPool();
    const runtime = stubRuntime();
    const svc = new WhatsappService(pool as never, runtime);

    await svc.handleInbound({ tenantId: TENANT_ID, from: CUSTOMER, name: 'Budi', text: 'jam buka berapa?' });

    // Inbound was logged, AI runtime ran, AI reply logged.
    expect(runtime.generate).toHaveBeenCalledTimes(1);
    expect(pool.messages.find((m) => m.direction === 'inbound')?.body).toBe('jam buka berapa?');
    const aiMsg = pool.messages.find((m) => m.direction === 'outbound' && m.from_ai);
    expect(aiMsg?.body).toContain('08:00');

    // Outbound was captured in the mock outbox instead of hitting WAHA.
    expect(pool.outbox).toHaveLength(1);
    expect(pool.outbox[0]).toMatchObject({ provider: 'waha', chat_id: `${CUSTOMER}@c.us`, session: SESSION });

    // The read API surfaces it for the UI.
    const listed = await svc.listMockOutbox(TENANT_ID);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.body).toContain('08:00');
  });

  it('resolves the tenant from the WAHA session (webhook shape, no tenantId)', async () => {
    const pool = createPool();
    const svc = new WhatsappService(pool as never, stubRuntime());
    await svc.handleInbound({ session: SESSION, from: CUSTOMER, name: 'Budi', text: 'halo' });
    expect(pool.messages.some((m) => m.direction === 'outbound')).toBe(true);
    expect(pool.outbox).toHaveLength(1);
  });

  it('enforces the daily cap → escalates instead of replying with AI', async () => {
    const pool = createPool({ maxPerDay: 3, seedCount: 3 });
    const runtime = stubRuntime();
    const svc = new WhatsappService(pool as never, runtime);

    await svc.handleInbound({ tenantId: TENANT_ID, from: CUSTOMER, text: 'lagi?' });

    expect(runtime.generate).not.toHaveBeenCalled();
    expect([...pool.convs.values()][0]!.status).toBe('escalated');
    // Escalation ack was captured to the outbox (would-be delivery).
    expect(pool.outbox.some((o) => String(o.body).includes('tim'))).toBe(true);
  });

  it('does not reply when AI auto-reply is disabled, but still logs the inbound', async () => {
    const pool = createPool({ aiReplyEnabled: false });
    const runtime = stubRuntime();
    const svc = new WhatsappService(pool as never, runtime);

    await svc.handleInbound({ tenantId: TENANT_ID, from: CUSTOMER, text: 'halo' });

    expect(runtime.generate).not.toHaveBeenCalled();
    expect(pool.messages.filter((m) => m.direction === 'inbound')).toHaveLength(1);
    expect(pool.outbox).toHaveLength(0);
  });

  it('reports a connected gateway (status/qr/connect) in mock mode', async () => {
    const pool = createPool();
    const svc = new WhatsappService(pool as never, stubRuntime());
    expect(svc.isMock()).toBe(true);
    expect(await svc.status(TENANT_ID)).toEqual({ status: 'WORKING' });
    expect(await svc.qr(TENANT_ID)).toEqual({ qr: null, status: 'WORKING' });
    expect(await svc.ensureSession(TENANT_ID)).toEqual({ status: 'WORKING' });
  });

  const GROUP = '120363000000000000@g.us';

  it('stays SILENT in a group when the bot is not mentioned (no leak)', async () => {
    const pool = createPool();
    const runtime = stubRuntime();
    const svc = new WhatsappService(pool as never, runtime);

    await svc.handleInbound({
      tenantId: TENANT_ID, from: GROUP, isGroup: true,
      author: `${CUSTOMER}@c.us`, text: 'ngobrol biasa di grup, bukan ke bot', mentions: [],
    });

    expect(runtime.generate).not.toHaveBeenCalled();
    expect(pool.messages).toHaveLength(0); // nothing logged
    expect(pool.outbox).toHaveLength(0);   // nothing sent
  });

  it('replies in a group ONLY when @mentioned — bound to the participant, sent to the group', async () => {
    const pool = createPool(); // cfg.wa_number = '628000'
    const runtime = stubRuntime('Halo kak! Ada yang bisa Irene bantu?');
    const svc = new WhatsappService(pool as never, runtime);

    await svc.handleInbound({
      tenantId: TENANT_ID, from: GROUP, isGroup: true, author: `${CUSTOMER}@c.us`,
      text: '@628000 harga cuci berapa ya?', mentions: ['628000@c.us'],
    });

    expect(runtime.generate).toHaveBeenCalledTimes(1);
    const arg = (runtime.generate as unknown as { mock: { calls: any[][] } }).mock.calls[0]![0];
    expect(arg.fromPhone).toBe(CUSTOMER);          // customer = participant, not the group
    expect(arg.text).toBe('harga cuci berapa ya?'); // mention token stripped
    expect(pool.outbox).toHaveLength(1);
    expect(pool.outbox[0]!.chat_id).toBe(GROUP);   // reply goes back to the group thread
  });

  it('ignores WhatsApp status/broadcast + newsletter system chats (no reply, no log)', async () => {
    const pool = createPool();
    const runtime = stubRuntime();
    const svc = new WhatsappService(pool as never, runtime);
    await svc.handleInbound({ tenantId: TENANT_ID, from: 'status@broadcast', text: 'story update' });
    await svc.handleInbound({ tenantId: TENANT_ID, from: '12345@newsletter', text: 'channel post' });
    expect(runtime.generate).not.toHaveBeenCalled();
    expect(pool.messages).toHaveLength(0);
    expect(pool.outbox).toHaveLength(0);
  });

  it('detects an inline @<number> mention even without a mentions array', async () => {
    const pool = createPool();
    const runtime = stubRuntime('ok');
    const svc = new WhatsappService(pool as never, runtime);
    await svc.handleInbound({ tenantId: TENANT_ID, from: GROUP, isGroup: true, author: `${CUSTOMER}@c.us`, text: 'halo @628000' });
    expect(runtime.generate).toHaveBeenCalledTimes(1);
  });

  it('asks an unknown sender to identify (once) — appends the identity request', async () => {
    const pool = createPool();
    const runtime = stubRuntime('Halo kak! 😊 Aku Irene.');
    const ctx = {
      resolveById: vi.fn(async () => null),
      resolveIdentityFromText: vi.fn(async () => null),
      resolveCustomer: vi.fn(async () => null),
    };
    const svc = new WhatsappService(pool as never, runtime, undefined, undefined, ctx as never);
    await svc.handleInbound({ tenantId: TENANT_ID, from: '99999999999999@lid', text: 'harga cuci berapa?' });
    expect(runtime.generate).toHaveBeenCalledTimes(1);
    expect(String(pool.outbox[0]!.body)).toContain('nomor HP yang terdaftar'); // identity ask appended
  });

  it('binds a customer when they identify, and acknowledges by name (no runtime call)', async () => {
    const pool = createPool();
    const runtime = stubRuntime();
    const ctx = {
      resolveById: vi.fn(async () => null),
      resolveIdentityFromText: vi.fn(async (_t: string, text: string) =>
        /0812/.test(text) ? { id: 'cust-1', name: 'Budi', phone: '628123456789', normalized: '628123456789' } : null),
      resolveCustomer: vi.fn(async () => null),
    };
    const svc = new WhatsappService(pool as never, runtime, undefined, undefined, ctx as never);
    await svc.handleInbound({ tenantId: TENANT_ID, from: '99999999999999@lid', text: '0812 3456 7890' });
    expect(runtime.generate).not.toHaveBeenCalled();        // identity turn short-circuits
    expect(String(pool.outbox[0]!.body)).toContain('Makasih kak Budi'); // warm ack by name
  });

  it('captures a self-introduced name and passes it to the runtime as displayName', async () => {
    const pool = createPool();
    const runtime = stubRuntime('Halo kak Hansel! 😊');
    const ctx = {
      resolveById: vi.fn(async () => null),
      resolveIdentityFromText: vi.fn(async () => null),
      resolveCustomer: vi.fn(async () => null),
    };
    const svc = new WhatsappService(pool as never, runtime, undefined, undefined, ctx as never);
    await svc.handleInbound({ tenantId: TENANT_ID, from: '55555555555555@lid', text: 'Hello im hansel' });
    expect(runtime.generate).toHaveBeenCalledTimes(1); // greeted, NOT escalated
    const arg = (runtime.generate as unknown as { mock: { calls: any[][] } }).mock.calls[0]![0];
    expect(arg.displayName).toBe('Hansel');
  });

  it('agentSend (n8n/bridge outbound path) is also captured in mock mode', async () => {
    const pool = createPool();
    const svc = new WhatsappService(pool as never, stubRuntime());
    const ok = await svc.agentSend(TENANT_ID, CUSTOMER, 'Reply from n8n flow', 'FlowBot');
    expect(ok).toBe(true);
    expect(pool.outbox).toHaveLength(1);
    expect(pool.outbox[0]!.body).toBe('Reply from n8n flow');
  });
});
