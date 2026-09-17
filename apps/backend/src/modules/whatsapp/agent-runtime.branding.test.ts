import { describe, it, expect, vi } from 'vitest';
import { AgentRuntimeService } from './agent-runtime.service';
import type { CustomerContextService } from './customer-context.service';
import type { SettingsService } from '../settings/settings.service';
import type { TenantFeaturesService } from '../../common/tenant-features';
import { resolveCapabilities } from '@aire/shared';

/**
 * The WhatsApp bot must speak for THE TENANT, not for the founding tenant.
 *
 * Every deterministic ("rigid") reply used to be a literal: "Aku Irene, CS-nya
 * Aire", "booking cuci mobil", a car emoji. Those templates are what a customer
 * sees whenever the LLM is off or errored — so a second company onboarded onto
 * the chatbot would have introduced itself as Airin's car wash, by name, to its
 * own customers. These tests pin the fix.
 */

const EMPTY_CTX = {
  memberships: [], recentOrders: [], activeQueue: null, voucherPacks: [], bookings: [],
};

function buildRuntime(opts: {
  tenantName: string;
  vertical: 'carwash' | 'services' | 'fnb' | 'laundry';
  agentName: string;
}) {
  // Two SELECTs matter here: the agent row (persona) and the tenant name.
  const pool = {
    query: vi.fn(async (sql: string) => {
      if (/FROM agents/i.test(sql)) {
        return { rows: [{ name: opts.agentName, role: 'customer_service', prompt: null }] };
      }
      if (/FROM tenants/i.test(sql)) return { rows: [{ name: opts.tenantName }] };
      return { rows: [] };
    }),
  };

  const context = {
    resolveCustomer: vi.fn(async () => null),
    getCustomerContext: vi.fn(async () => EMPTY_CTX),
    // No services/plans configured, so every intent lands on its "nothing yet"
    // branch — the branch most likely to contain hardcoded filler copy.
    getPublicInfo: vi.fn(async () => ({ services: [], plans: [], promos: [], branches: [] })),
  } as unknown as CustomerContextService;

  const settings = { get: vi.fn(async () => null) } as unknown as SettingsService;

  const features = {
    getProfile: vi.fn(async () => ({
      vertical: opts.vertical,
      capabilities: resolveCapabilities(opts.vertical, null),
    })),
  } as unknown as TenantFeaturesService;

  // customerAgent omitted → the fluid path is skipped and rigid templates run,
  // which is exactly what we want to inspect.
  return new AgentRuntimeService(pool as never, context, settings, features);
}

const KALIBRASI = { tenantName: 'Kalibrasi', vertical: 'services' as const, agentName: 'Kalia' };

async function replyTo(runtime: AgentRuntimeService, text: string) {
  const res = await runtime.generate({
    tenantId: 't-2', fromPhone: '628111', text,
    basePrompt: null, knowledge: null, history: [],
  });
  return res.text;
}

describe('rigid WhatsApp replies carry the tenant’s own identity', () => {
  const INTENTS = [
    ['greeting', 'halo'],
    ['price', 'berapa harga'],
    ['membership', 'membership'],
    ['voucher', 'voucher'],
    ['booking', 'mau booking'],
    ['status', 'status pesanan saya'],
    ['unknown', 'zzz qqq'],
  ] as const;

  it.each(INTENTS)('never leaks the founding tenant’s brand on a %s', async (_intent, text) => {
    const reply = await replyTo(buildRuntime(KALIBRASI), text);
    // The three things that would tell a Kalibrasi customer they reached the
    // wrong company.
    expect(reply).not.toMatch(/Irene/i);
    expect(reply).not.toMatch(/\bAire\b/i);
    expect(reply).not.toMatch(/cuci mobil/i);
  });

  it.each(INTENTS)('uses the tenant’s own agent name on a %s', async (_intent, text) => {
    const reply = await replyTo(buildRuntime(KALIBRASI), text);
    // 'status' can answer with a pure order-status sentence that names nobody;
    // every other intent should say who is speaking.
    if (_intent !== 'status') expect(reply).toMatch(/Kalia/);
  });

  it('introduces itself with the tenant’s business name', async () => {
    const reply = await replyTo(buildRuntime(KALIBRASI), 'halo');
    expect(reply).toContain('Kalia');
    expect(reply).toContain('Kalibrasi');
  });

  it('still says the car-wash wording for an actual car wash', async () => {
    // The de-branding must not flatten the founding tenant's voice: Airin's own
    // customers should still be offered a "cuci mobil".
    const reply = await replyTo(
      buildRuntime({ tenantName: 'Airin', vertical: 'carwash', agentName: 'Irene' }),
      'halo',
    );
    expect(reply).toContain('Irene');
    expect(reply).toContain('Airin');
    expect(reply).toMatch(/cuci mobil/i);
  });

  it('offers laundry, not a car wash, to a laundry tenant', async () => {
    const reply = await replyTo(
      buildRuntime({ tenantName: 'Laundry Qta', vertical: 'laundry', agentName: 'Qta' }),
      'halo',
    );
    expect(reply).toMatch(/laundry/i);
    expect(reply).not.toMatch(/cuci mobil/i);
  });

  it('falls back to a neutral name rather than a brand when no agent is configured', async () => {
    const pool = { query: vi.fn(async (sql: string) =>
      /FROM tenants/i.test(sql) ? { rows: [{ name: 'Mimi Chicken' }] } : { rows: [] }) };
    const runtime = new AgentRuntimeService(
      pool as never,
      { resolveCustomer: vi.fn(async () => null),
        getCustomerContext: vi.fn(async () => EMPTY_CTX),
        getPublicInfo: vi.fn(async () => ({ services: [], plans: [], promos: [], branches: [] })),
      } as unknown as CustomerContextService,
      { get: vi.fn(async () => null) } as unknown as SettingsService,
      { getProfile: vi.fn(async () => ({ vertical: 'fnb', capabilities: resolveCapabilities('fnb', null) })) } as unknown as TenantFeaturesService,
    );
    const reply = await replyTo(runtime, 'halo');
    expect(reply).not.toMatch(/Irene/i);
    expect(reply).toContain('Mimi Chicken');
  });
});
