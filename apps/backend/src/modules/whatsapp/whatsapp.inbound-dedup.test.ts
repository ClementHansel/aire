import { describe, it, expect, vi } from 'vitest';
import { WhatsappService } from './whatsapp.service';
import { WhatsappWebhookController } from './whatsapp.controller';
import type { AgentRuntimeService } from './agent-runtime.service';

/**
 * "AI agent membalas berulang" — the customer got the same answer two or three
 * times (client feedback 2026-09-22).
 *
 * The webhook ACKs the gateway immediately and runs the agent in the
 * background, which is right (the tool loop takes many seconds and a held-open
 * connection would time out). But it meant a re-delivered message ran the whole
 * agent again: nothing keyed off the provider's message id, so a WAHA reconnect
 * replay, a proxy retry, or a gateway subscribed to both `message` and
 * `message.any` each produced an extra reply.
 *
 * Two independent guards, tested separately here because either alone leaves a
 * live duplicate path open:
 *   1. the controller drops non-`message` WAHA events, and
 *   2. the service claims each message id before doing any work.
 */

const TENANT_ID = 'tenant-dedup-001';
const CUSTOMER = '628123456789@c.us';

function createPool() {
  // The dedup table, as a set — an INSERT that conflicts reports rowCount 0,
  // exactly as `ON CONFLICT DO NOTHING` does.
  const claimed = new Set<string>();
  const seenInbound: string[] = [];
  // The conversation's most recent AI reply, for the repeat guard.
  const lastReply: { value: string | null } = { value: null };
  const escalated: string[] = [];
  const pool = {
    claimed,
    seenInbound,
    lastReply,
    escalated,
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("SET status = 'escalated'")) { escalated.push(String(params[0])); return { rows: [], rowCount: 1 }; }
      if (sql.includes('INSERT INTO wa_inbound_events')) {
        const key = `${params[0]}|${params[1]}`;
        if (claimed.has(key)) return { rows: [], rowCount: 0 };
        claimed.add(key);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('SELECT * FROM agent_configs')) {
        return {
          rows: [{
            tenant_id: TENANT_ID, base_prompt: 'b', product_knowledge: 'k', skills: null,
            escalation_number: null, max_messages_per_day: 50,
            wa_provider: 'waha', wa_number: '628000', waha_session: 'sess',
            kirim_api_key: null, kirim_phone_id: null, ai_reply_enabled: true,
            routing_mode: 'builtin', n8n_flow_id: null, bridge_token: null,
            per_branch_wa_enabled: false, waha_mock: true,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('INSERT INTO wa_conversations')) {
        return { rows: [{ id: 'conv-1', ai_enabled: true, messages_today: 0, messages_day: null }], rowCount: 1 };
      }
      if (sql.includes("direction = 'outbound' AND from_ai = true")) {
        return { rows: lastReply.value ? [{ body: lastReply.value }] : [], rowCount: lastReply.value ? 1 : 0 };
      }
      if (sql.includes('INSERT INTO wa_messages')) {
        // The conversation log is the earliest observable side effect, so it is
        // what tells us whether a delivery was processed at all.
        if (params[2] === 'inbound') seenInbound.push(String(params[3]));
        if (params[2] === 'outbound') lastReply.value = String(params[3]);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
  return pool;
}

function buildService(pool: ReturnType<typeof createPool>) {
  const runtime = {
    generate: vi.fn(async () => ({ text: 'jawaban', escalate: false, mode: 'fluid', agentName: 'Kalia' })),
  } as unknown as AgentRuntimeService;
  return new WhatsappService(pool as never, runtime);
}

describe('WhatsApp inbound de-duplication', () => {
  it('processes a message once and drops the gateway re-delivering it', async () => {
    const pool = createPool();
    const svc = buildService(pool);

    const delivery = {
      tenantId: TENANT_ID, from: CUSTOMER, text: 'berapa harga kalibrasi?', messageId: 'MSG-ABC',
    };
    await svc.handleInbound(delivery);
    await svc.handleInbound(delivery); // the retry
    await svc.handleInbound(delivery); // and the replay

    expect(pool.seenInbound).toEqual(['berapa harga kalibrasi?']);
  });

  it('still answers a customer who genuinely sends the same text twice', async () => {
    // The guard keys on the gateway's message id, not on the text — two real
    // messages carry two ids. Keying on content would silently swallow an
    // impatient customer's repeat, which is worse than a duplicate reply.
    const pool = createPool();
    const svc = buildService(pool);

    await svc.handleInbound({ tenantId: TENANT_ID, from: CUSTOMER, text: 'halo', messageId: 'MSG-1' });
    await svc.handleInbound({ tenantId: TENANT_ID, from: CUSTOMER, text: 'halo', messageId: 'MSG-2' });

    expect(pool.seenInbound).toEqual(['halo', 'halo']);
  });

  it('scopes the claim per tenant, so two tenants may see the same gateway id', async () => {
    const pool = createPool();
    const svc = buildService(pool);

    await svc.handleInbound({ tenantId: TENANT_ID, from: CUSTOMER, text: 'hai', messageId: 'SHARED' });
    await svc.handleInbound({ tenantId: 'tenant-dedup-002', from: CUSTOMER, text: 'hai', messageId: 'SHARED' });

    expect(pool.seenInbound).toHaveLength(2);
  });

  it('processes normally when the gateway sends no message id', async () => {
    // simulate-inbound and older gateways send none. De-duplication is an
    // improvement where the data allows it, never a new reason to drop a real
    // customer message.
    const pool = createPool();
    const svc = buildService(pool);

    await svc.handleInbound({ tenantId: TENANT_ID, from: CUSTOMER, text: 'tanpa id' });
    await svc.handleInbound({ tenantId: TENANT_ID, from: CUSTOMER, text: 'tanpa id' });

    expect(pool.seenInbound).toHaveLength(2);
  });

  it('answers anyway when the dedup table is unreachable', async () => {
    // A duplicate reply is an annoyance; a bot that has gone silent for every
    // customer because one table is missing is an outage.
    const pool = createPool();
    pool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO wa_inbound_events')) throw new Error('relation does not exist');
      if (sql.includes('SELECT * FROM agent_configs')) {
        return { rows: [{ tenant_id: TENANT_ID, ai_reply_enabled: true, max_messages_per_day: 50, waha_mock: true }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO wa_conversations')) {
        return { rows: [{ id: 'conv-1', ai_enabled: true, messages_today: 0, messages_day: null }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO wa_messages')) { pool.seenInbound.push('x'); return { rows: [], rowCount: 1 }; }
      return { rows: [], rowCount: 0 };
    });
    const svc = buildService(pool);

    await svc.handleInbound({ tenantId: TENANT_ID, from: CUSTOMER, text: 'halo', messageId: 'MSG-X' });

    expect(pool.seenInbound.length).toBeGreaterThan(0);
  });
});

describe('WAHA webhook event gate', () => {
  function buildController() {
    const service = { handleInbound: vi.fn(async () => undefined) };
    const controller = new WhatsappWebhookController(service as never);
    return { controller, service };
  }

  const payload = { from: CUSTOMER, body: 'halo', id: 'MSG-1', fromMe: false };

  it('handles a plain `message` event', () => {
    const { controller, service } = buildController();
    controller.webhook({ event: 'message', session: 'sess', payload });
    expect(service.handleInbound).toHaveBeenCalledTimes(1);
  });

  it('ignores `message.any`, which echoes the same message (and our own sends)', () => {
    const { controller, service } = buildController();
    controller.webhook({ event: 'message.any', session: 'sess', payload });
    expect(service.handleInbound).not.toHaveBeenCalled();
  });

  it('ignores acks and reactions, which are not messages at all', () => {
    const { controller, service } = buildController();
    controller.webhook({ event: 'message.ack', session: 'sess', payload });
    controller.webhook({ event: 'message.reaction', session: 'sess', payload });
    expect(service.handleInbound).not.toHaveBeenCalled();
  });

  it('treats a payload with no event field as a message', () => {
    // A gateway posting a bare payload must keep working; the absent event is
    // missing information, not a signal to drop the customer's message.
    const { controller, service } = buildController();
    controller.webhook({ session: 'sess', payload });
    expect(service.handleInbound).toHaveBeenCalledTimes(1);
  });

  it('forwards the message id in each shape WAHA reports it', () => {
    const cases: [string, Record<string, unknown>][] = [
      ['WEBJS serialised string', { ...payload, id: 'false_628@c.us_ABC' }],
      ['nested _serialized', { from: CUSTOMER, body: 'halo', id: { _serialized: 'NESTED-1' } }],
      ['_data.id._serialized', { from: CUSTOMER, body: 'halo', _data: { id: { _serialized: 'DATA-1' } } }],
      ['NOWEB key.id', { from: CUSTOMER, body: 'halo', key: { id: 'KEY-1' } }],
    ];
    for (const [, p] of cases) {
      const { controller, service } = buildController();
      controller.webhook({ event: 'message', session: 'sess', payload: p });
      const arg = service.handleInbound.mock.calls[0]![0] as { messageId: string | null };
      expect(arg.messageId).toBeTruthy();
    }
  });

  it('passes null rather than a junk id when the gateway sends none', () => {
    const { controller, service } = buildController();
    controller.webhook({ event: 'message', session: 'sess', payload: { from: CUSTOMER, body: 'halo' } });
    const arg = service.handleInbound.mock.calls[0]![0] as { messageId: string | null };
    expect(arg.messageId).toBeNull();
  });
});

describe('repeat guard — the real "membalas berulang"', () => {
  /**
   * The live Kalibrasi log (2026-09-22) shows the same fallback reply three
   * times in one conversation: the customer asked for a quote, the bot had no
   * catalog to answer from, produced its canned "kurang nangkep" line, and
   * produced it again on the next message. That is what the client saw —
   * repetition, not double delivery.
   */
  function poolWithRuntime(replies: string[]) {
    const pool = createPool();
    let i = 0;
    const runtime = {
      generate: vi.fn(async () => ({
        text: replies[Math.min(i++, replies.length - 1)]!,
        escalate: false, mode: 'fluid', agentName: 'Kalia',
      })),
    } as unknown as AgentRuntimeService;
    return { pool, svc: new WhatsappService(pool as never, runtime) };
  }

  it('escalates instead of sending the identical reply a second time', async () => {
    const { pool, svc } = poolWithRuntime(['Hehe maaf kak, kurang nangkep maksudnya']);

    await svc.handleInbound({ tenantId: TENANT_ID, from: CUSTOMER, text: 'minta penawaran harga', messageId: 'M1' });
    await svc.handleInbound({ tenantId: TENANT_ID, from: CUSTOMER, text: 'harga', messageId: 'M2' });

    // First answer went out; the repeat became a handover.
    expect(pool.escalated).toEqual(['conv-1']);
  });

  it('ignores cosmetic whitespace/case differences when deciding', async () => {
    const { pool, svc } = poolWithRuntime([
      'Hehe maaf kak, kurang nangkep maksudnya',
      'hehe   maaf kak,  KURANG nangkep maksudnya',
    ]);

    await svc.handleInbound({ tenantId: TENANT_ID, from: CUSTOMER, text: 'a', messageId: 'M1' });
    await svc.handleInbound({ tenantId: TENANT_ID, from: CUSTOMER, text: 'b', messageId: 'M2' });

    expect(pool.escalated).toEqual(['conv-1']);
  });

  it('lets a genuinely different answer through', async () => {
    // The guard must not fire on a working conversation.
    const { pool, svc } = poolWithRuntime(['Harga kalibrasi oven Rp 2.500.000', 'Pengerjaan sekitar 5 hari kerja']);

    await svc.handleInbound({ tenantId: TENANT_ID, from: CUSTOMER, text: 'harga oven', messageId: 'M1' });
    await svc.handleInbound({ tenantId: TENANT_ID, from: CUSTOMER, text: 'berapa lama', messageId: 'M2' });

    expect(pool.escalated).toEqual([]);
  });
});

describe('escalation must not page the assistant itself', () => {
  /**
   * Found live 2026-09-22: the Kalibrasi tenant's escalation_number WAS its own
   * WhatsApp line, so every handover messaged the bot's own chat and no human
   * ever saw it. With quote-escalation switched on, that would have silently
   * swallowed exactly the requests the client wanted routed to a person.
   */
  function poolWithNumbers(escalation: string, waNumber: string) {
    const pool = createPool();
    const base = pool.query.getMockImplementation()!;
    pool.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('SELECT * FROM agent_configs')) {
        return {
          rows: [{
            tenant_id: TENANT_ID, base_prompt: 'b', product_knowledge: 'k', skills: null,
            escalation_number: escalation, wa_number: waNumber, max_messages_per_day: 50,
            wa_provider: 'waha', waha_session: 'sess', ai_reply_enabled: true,
            routing_mode: 'builtin', per_branch_wa_enabled: false, waha_mock: true,
          }],
          rowCount: 1,
        };
      }
      return base(sql, params);
    });
    const runtime = {
      generate: vi.fn(async () => ({ text: '', escalate: true, mode: 'fluid', agentName: 'Kalia' })),
    } as unknown as AgentRuntimeService;
    return { pool, svc: new WhatsappService(pool as never, runtime) };
  }

  it('still marks the conversation escalated when the number is its own line', async () => {
    // The Conversation Log is the real safety net — losing THAT would hide the
    // customer entirely, which is worse than a missing page.
    const { pool, svc } = poolWithNumbers('6285169416316', '6285169416316');
    await svc.handleInbound({ tenantId: TENANT_ID, from: CUSTOMER, text: 'mau bicara dengan orang', messageId: 'E1' });
    expect(pool.escalated).toEqual(['conv-1']);
  });

  it('pages normally when the escalation number is a different person', async () => {
    const { pool, svc } = poolWithNumbers('628111222333', '6285169416316');
    await svc.handleInbound({ tenantId: TENANT_ID, from: CUSTOMER, text: 'mau bicara dengan orang', messageId: 'E2' });
    expect(pool.escalated).toEqual(['conv-1']);
  });
});
