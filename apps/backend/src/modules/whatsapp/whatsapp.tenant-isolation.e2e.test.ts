import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WhatsappService } from './whatsapp.service';
import type { AgentRuntimeService } from './agent-runtime.service';

/**
 * Transport isolation between tenants (migration 103). These run with the
 * simulation bypass OFF, because the bug lived in the REAL gateway paths —
 * the mock short-circuits before any of them.
 *
 * Each test pins one of the three holes that let one tenant use another's
 * WhatsApp line:
 *
 *  1. `cfg.waha_session || 'default'` — a tenant that had never configured
 *     WhatsApp silently borrowed whoever owned the session named 'default'.
 *     Its status showed "Connected", its outbound went out from the other
 *     tenant's number, and Connect/Get QR drove (and could log out, or re-pair)
 *     the other tenant's line.
 *  2. One gateway URL for everyone — the deployed WAHA is tier CORE, which
 *     serves exactly one session named 'default', so a second tenant's line has
 *     to live on its own container.
 *  3. Session name as inbound identity — public, guessable, and identical
 *     ('default') on every Core container, so it can identify nobody.
 */

const ACME = 'tenant-acme';
const BETA = 'tenant-beta';
const ACME_TOKEN = 'a'.repeat(48);
const BETA_TOKEN = 'b'.repeat(48);
const BETA_GATEWAY_ID = '11111111-1111-1111-1111-111111111111';
const CUSTOMER = '628123456789';

interface LineSpec {
  tenantId: string;
  wahaSession: string | null;
  gatewayId: string | null;
  token: string | null;
}

/**
 * A pool holding several tenants' lines, plus one registered gateway. ACME sits
 * on the platform default gateway (wa_gateway_id NULL); BETA sits on its own
 * container — and both legitimately use the session name 'default'.
 */
function createPool(lines: LineSpec[]) {
  const rows = new Map<string, Record<string, unknown>>();
  for (const l of lines) {
    rows.set(l.tenantId, {
      tenant_id: l.tenantId, base_prompt: 'You are an assistant.', product_knowledge: '',
      escalation_number: null, max_messages_per_day: 50,
      wa_provider: 'waha', wa_number: '628000', waha_session: l.wahaSession,
      kirim_api_key: null, kirim_phone_id: null, ai_reply_enabled: true,
      routing_mode: 'builtin', n8n_flow_id: null, bridge_token: null,
      per_branch_wa_enabled: false, waha_mock: false,
      wa_gateway_id: l.gatewayId, wa_webhook_token: l.token,
    });
  }

  const messages: { tenantId: string; direction: string; body: string }[] = [];

  const pool = {
    rows,
    messages,
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('SELECT * FROM agent_configs')) {
        const row = rows.get(params[0] as string);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      // The gateway registry: one extra container, for BETA.
      if (sql.includes('FROM wa_gateways WHERE id')) {
        return params[0] === BETA_GATEWAY_ID
          ? { rows: [{ name: 'beta-box', base_url: 'http://waha-beta:3000', api_key: 'beta-key', is_active: true }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM agent_configs WHERE wa_webhook_token')) {
        const hit = [...rows.values()].find((r) => r.wa_webhook_token === params[0]);
        return hit ? { rows: [{ tenant_id: hit.tenant_id }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM outlet_agent_configs WHERE wa_webhook_token')) return { rows: [], rowCount: 0 };
      if (sql.includes('FROM outlet_agent_configs')) return { rows: [], rowCount: 0 };
      if (sql.includes('SELECT tenant_id FROM agent_configs WHERE waha_session')) {
        const hit = [...rows.values()].find((r) => r.waha_session === params[0]);
        return hit ? { rows: [{ tenant_id: hit.tenant_id }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.includes('INSERT INTO wa_conversations')) {
        return { rows: [{ id: `conv-${params[0]}`, ai_enabled: true, messages_today: 0, messages_day: null }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO wa_messages')) {
        messages.push({ tenantId: params[0] as string, direction: params[2] as string, body: params[3] as string });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('SELECT name FROM tenants')) return { rows: [{ name: 'Test Co' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
  };
  return pool;
}

function stubRuntime(): AgentRuntimeService {
  return {
    generate: vi.fn(async () => ({ text: 'halo kak', escalate: false, mode: 'fluid' as const, agentName: 'CS' })),
  } as unknown as AgentRuntimeService;
}

/** Records every outbound HTTP call so we can assert WHICH gateway was hit. */
function stubFetch(status = 'WORKING') {
  const calls: { url: string; apiKey?: string; body?: unknown }[] = [];
  const fn = vi.fn(async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
    calls.push({
      url,
      apiKey: init?.headers?.['X-Api-Key'],
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    if (url.includes('/api/sessions/')) {
      return { ok: true, json: async () => ({ status }) } as unknown as Response;
    }
    return { ok: true, json: async () => ({}), text: async () => '' } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

/**
 * A freshly provisioned gateway: it does not hold the session yet, so
 * `GET /api/sessions/<name>` 404s and `POST /api/sessions/<name>/start` 404s
 * too. Only `POST /api/sessions` can bring it into being. Once created, the
 * status reads SCAN_QR_CODE.
 */
function stubFreshGatewayFetch() {
  const calls: { url: string; method?: string; body?: unknown }[] = [];
  let created = false;
  const fn = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined });
    const isCreate = url.endsWith('/api/sessions') && init?.method === 'POST';
    if (isCreate) { created = true; return { ok: true, status: 201, json: async () => ({}), text: async () => '' } as unknown as Response; }
    if (/\/api\/sessions\/[^/]+$/.test(url)) {
      return created
        ? { ok: true, status: 200, json: async () => ({ status: 'SCAN_QR_CODE' }) } as unknown as Response
        : { ok: false, status: 404, json: async () => ({}), text: async () => 'Session not found' } as unknown as Response;
    }
    if (url.includes('/start') || url.includes('/restart') || url.includes('/logout')) {
      return { ok: false, status: 404, json: async () => ({}), text: async () => 'Session not found' } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return { calls, wasCreated: () => created };
}

describe('WhatsApp transport isolation between tenants', () => {
  const prevMock = process.env.WAHA_MOCK;
  const prevUrl = process.env.WAHA_URL;

  beforeEach(() => {
    process.env.WAHA_MOCK = 'false';
    process.env.WAHA_URL = 'http://waha-platform:3000';
  });
  afterEach(() => {
    process.env.WAHA_MOCK = prevMock;
    process.env.WAHA_URL = prevUrl;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ── Hole 1: the 'default' fallback ─────────────────────────────────────────

  it('a tenant with NO session configured reports not_configured, not the other tenant\'s WORKING', async () => {
    const pool = createPool([
      { tenantId: ACME, wahaSession: 'default', gatewayId: null, token: ACME_TOKEN },
      { tenantId: BETA, wahaSession: null, gatewayId: null, token: BETA_TOKEN },
    ]);
    const calls = stubFetch('WORKING');
    const svc = new WhatsappService(pool as never, stubRuntime());

    expect(await svc.status(BETA)).toEqual({ status: 'not_configured' });
    // The decisive part: it never asked the gateway at all, so it cannot have
    // reported another tenant's session as its own.
    expect(calls).toHaveLength(0);
    // ACME, which really does own that session, still reads its true status.
    expect(await svc.status(ACME)).toEqual({ status: 'WORKING' });
  });

  it('a tenant with NO session sends NOTHING instead of sending from the other tenant\'s number', async () => {
    const pool = createPool([
      { tenantId: ACME, wahaSession: 'default', gatewayId: null, token: ACME_TOKEN },
      { tenantId: BETA, wahaSession: null, gatewayId: null, token: BETA_TOKEN },
    ]);
    const calls = stubFetch();
    const svc = new WhatsappService(pool as never, stubRuntime());

    expect(await svc.sendText(BETA, CUSTOMER, 'promo hari ini')).toBe(false);
    expect(calls.filter((c) => c.url.includes('/api/sendText'))).toHaveLength(0);
  });

  it('Connect/Get QR on an unconfigured line never touches another tenant\'s session', async () => {
    const pool = createPool([
      { tenantId: ACME, wahaSession: 'default', gatewayId: null, token: ACME_TOKEN },
      { tenantId: BETA, wahaSession: null, gatewayId: null, token: BETA_TOKEN },
    ]);
    const calls = stubFetch('SCAN_QR_CODE');
    const svc = new WhatsappService(pool as never, stubRuntime());

    const ensured = await svc.ensureSession(BETA);
    expect(ensured.status).toBe('not_configured');
    const qr = await svc.qr(BETA);
    expect(qr).toMatchObject({ qr: null, status: 'not_configured' });

    // No start / restart / logout / QR fetch reached the gateway. `logout` is
    // the dangerous one: it drops the pairing and forces a re-scan.
    expect(calls).toHaveLength(0);
  });

  // ── Hole 2: one gateway for everyone ───────────────────────────────────────

  it('two tenants sharing the session name go to their OWN gateways', async () => {
    // Both are named 'default' because WAHA Core permits no other name.
    const pool = createPool([
      { tenantId: ACME, wahaSession: 'default', gatewayId: null, token: ACME_TOKEN },
      { tenantId: BETA, wahaSession: 'default', gatewayId: BETA_GATEWAY_ID, token: BETA_TOKEN },
    ]);
    const calls = stubFetch();
    const svc = new WhatsappService(pool as never, stubRuntime());

    expect(await svc.sendText(ACME, CUSTOMER, 'from acme')).toBe(true);
    expect(await svc.sendText(BETA, CUSTOMER, 'from beta')).toBe(true);

    const sends = calls.filter((c) => c.url.includes('/api/sendText'));
    expect(sends).toHaveLength(2);
    expect(sends[0]!.url).toBe('http://waha-platform:3000/api/sendText');
    expect(sends[1]!.url).toBe('http://waha-beta:3000/api/sendText');
    // Each gateway gets its own API key, never the platform one.
    expect(sends[1]!.apiKey).toBe('beta-key');
  });

  it('a line whose gateway is missing goes offline rather than falling back to the default', async () => {
    const pool = createPool([
      { tenantId: BETA, wahaSession: 'default', gatewayId: '99999999-9999-9999-9999-999999999999', token: BETA_TOKEN },
    ]);
    const calls = stubFetch();
    const svc = new WhatsappService(pool as never, stubRuntime());

    expect(await svc.sendText(BETA, CUSTOMER, 'hi')).toBe(false);
    expect(await svc.status(BETA)).toEqual({ status: 'not_configured' });
    expect(calls).toHaveLength(0);
  });

  // ── Hole 3: inbound identity ───────────────────────────────────────────────

  it('inbound is attributed by TOKEN, so identical session names still resolve correctly', async () => {
    const pool = createPool([
      { tenantId: ACME, wahaSession: 'default', gatewayId: null, token: ACME_TOKEN },
      { tenantId: BETA, wahaSession: 'default', gatewayId: BETA_GATEWAY_ID, token: BETA_TOKEN },
    ]);
    stubFetch();
    const svc = new WhatsappService(pool as never, stubRuntime());

    // Both containers report session 'default' — only the token differs.
    await svc.handleInbound({ token: BETA_TOKEN, session: 'default', from: CUSTOMER, text: 'halo' });

    const inbound = pool.messages.filter((m) => m.direction === 'inbound');
    expect(inbound).toHaveLength(1);
    expect(inbound[0]!.tenantId).toBe(BETA);
    expect(pool.messages.every((m) => m.tenantId === BETA)).toBe(true);
  });

  it('an unknown token is dropped — a guessed session name no longer gets you in', async () => {
    const pool = createPool([
      { tenantId: ACME, wahaSession: 'default', gatewayId: null, token: ACME_TOKEN },
    ]);
    stubFetch();
    const svc = new WhatsappService(pool as never, stubRuntime());

    await svc.handleInbound({ token: 'c'.repeat(48), session: 'default', from: CUSTOMER, text: 'injected' });
    expect(pool.messages).toHaveLength(0);
  });

  it('WA_WEBHOOK_REQUIRE_TOKEN closes the tokenless route once every gateway is re-pointed', async () => {
    const prev = process.env.WA_WEBHOOK_REQUIRE_TOKEN;
    process.env.WA_WEBHOOK_REQUIRE_TOKEN = 'true';
    try {
      const pool = createPool([
        { tenantId: ACME, wahaSession: 'default', gatewayId: null, token: ACME_TOKEN },
      ]);
      stubFetch();
      const svc = new WhatsappService(pool as never, stubRuntime());

      await svc.handleInbound({ session: 'default', from: CUSTOMER, text: 'injected' });
      expect(pool.messages).toHaveLength(0);
    } finally {
      process.env.WA_WEBHOOK_REQUIRE_TOKEN = prev;
    }
  });

  it('until then, a not-yet-re-pointed gateway still resolves by session name', async () => {
    const pool = createPool([
      { tenantId: ACME, wahaSession: 'legacy-session', gatewayId: null, token: ACME_TOKEN },
    ]);
    stubFetch();
    const svc = new WhatsappService(pool as never, stubRuntime());

    await svc.handleInbound({ session: 'legacy-session', from: CUSTOMER, text: 'halo' });
    expect(pool.messages.filter((m) => m.direction === 'inbound')).toHaveLength(1);
    expect(pool.messages[0]!.tenantId).toBe(ACME);
  });

  // ── Provisioning a brand-new gateway ───────────────────────────────────────

  it('CREATES the session on a fresh gateway instead of no-opping on a 404', async () => {
    // Found in live testing: a container that has never held the session 404s
    // on GET and on /start. Only POST /api/sessions can create it — so
    // Connect/Get QR silently did nothing on every newly provisioned tenant.
    const pool = createPool([
      { tenantId: BETA, wahaSession: 'default', gatewayId: BETA_GATEWAY_ID, token: BETA_TOKEN },
    ]);
    const { calls, wasCreated } = stubFreshGatewayFetch();
    const svc = new WhatsappService(pool as never, stubRuntime());

    const ensured = await svc.ensureSession(BETA);

    expect(wasCreated()).toBe(true);
    expect(ensured.status).toBe('SCAN_QR_CODE');
    const create = calls.find((c) => c.url === 'http://waha-beta:3000/api/sessions' && c.method === 'POST');
    expect(create).toBeDefined();
    expect(create!.body).toMatchObject({ name: 'default', start: true });
  });

  it('reports the session as missing, not stopped, when the gateway does not hold it', async () => {
    const pool = createPool([
      { tenantId: BETA, wahaSession: 'default', gatewayId: BETA_GATEWAY_ID, token: BETA_TOKEN },
    ]);
    stubFreshGatewayFetch();
    const svc = new WhatsappService(pool as never, stubRuntime());

    // 'stopped' would read as "exists, just not running" and hide the real state.
    expect(await svc.status(BETA)).toEqual({ status: 'missing' });
  });
});
