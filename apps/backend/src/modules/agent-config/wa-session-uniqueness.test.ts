import { describe, it, expect, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { AgentConfigService } from './agent-config.service';

/**
 * WAHA session-name uniqueness (migration 103).
 *
 * Before this, the collision check existed ONLY on the per-branch write path.
 * The tenant path just did `waha_session = COALESCE($9, …)` against a column
 * with no constraint on it (migration 015 never added one), so two tenants
 * could both save 'primary' — and inbound went to whichever row Postgres
 * happened to return, since the resolver used `LIMIT 1` with no ordering.
 *
 * Uniqueness is scoped to the GATEWAY, not global: WAHA Core serves exactly one
 * session and it must be named 'default', so with a container per tenant two
 * tenants legitimately both use 'default'. What must never happen is two lines
 * sharing one gateway AND one session name.
 */

const SENTINEL = '00000000-0000-0000-0000-000000000000';
const ACME = 'tenant-acme';
const BETA = 'tenant-beta';
const GW_BETA = '11111111-1111-1111-1111-111111111111';

interface Line { tenantId?: string; outletId?: string; session: string | null; gatewayId: string | null }

/**
 * Pool standing in for the two config tables. The session-clash queries are
 * answered by filtering `lines` the same way the real SQL does — same session,
 * same gateway (NULL collapsing to the sentinel), excluding the row being written.
 */
function createPool(lines: Line[]) {
  const gwOf = (l: Line) => l.gatewayId ?? SENTINEL;

  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      // assertSessionFree reads the written row's own gateway first.
      if (sql.startsWith('SELECT wa_gateway_id FROM agent_configs')) {
        const row = lines.find((l) => l.tenantId === params[0]);
        return { rows: row ? [{ wa_gateway_id: row.gatewayId }] : [], rowCount: row ? 1 : 0 };
      }
      if (sql.startsWith('SELECT wa_gateway_id FROM outlet_agent_configs')) {
        const row = lines.find((l) => l.outletId === params[0]);
        return { rows: row ? [{ wa_gateway_id: row.gatewayId }] : [], rowCount: row ? 1 : 0 };
      }
      if (sql.includes('SELECT 1 FROM agent_configs')) {
        const [name, , gwKey, excludeTenant] = params as [string, string, string, string | null];
        const hits = lines.filter((l) => l.tenantId && l.session === name && gwOf(l) === gwKey
          && (!excludeTenant || l.tenantId !== excludeTenant));
        return { rows: hits.map(() => ({ '?column?': 1 })), rowCount: hits.length };
      }
      if (sql.includes('SELECT 1 FROM outlet_agent_configs')) {
        const [name, , gwKey, excludeOutlet] = params as [string, string, string, string | null];
        const hits = lines.filter((l) => l.outletId && l.session === name && gwOf(l) === gwKey
          && (!excludeOutlet || l.outletId !== excludeOutlet));
        return { rows: hits.map(() => ({ '?column?': 1 })), rowCount: hits.length };
      }
      // The upsert + the re-read that update() ends with: not under test here.
      if (sql.includes('INSERT INTO agent_configs')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
  };
}

/** update() ends by re-reading the row; short-circuit that so tests stay focused. */
function makeService(pool: ReturnType<typeof createPool>): AgentConfigService {
  const svc = new AgentConfigService(pool as never);
  vi.spyOn(svc, 'get').mockResolvedValue({} as never);
  return svc;
}

describe('WAHA session uniqueness is enforced on the TENANT write path', () => {
  it('rejects a session already claimed by another tenant on the same gateway', async () => {
    const pool = createPool([
      { tenantId: ACME, session: 'primary', gatewayId: null },
      { tenantId: BETA, session: null, gatewayId: null },
    ]);
    const svc = makeService(pool);

    await expect(svc.update(BETA, { wahaSession: 'primary' })).rejects.toThrow(ConflictException);
    // Nothing was written.
    expect(pool.query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO agent_configs'))).toBe(false);
  });

  it('rejects a session already claimed by a BRANCH line on the same gateway', async () => {
    const pool = createPool([
      { outletId: 'outlet-1', session: 'bintaro', gatewayId: null },
      { tenantId: BETA, session: null, gatewayId: null },
    ]);
    const svc = makeService(pool);

    await expect(svc.update(BETA, { wahaSession: 'bintaro' })).rejects.toThrow(ConflictException);
  });

  it('ALLOWS the same session name on a different gateway — one Core box per tenant', async () => {
    // ACME owns 'default' on the platform gateway; BETA has its own container.
    const pool = createPool([
      { tenantId: ACME, session: 'default', gatewayId: null },
      { tenantId: BETA, session: null, gatewayId: GW_BETA },
    ]);
    const svc = makeService(pool);

    await expect(svc.update(BETA, { wahaSession: 'default' })).resolves.toBeDefined();
    expect(pool.query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO agent_configs'))).toBe(true);
  });

  it('lets a tenant re-save its OWN session unchanged', async () => {
    const pool = createPool([{ tenantId: ACME, session: 'primary', gatewayId: null }]);
    const svc = makeService(pool);

    await expect(svc.update(ACME, { wahaSession: 'primary' })).resolves.toBeDefined();
  });

  it('skips the check when the write does not touch the session', async () => {
    const pool = createPool([
      { tenantId: ACME, session: 'primary', gatewayId: null },
      { tenantId: BETA, session: 'primary', gatewayId: null }, // pre-existing collision
    ]);
    const svc = makeService(pool);

    // Editing only the escalation number must not be blocked by legacy data.
    await expect(svc.update(BETA, { escalationNumber: '628999' })).resolves.toBeDefined();
  });

  it('a cleared session name is not a collision', async () => {
    const pool = createPool([
      { tenantId: ACME, session: 'primary', gatewayId: null },
      { tenantId: BETA, session: 'primary', gatewayId: null },
    ]);
    const svc = makeService(pool);

    await expect(svc.update(BETA, { wahaSession: '' })).resolves.toBeDefined();
  });
});
