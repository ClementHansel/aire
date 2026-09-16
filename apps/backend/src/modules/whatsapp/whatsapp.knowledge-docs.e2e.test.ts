import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WhatsappService } from './whatsapp.service';
import { KnowledgeDocsService } from '../agent-config/knowledge-docs.service';
import type { AgentRuntimeService } from './agent-runtime.service';

/**
 * Proves the seam that makes uploaded knowledge documents worth anything: a
 * document the owner uploaded on the AI Knowledge page must actually reach the
 * prompt the customer AI runs on. Everything else about documents (upload,
 * edit, toggle) is only bookkeeping if this wiring is wrong.
 */

const TENANT_ID = 'tenant-docs-001';
const SESSION = 'docs-session';

function createPool(docs: { title: string; content: string }[]) {
  const cfg = {
    tenant_id: TENANT_ID, base_prompt: 'You are the AIRE assistant.', product_knowledge: 'Hours 08-20.',
    skills: null, escalation_number: '628999', max_messages_per_day: 50,
    wa_provider: 'waha', wa_number: '628000', waha_session: SESSION,
    kirim_api_key: null, kirim_phone_id: null, ai_reply_enabled: true,
    routing_mode: 'builtin', n8n_flow_id: null, bridge_token: null,
  };
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('SELECT * FROM agent_configs')) return { rows: [cfg], rowCount: 1 };
      if (sql.includes('FROM ai_knowledge_documents')) return { rows: docs, rowCount: docs.length };
      if (sql.includes('INSERT INTO wa_conversations')) {
        return { rows: [{ id: 'conv-1', ai_enabled: true, messages_today: 0, messages_day: null }], rowCount: 1 };
      }
      if (sql.includes('SELECT direction, body FROM wa_messages')) return { rows: [], rowCount: 0 };
      void params;
      return { rows: [], rowCount: 0 };
    }),
  };
}

function stubRuntime(): AgentRuntimeService {
  return { generate: vi.fn(async () => ({ text: 'Halo kak!', escalate: false, mode: 'fluid' as const, agentName: 'Irene' })) } as unknown as AgentRuntimeService;
}

function makeService(pool: ReturnType<typeof createPool>, runtime: AgentRuntimeService, withDocs = true) {
  const docsService = withDocs ? new KnowledgeDocsService(pool as never) : undefined;
  // Positional: pool, runtime, llm, pendingBooking, customerContext, jobMonitor,
  // renderer, whitelist, staffChat, knowledgeDocs.
  return new WhatsappService(
    pool as never, runtime,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    docsService,
  );
}

describe('WhatsApp pipeline: uploaded knowledge documents', () => {
  const prev = process.env.WAHA_MOCK;
  beforeEach(() => { process.env.WAHA_MOCK = 'true'; });
  afterEach(() => { process.env.WAHA_MOCK = prev; vi.restoreAllMocks(); });

  it('feeds the enabled documents to the AI alongside the free-text product knowledge', async () => {
    const pool = createPool([{ title: 'Harga LEAD', content: 'Detailing mulai Rp 1.500.000' }]);
    const runtime = stubRuntime();

    await makeService(pool, runtime).handleInbound({ tenantId: TENANT_ID, from: '628123456789', name: 'Budi', text: 'harga detailing?' });

    const knowledge = (runtime.generate as unknown as { mock: { calls: [{ knowledge: string }][] } }).mock.calls[0]![0].knowledge;
    expect(knowledge).toContain('Hours 08-20.');       // the existing free-text field survives
    expect(knowledge).toContain('### Harga LEAD');     // the document is labelled by its title
    expect(knowledge).toContain('Detailing mulai Rp 1.500.000');
  });

  it('leaves the prompt exactly as it was when the tenant has no documents', async () => {
    const pool = createPool([]);
    const runtime = stubRuntime();

    await makeService(pool, runtime).handleInbound({ tenantId: TENANT_ID, from: '628123456789', name: 'Budi', text: 'halo' });

    const knowledge = (runtime.generate as unknown as { mock: { calls: [{ knowledge: string }][] } }).mock.calls[0]![0].knowledge;
    expect(knowledge).toBe('Hours 08-20.');
  });

  it('still replies when the documents service is absent (older wiring / unit construction)', async () => {
    const pool = createPool([{ title: 'Harga', content: 'x' }]);
    const runtime = stubRuntime();

    await makeService(pool, runtime, false).handleInbound({ tenantId: TENANT_ID, from: '628123456789', name: 'Budi', text: 'halo' });

    const knowledge = (runtime.generate as unknown as { mock: { calls: [{ knowledge: string }][] } }).mock.calls[0]![0].knowledge;
    expect(knowledge).toBe('Hours 08-20.');
  });
});
