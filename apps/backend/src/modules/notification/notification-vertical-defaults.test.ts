import { describe, it, expect, vi } from 'vitest';
import { NotificationRendererService } from './notification-renderer.service';
import { getDefinition } from './notification-catalog';

/**
 * Per-vertical default wording.
 *
 * The stock bodies were written for a car wash, and several of them name a
 * vehicle. A calibration lab (`vertical = 'services'`) asking its customers for
 * "plat kendaraannya" is the visible symptom; the real problem was that the
 * sentence was built in TypeScript at the call site, so it appeared in no prompt
 * the owner could inspect and could not be changed for one tenant without
 * changing it for all of them.
 *
 * Precedence under test: owner override → this vertical's default → stock default.
 */

const CARWASH = 'tenant-carwash';
const LAB = 'tenant-lab';

/** Pool with a tenant vertical per id, and optional per-tenant overrides. */
function createPool(opts: { overrides?: { tenantId: string; key: string; body: string | null; enabled?: boolean }[] } = {}) {
  const verticals: Record<string, string> = { [CARWASH]: 'carwash', [LAB]: 'services' };
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('SELECT vertical FROM tenants')) {
        const v = verticals[params[0] as string];
        return { rows: v ? [{ vertical: v }] : [], rowCount: v ? 1 : 0 };
      }
      if (sql.includes('notification_templates')) {
        const rows = (opts.overrides ?? [])
          .filter((o) => o.tenantId === params[0])
          .map((o) => ({ template_key: o.key, body: o.body, enabled: o.enabled ?? true }));
        return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
}

describe('notification defaults follow the tenant vertical', () => {
  it('a services tenant is not asked for a vehicle plate', async () => {
    const svc = new NotificationRendererService(createPool() as never);

    const text = await svc.render(LAB, 'customer_identity_ask', {
      agentName: 'Kalia',
      businessName: 'PT Dinamika Kalibrasi Indonesia',
    });

    expect(text).toBeTruthy();
    expect(text).not.toMatch(/plat/i);
    expect(text).not.toMatch(/kendaraan/i);
    // Still asks for something it CAN match a customer on.
    expect(text).toMatch(/nomor HP/i);
    expect(text).toContain('Kalia');
    expect(text).toContain('PT Dinamika Kalibrasi Indonesia');
  });

  it('the car wash keeps the plate — fixing one tenant must not change the other', async () => {
    const svc = new NotificationRendererService(createPool() as never);

    const text = await svc.render(CARWASH, 'customer_identity_ask', {
      agentName: 'Irene',
      businessName: 'AIRE',
    });

    expect(text).toMatch(/plat kendaraannya/i);
    expect(text).toContain('Irene');
  });

  it('an owner override beats the vertical default', async () => {
    const svc = new NotificationRendererService(createPool({
      overrides: [{ tenantId: LAB, key: 'customer_identity_ask', body: 'Boleh minta nomor HP-nya kak {agentName}?' }],
    }) as never);

    const text = await svc.render(LAB, 'customer_identity_ask', { agentName: 'Kalia', businessName: 'X' });
    expect(text).toBe('Boleh minta nomor HP-nya kak Kalia?');
  });

  it('switching it off sends nothing rather than an empty ask', async () => {
    const svc = new NotificationRendererService(createPool({
      overrides: [{ tenantId: LAB, key: 'customer_identity_ask', body: null, enabled: false }],
    }) as never);

    expect(await svc.render(LAB, 'customer_identity_ask', { agentName: 'Kalia' })).toBeNull();
  });

  it('an unknown vertical falls back to the stock body, never to an empty message', async () => {
    const svc = new NotificationRendererService(createPool() as never);

    const text = await svc.render('tenant-unknown', 'customer_identity_ask', {
      agentName: 'Kalia', businessName: 'X',
    });
    expect(text).toBe(
      getDefinition('customer_identity_ask')!.defaultBody
        .replace(/\{agentName\}/g, 'Kalia')
        .replace(/\{businessName\}/g, 'X'),
    );
  });

  it('the membership welcome drops the plate for a services tenant too', async () => {
    const svc = new NotificationRendererService(createPool() as never);

    const lab = await svc.render(LAB, 'membership_welcome', {
      customerName: 'Budi', planName: 'Gold', endDate: '06 September 2026',
    });
    const wash = await svc.render(CARWASH, 'membership_welcome', {
      customerName: 'Budi', planName: 'Gold', endDate: '06 September 2026',
    });

    expect(lab).not.toMatch(/plat mobil/i);
    expect(wash).toMatch(/plat mobil/i);
  });

  it('the owner editor shows the same body the agent will actually send', async () => {
    // Showing the car wash's wording to the lab would reproduce the original
    // bug one layer up: the owner reads "plat kendaraannya" in the editor and
    // still cannot tell where the sent text comes from.
    const svc = new NotificationRendererService(createPool() as never);

    const rows = await svc.listForTenant(LAB);
    const row = rows.find((r) => r.key === 'customer_identity_ask');
    expect(row).toBeDefined();
    expect(row!.body).not.toMatch(/plat/i);
    expect(row!.preview).not.toMatch(/plat/i);
    expect(row!.customized).toBe(false); // it is a DEFAULT, not an override

    const sent = await svc.render(LAB, 'customer_identity_ask', {
      agentName: 'Kalia', businessName: 'PT Dinamika Kalibrasi Indonesia',
    });
    expect(sent).toBe(
      row!.body.replace(/\{agentName\}/g, 'Kalia').replace(/\{businessName\}/g, 'PT Dinamika Kalibrasi Indonesia'),
    );
  });

  it('the identity ask is in the catalogue, so it shows up in the owner editor', async () => {
    // The catalogue is what drives /dashboard/settings/notifications and the
    // tenant-facing notification document. A body inlined at a call site is
    // invisible in both — which is how "plat kendaraannya" went unexplained.
    const def = getDefinition('customer_identity_ask');
    expect(def).toBeDefined();
    expect(def!.canDisable).toBe(true);
    expect(def!.variables.map((v) => v.name)).toEqual(['agentName', 'businessName']);
  });
});
