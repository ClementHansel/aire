import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WhatsappService } from './whatsapp.service';
import type { AgentRuntimeService } from './agent-runtime.service';

/**
 * Per-tenant WAHA simulation toggle (migration 068 — agent_configs.waha_mock).
 * Global env WAHA_MOCK is OFF here; mock is driven purely by the tenant flag, so
 * one tenant can simulate while others use the real connection on the same server.
 */

const TENANT_ID = 'tenant-mock-001';
const CUSTOMER = '628123456789';

function createPool(wahaMock: boolean) {
  const cfg = {
    tenant_id: TENANT_ID, base_prompt: 'b', product_knowledge: 'k',
    escalation_number: '628999', max_messages_per_day: 50,
    wa_provider: 'waha', wa_number: '628000', waha_session: 'sess',
    kapso_api_key: null, ai_reply_enabled: true,
    routing_mode: 'builtin', n8n_flow_id: null, bridge_token: null,
    per_branch_wa_enabled: false, waha_mock: wahaMock,
  };
  const outbox: Record<string, unknown>[] = [];
  const convs = new Map<string, { id: string }>();
  const pool = {
    outbox,
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('SELECT * FROM agent_configs')) return { rows: [cfg], rowCount: 1 };
      if (sql.includes('INSERT INTO wa_conversations')) {
        const key = params[1] as string;
        let c = convs.get(key); if (!c) { c = { id: `conv-${convs.size + 1}` }; convs.set(key, c); }
        return { rows: [{ id: c.id, ai_enabled: true, messages_today: 0, messages_day: null }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO wa_mock_outbox')) { outbox.push({ session: params[5], body: params[4] }); return { rows: [], rowCount: 1 }; }
      return { rows: [], rowCount: 0 };
    }),
  };
  return pool;
}

describe('Per-tenant WAHA mock toggle (env global OFF)', () => {
  const prev = process.env.WAHA_MOCK;
  beforeEach(() => { process.env.WAHA_MOCK = 'false'; });
  afterEach(() => { process.env.WAHA_MOCK = prev; vi.restoreAllMocks(); });

  it('tenant flag ON → outbound is captured to the mock outbox, status WORKING', async () => {
    const pool = createPool(true);
    const svc = new WhatsappService(pool as never, {} as AgentRuntimeService);
    expect(svc.isMock()).toBe(false); // global env is off
    expect(await svc.isMockEnabled(TENANT_ID)).toBe(true); // but the tenant simulates
    const ok = await svc.sendText(TENANT_ID, CUSTOMER, 'hi');
    expect(ok).toBe(true);
    expect(pool.outbox).toHaveLength(1);
    expect(await svc.status(TENANT_ID)).toEqual({ status: 'WORKING' });
  });

  it('tenant flag OFF → no mock capture; the real gateway path is taken', async () => {
    const pool = createPool(false);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    const svc = new WhatsappService(pool as never, {} as AgentRuntimeService);
    expect(await svc.isMockEnabled(TENANT_ID)).toBe(false);
    await svc.sendText(TENANT_ID, CUSTOMER, 'hi');
    expect(pool.outbox).toHaveLength(0);       // nothing captured
    expect(fetchSpy).toHaveBeenCalled();        // real WAHA HTTP attempted
  });
});
