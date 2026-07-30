import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WhatsappService } from './whatsapp.service';
import type { AgentRuntimeService } from './agent-runtime.service';

/**
 * WAHA session recovery (the `no_qr` dead-end regression).
 *
 * A line that WhatsApp has revoked (`stream:error 401` + `conflict{device_removed}`,
 * i.e. the device was logged out on the phone) parks the session in FAILED. The old
 * code answered that with the DEPRECATED `POST /api/sessions/start`, which returns
 * 422 "already started" for a FAILED session, then mapped the resulting QR 422 to a
 * bare `no_qr` — so the Connect button could never recover the line and said nothing
 * about why. These tests pin the healing ladder and the reason reporting.
 */

const TENANT_ID = 'tenant-rec-001';
const SESSION = 'default';

function createPool() {
  const cfg = {
    tenant_id: TENANT_ID, base_prompt: 'p', product_knowledge: 'k',
    escalation_number: '628999', max_messages_per_day: 50,
    wa_provider: 'waha', wa_number: '628000', waha_session: SESSION,
    kirim_api_key: null, kirim_phone_id: null, ai_reply_enabled: true,
    per_branch_wa_enabled: false, waha_mock: false,
  };
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('SELECT * FROM agent_configs')) return { rows: [cfg], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
  };
}

function stubRuntime(): AgentRuntimeService {
  return { generate: vi.fn() } as unknown as AgentRuntimeService;
}

/** Records every WAHA call and replays a scripted sequence of session statuses. */
function fakeWaha(opts: { statuses: string[]; qrOk?: boolean; qrCode?: number }) {
  const calls: string[] = [];
  const statuses = [...opts.statuses];
  let last = statuses[statuses.length - 1] ?? 'unknown';

  const fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    calls.push(`${init?.method ?? 'GET'} ${path}`);

    if (path.includes('/auth/qr')) {
      if (opts.qrOk) {
        return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as never;
      }
      return { ok: false, status: opts.qrCode ?? 422, text: async () => 'not as expected' } as never;
    }
    // POST start/restart/logout — acknowledged; the status script drives the outcome.
    if (init?.method === 'POST') return { ok: true, status: 201, json: async () => ({}) } as never;
    // GET session status: walk the script, then hold on the final value.
    if (statuses.length > 1) last = statuses.shift()!;
    else last = statuses[0] ?? last;
    return { ok: true, status: 200, json: async () => ({ status: last }) } as never;
  });

  return { fetchMock, calls };
}

describe('WAHA session recovery', () => {
  const prevMock = process.env.WAHA_MOCK;
  const prevUrl = process.env.WAHA_URL;

  beforeEach(() => { process.env.WAHA_MOCK = 'false'; process.env.WAHA_URL = 'http://waha:3000'; });
  afterEach(() => { process.env.WAHA_MOCK = prevMock; process.env.WAHA_URL = prevUrl; vi.restoreAllMocks(); });

  const svc = () => new WhatsappService(createPool() as never, stubRuntime());

  it('leaves a WORKING session alone — never restarts or logs out a live line', async () => {
    const { fetchMock, calls } = fakeWaha({ statuses: ['WORKING'] });
    vi.stubGlobal('fetch', fetchMock);

    expect(await svc().ensureSession(TENANT_ID)).toEqual({ status: 'WORKING' });
    expect(calls.filter((c) => c.startsWith('POST'))).toHaveLength(0);
  });

  it('starts a stopped session', async () => {
    const { fetchMock, calls } = fakeWaha({ statuses: ['stopped', 'SCAN_QR_CODE'] });
    vi.stubGlobal('fetch', fetchMock);

    expect((await svc().ensureSession(TENANT_ID)).status).toBe('SCAN_QR_CODE');
    expect(calls).toContain(`POST /api/sessions/${SESSION}/start`);
    expect(calls).not.toContain(`POST /api/sessions/${SESSION}/logout`);
  });

  it('recovers a FAILED session with restart alone, keeping the pairing', async () => {
    const { fetchMock, calls } = fakeWaha({ statuses: ['FAILED', 'WORKING'] });
    vi.stubGlobal('fetch', fetchMock);

    expect((await svc().ensureSession(TENANT_ID)).status).toBe('WORKING');
    expect(calls).toContain(`POST /api/sessions/${SESSION}/restart`);
    // restart was enough — the destructive step must NOT be reached
    expect(calls).not.toContain(`POST /api/sessions/${SESSION}/logout`);
  });

  it('wipes revoked credentials when restart does not clear FAILED (device_removed)', async () => {
    // FAILED, restart → still FAILED, logout+start → SCAN_QR_CODE
    const { fetchMock, calls } = fakeWaha({ statuses: ['FAILED', 'FAILED', 'SCAN_QR_CODE'] });
    vi.stubGlobal('fetch', fetchMock);

    const res = await svc().ensureSession(TENANT_ID);
    expect(res.status).toBe('SCAN_QR_CODE');
    expect(res.reason).toMatch(/revoked/i);
    expect(calls).toEqual(expect.arrayContaining([
      `POST /api/sessions/${SESSION}/restart`,
      `POST /api/sessions/${SESSION}/logout`,
      `POST /api/sessions/${SESSION}/start`,
    ]));
    // ordering: restart is attempted BEFORE the destructive logout
    expect(calls.indexOf(`POST /api/sessions/${SESSION}/restart`))
      .toBeLessThan(calls.indexOf(`POST /api/sessions/${SESSION}/logout`));
  });

  it('blames a stale WAHA image when even a fresh pairing cannot register', async () => {
    // This is the 2026-07-28 outage: NOWEB sends an outdated wa.version, WhatsApp
    // rejects registration, and the session never leaves FAILED.
    const { fetchMock } = fakeWaha({ statuses: ['FAILED'] });
    vi.stubGlobal('fetch', fetchMock);

    const res = await svc().ensureSession(TENANT_ID);
    expect(res.status).toBe('FAILED');
    expect(res.reason).toMatch(/image is likely out of date/i);
  });

  it('qr() returns a data-URL once the session is scannable', async () => {
    const { fetchMock } = fakeWaha({ statuses: ['SCAN_QR_CODE'], qrOk: true });
    vi.stubGlobal('fetch', fetchMock);

    const res = await svc().qr(TENANT_ID);
    expect(res.status).toBe('qr');
    expect(res.qr).toMatch(/^data:image\/png;base64,/);
  });

  it('qr() never reports a bare no_qr — it reports the real state and a reason', async () => {
    const { fetchMock, calls } = fakeWaha({ statuses: ['FAILED'] });
    vi.stubGlobal('fetch', fetchMock);

    const res = await svc().qr(TENANT_ID);
    expect(res.qr).toBeNull();
    expect(res.status).not.toBe('no_qr');
    expect(res.status).toBe('FAILED');
    expect(res.reason).toBeTruthy();
    // no point asking WAHA for a QR when the session can't serve one
    expect(calls.some((c) => c.includes('/auth/qr'))).toBe(false);
  });

  it('qr() on an already-connected line explains that no QR is needed', async () => {
    const { fetchMock } = fakeWaha({ statuses: ['WORKING'] });
    vi.stubGlobal('fetch', fetchMock);

    const res = await svc().qr(TENANT_ID);
    expect(res).toEqual({ qr: null, status: 'WORKING', reason: expect.stringMatching(/already connected/i) });
  });

  it('reports unreachable without touching the session when WAHA is down', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    vi.stubGlobal('fetch', fetchMock);

    const res = await svc().ensureSession(TENANT_ID);
    expect(res.status).toBe('unreachable');
    // one status probe, no recovery attempts against a dead service
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
