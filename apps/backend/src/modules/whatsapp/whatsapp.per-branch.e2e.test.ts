import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WhatsappService } from './whatsapp.service';
import type { AgentRuntimeService } from './agent-runtime.service';

/**
 * Per-branch WhatsApp (migration 067) resolution tests, in SIMULATION MODE
 * (WAHA_MOCK). Proves the connection-only override:
 *  - toggle OFF → the tenant central line is used (regression).
 *  - toggle ON + branch has its own session → inbound on that session resolves to
 *    the branch, the reply is captured on the BRANCH session, and the branch
 *    receives the outletId (runtime + conversation scoping).
 *  - toggle ON + branch has NO line → sends are a no-op ("require own number");
 *    status reports not_configured. No fallback to the tenant line.
 */

const TENANT_ID = 'tenant-e2e-001';
const TENANT_SESSION = 'tenant-session';
const BRANCH_ID = 'outlet-bintaro';
const BRANCH_SESSION = 'bintaro-session';
const UNWIRED_BRANCH_ID = 'outlet-bsd';
const CUSTOMER = '628123456789';

interface Conv { id: string; chat_id: string; outlet_id: string | null; ai_enabled: boolean; status: string; messages_today: number; messages_day: string | null }

function createPool(opts: { perBranch: boolean; branchSession?: string | null }) {
  const cfg = {
    tenant_id: TENANT_ID, base_prompt: 'You are the AIRE assistant.', product_knowledge: 'Hours 08-20.',
    escalation_number: '628999', max_messages_per_day: 50,
    wa_provider: 'waha', wa_number: '628000', waha_session: TENANT_SESSION,
    kirim_api_key: null, kirim_phone_id: null, ai_reply_enabled: true,
    routing_mode: 'builtin', n8n_flow_id: null, bridge_token: null,
    per_branch_wa_enabled: opts.perBranch,
  };
  // outlet_agent_configs rows keyed by outlet_id.
  const branchRows = new Map<string, { outlet_id: string; tenant_id: string; wa_provider: string; wa_number: string | null; waha_session: string | null; kirim_api_key: string | null; kirim_phone_id: string | null }>();
  if (opts.branchSession !== undefined) {
    branchRows.set(BRANCH_ID, { outlet_id: BRANCH_ID, tenant_id: TENANT_ID, wa_provider: 'waha', wa_number: '628111', waha_session: opts.branchSession, kirim_api_key: null, kirim_phone_id: null });
  }

  const convs = new Map<string, Conv>();
  const messages: { direction: string; body: string; from_ai: boolean }[] = [];
  const outbox: Record<string, unknown>[] = [];

  const pool = {
    convs, messages, outbox,
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('SELECT * FROM agent_configs')) return { rows: [cfg], rowCount: 1 };
      // config() branch overlay lookup by outlet_id
      if (sql.includes('FROM outlet_agent_configs WHERE outlet_id')) {
        const row = branchRows.get(params[0] as string);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      // resolveBySession(): branch first
      if (sql.includes('FROM outlet_agent_configs WHERE waha_session')) {
        const row = [...branchRows.values()].find((r) => r.waha_session === params[0]);
        return { rows: row ? [{ tenant_id: row.tenant_id, outlet_id: row.outlet_id }] : [], rowCount: row ? 1 : 0 };
      }
      // resolveBySession(): tenant fallback
      if (sql.includes('SELECT tenant_id FROM agent_configs WHERE waha_session')) {
        return cfg.waha_session === params[0] ? { rows: [{ tenant_id: TENANT_ID }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.includes('INSERT INTO wa_conversations')) {
        const chatId = params[1] as string;
        const outletId = (params[4] as string) ?? null;
        const key = `${chatId}|${outletId ?? '-'}`;
        let c = convs.get(key);
        if (!c) { c = { id: `conv-${convs.size + 1}`, chat_id: chatId, outlet_id: outletId, ai_enabled: true, status: 'open', messages_today: 0, messages_day: null }; convs.set(key, c); }
        return { rows: [{ id: c.id, ai_enabled: c.ai_enabled, messages_today: c.messages_today, messages_day: c.messages_day }], rowCount: 1 };
      }
      if (sql.includes('SELECT direction, body FROM wa_messages')) return { rows: messages.map((m) => ({ direction: m.direction, body: m.body })), rowCount: messages.length };
      if (sql.includes('INSERT INTO wa_messages')) { messages.push({ direction: params[2] as string, body: params[3] as string, from_ai: params[4] as boolean }); return { rows: [], rowCount: 1 }; }
      if (sql.includes('INSERT INTO wa_mock_outbox')) { outbox.push({ provider: params[1], chat_id: params[2], to_phone: params[3], body: params[4], session: params[5] }); return { rows: [], rowCount: 1 }; }
      return { rows: [], rowCount: 0 };
    }),
  };
  return pool;
}

function stubRuntime(): AgentRuntimeService {
  return { generate: vi.fn(async (p: { outletId?: string | null }) => ({ text: `reply for ${p.outletId ?? 'tenant'}`, escalate: false, mode: 'fluid' as const, agentName: 'CS' })) } as unknown as AgentRuntimeService;
}

describe('WhatsApp per-branch resolution (WAHA_MOCK)', () => {
  const prev = process.env.WAHA_MOCK;
  beforeEach(() => { process.env.WAHA_MOCK = 'true'; });
  afterEach(() => { process.env.WAHA_MOCK = prev; vi.restoreAllMocks(); });

  it('toggle OFF: inbound on the tenant session uses the tenant line', async () => {
    const pool = createPool({ perBranch: false });
    const svc = new WhatsappService(pool as never, stubRuntime());
    await svc.handleInbound({ session: TENANT_SESSION, from: CUSTOMER, text: 'halo' });
    expect(pool.outbox).toHaveLength(1);
    expect(pool.outbox[0]).toMatchObject({ session: TENANT_SESSION });
    // conversation is not scoped to any branch
    expect([...pool.convs.values()][0]!.outlet_id).toBeNull();
  });

  it('toggle ON + branch has a session: reply goes out on the BRANCH line, scoped to the outlet', async () => {
    const pool = createPool({ perBranch: true, branchSession: BRANCH_SESSION });
    const runtime = stubRuntime();
    const svc = new WhatsappService(pool as never, runtime);
    await svc.handleInbound({ session: BRANCH_SESSION, from: CUSTOMER, text: 'halo' });

    // resolved to the branch: runtime got the outletId, reply captured on branch session
    expect(runtime.generate).toHaveBeenCalledWith(expect.objectContaining({ outletId: BRANCH_ID }));
    expect(pool.outbox).toHaveLength(1);
    expect(pool.outbox[0]).toMatchObject({ session: BRANCH_SESSION });
    expect([...pool.convs.values()][0]!.outlet_id).toBe(BRANCH_ID);
  });

  it('toggle ON + branch has NO line: send is a no-op and status is not_configured', async () => {
    const pool = createPool({ perBranch: true }); // no branch row at all
    const runtime = stubRuntime();
    const svc = new WhatsappService(pool as never, runtime);

    // simulate-inbound style: tenantId + explicit outletId for an unwired branch
    await svc.handleInbound({ tenantId: TENANT_ID, outletId: UNWIRED_BRANCH_ID, from: CUSTOMER, text: 'halo' });

    // inbound is still logged, but no outbound was captured (no line to send on)
    expect(pool.messages.filter((m) => m.direction === 'inbound')).toHaveLength(1);
    expect(pool.outbox).toHaveLength(0);
  });

  it('status() reports not_configured for an unwired branch (real path, mock off)', async () => {
    process.env.WAHA_MOCK = 'false';
    const pool = createPool({ perBranch: true }); // no branch row
    const svc = new WhatsappService(pool as never, stubRuntime());
    expect(await svc.status(TENANT_ID, UNWIRED_BRANCH_ID)).toEqual({ status: 'not_configured' });
  });
});
