import { describe, it, expect, vi } from 'vitest';
import { CustomerAgentService, promisesHandover } from './customer-agent.service';
import { AgentRuntimeService } from './agent-runtime.service';
import { CustomerContextService, type PublicInfo } from './customer-context.service';
import type { LLMRouterService } from '../agent/llm-router.service';
import type { SettingsService } from '../settings/settings.service';
import type { TenantFeaturesService } from '../../common/tenant-features';
import { resolveCapabilities } from '@aire/shared';

/**
 * "Service prices" switched OFF for the AI must hand the customer to a person.
 *
 * Kalibrasi, 2026-09-30: the toggle was off, get_service_prices returned an
 * empty list indistinguishable from "no match", and every price question ended
 * in the canned "kurang nangkep maksudnya" line — then, on the retry, in the
 * repeat guard's escalation. The handover must not depend on the model reading
 * an empty list correctly, so these pin it as deterministic.
 */

const PUB: PublicInfo = { services: [], plans: [], promotions: [] };

function contextWith(hidden: boolean): CustomerContextService {
  return {
    getPublicInfo: vi.fn(async () => ({ ...PUB, pricesHidden: hidden })),
    searchServices: vi.fn(async () => hidden
      ? { services: [], totalMatches: 0, truncated: false, hidden: true }
      : {
          services: [{ unit: 'KAL', name: 'Digital Multimeter', description: '3.5 Digit', price: 750000, priceText: 'Rp 750.000' }],
          totalMatches: 1, truncated: false, hidden: false,
        }),
    getCustomerContext: vi.fn(async () => null),
  } as unknown as CustomerContextService;
}

/** A model that asks for prices, then answers with whatever `after` says. */
function llmCallingPrices(after: string[]): LLMRouterService {
  const turns = ['{"action":"tool","tool":"get_service_prices","parameters":{"query":"multimeter"}}', ...after];
  let i = 0;
  return { chat: vi.fn(async () => ({ content: turns[Math.min(i++, turns.length - 1)] })) } as unknown as LLMRouterService;
}

async function ask(context: CustomerContextService, llm: LLMRouterService) {
  const svc = new CustomerAgentService(context, llm);
  return svc.reply({
    tenantId: 'tenant-kalibrasi',
    fromPhone: '628123456789',
    text: 'berapa harga kalibrasi multimeter?',
    basePrompt: null,
    knowledge: null,
    history: [],
    persona: { name: 'Kalia', role: 'customer_service', prompt: null },
    customer: null,
    pub: PUB,
    business: { name: 'Kalibrasi Indonesia', vertical: 'services' },
  });
}

describe('prices hidden → escalate to a human', () => {
  it('the price tool escalates even when the model never calls escalate_to_human', async () => {
    const reply = await ask(contextWith(true), llmCallingPrices(['{"action":"final","message":"Nanti tim kami kabari ya kak"}']));
    expect(reply?.escalate).toBe(true);
  });

  it('still escalates when the model then falls apart into the canned fallback', async () => {
    // Two unusable turns after the tool call → runToolLoop's fallbackReply.
    const reply = await ask(contextWith(true), llmCallingPrices(['', '']));
    expect(reply?.text).toContain('kurang nangkep');
    expect(reply?.escalate).toBe(true);
  });

  it('never tells the model prices exist when they are hidden', async () => {
    const llm = llmCallingPrices(['{"action":"final","message":"ok"}']);
    await ask(contextWith(true), llm);
    const second = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[1]![1] as { content: string }[];
    const toolResult = second[second.length - 1]!.content;
    expect(toolResult).toContain('"pricesShared":false');
    expect(toolResult).not.toContain('Rp');
  });

  it('prices shown → answers normally, no escalation, no internal flag leaked', async () => {
    const llm = llmCallingPrices(['{"action":"final","message":"Digital Multimeter 3.5 Digit Rp 750.000 kak"}']);
    const reply = await ask(contextWith(false), llm);
    expect(reply?.escalate).toBe(false);
    expect(reply?.text).toContain('Rp 750.000');
    const second = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[1]![1] as { content: string }[];
    expect(second[second.length - 1]!.content).not.toContain('hidden');
  });
});

describe('searchServices relaxed fallback', () => {
  // Live 2026-09-30: the model searched "multimeter kalibrasi"; the strict AND
  // matched nothing because no multimeter row's name says "kalibrasi".
  const CATALOG = [
    { name: 'Digital Multimeter', description: '3.5 Digit', business_unit: 'KAL', price: '750000' },
    { name: 'Analog Multimeter', description: null, business_unit: 'KAL', price: '750000' },
    { name: 'Kalibrasi Oven', description: 'Suhu', business_unit: 'KAL', price: '2500000' },
    { name: 'Kalibrasi Timbangan', description: null, business_unit: 'KAL', price: '500000' },
    { name: 'Kalibrasi Termometer', description: null, business_unit: 'KAL', price: '400000' },
  ];
  function svc() {
    const pool = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (/customer_knowledge/.test(sql)) return { rows: [{ customer_knowledge: {} }] };
        const terms = (params as string[]).slice(1).map((p) => p.replace(/%/g, ''));
        const hay = (r: typeof CATALOG[number]) => `${r.name} ${r.description ?? ''} ${r.business_unit}`.toLowerCase();
        const rows = CATALOG.filter((r) => terms.every((t) => hay(r).includes(t)));
        return { rows: rows.map((r) => ({ ...r, total: rows.length })) };
      }),
    };
    return new CustomerContextService(pool as never);
  }

  it('never answers an unlisted item with rows that only matched a generic word', async () => {
    // "kalibrasi" hits three rows here; none of them is a scale.
    const r = await svc().searchServices('t', null, 'harga kalibrasi timbangan digital');
    expect(r.totalMatches).toBe(0);
  });

  it('a row that really contains the generic word is still found by the strict pass', async () => {
    const r = await svc().searchServices('t', null, 'kalibrasi oven');
    expect(r.services.map((s) => s.name)).toEqual(['Kalibrasi Oven']);
  });

  it('a filler word no longer zeroes the search — the specific word wins', async () => {
    const r = await svc().searchServices('t', null, 'multimeter kalibrasi');
    expect(r.services.map((s) => s.name)).toEqual(['Digital Multimeter', 'Analog Multimeter']);
    expect(r.services[0]!.priceText).toBe('Rp 750.000');
  });

  it('strict matches are unchanged when they exist', async () => {
    const r = await svc().searchServices('t', null, 'digital multimeter');
    expect(r.services.map((s) => s.name)).toEqual(['Digital Multimeter']);
  });

  it('nothing matching any word still returns nothing', async () => {
    const r = await svc().searchServices('t', null, 'fluke 435');
    expect(r.totalMatches).toBe(0);
  });
});

describe('a reply that promises a handover escalates', () => {
  it.each([
    'Untuk price list, biar Kalia sambungkan ke tim kami dulu ya — nanti langsung dibantu 🙏',
    'Baik kak, ini kami teruskan dulu ke tim biar dibantu lebih lanjut ya',
    'Biar Kalia hubungkan ke tim teknis dulu ya?',
  ])('detects: %s', (t) => expect(promisesHandover(t)).toBe(true));

  it.each([
    'Digital Multimeter 3.5 Digit Rp 750.000 kak. Mau Kalia bantu jadwalkan?',
    'Silakan hubungi tim kami di 021-555 kak',
    'Mau Kalia hubungkan sekarang?',
    // Live misfires after deploy: a full price answer plus an upsell line.
    '*Digital Multimeter 3.5 Digit:* Rp 750.000\n\nUntuk penawaran resmi, lama pengerjaan, dan penjemputan alat, saya perlu sambungkan ke tim kami ya. Mau saya hubungi mereka? 🙏',
    '*Analog Multimeter*: Rp 750.000\n\nUntuk penawaran resmi atau jumlah banyak, Kalia sambungkan ke tim kami ya? 🙏',
  ])('ignores: %s', (t) => expect(promisesHandover(t)).toBe(false));

  it('the model saying it hands over, without calling the tool, still escalates', async () => {
    const llm = { chat: vi.fn(async () => ({ content: '{"action":"final","message":"Siap kak, biar Kalia sambungkan ke tim kami ya 🙏"}' })) } as unknown as LLMRouterService;
    const reply = await ask(contextWith(false), llm);
    expect(reply?.escalate).toBe(true);
  });
});

describe('rigid templates (LLM off) with prices hidden', () => {
  function runtime(hidden: boolean) {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (/FROM agents/i.test(sql)) return { rows: [{ name: 'Kalia', role: 'customer_service', prompt: null }] };
        if (/FROM tenants/i.test(sql)) return { rows: [{ name: 'Kalibrasi' }] };
        return { rows: [] };
      }),
    };
    const context = {
      resolveCustomer: vi.fn(async () => null),
      getCustomerContext: vi.fn(async () => null),
      getPublicInfo: vi.fn(async () => ({ ...PUB, pricesHidden: hidden })),
    } as unknown as CustomerContextService;
    const settings = { get: vi.fn(async () => null) } as unknown as SettingsService;
    const features = {
      getProfile: vi.fn(async () => ({ vertical: 'services', capabilities: resolveCapabilities('services', null) })),
    } as unknown as TenantFeaturesService;
    return new AgentRuntimeService(pool as never, context, settings, features);
  }

  const gen = (rt: AgentRuntimeService) =>
    rt.generate({ tenantId: 't', fromPhone: '628123', text: 'harga kalibrasi berapa?', basePrompt: null, knowledge: null, history: [] });

  it('escalates instead of promising a price list', async () => {
    const r = await gen(runtime(true));
    expect(r.escalate).toBe(true);
  });

  it('unchanged when prices are simply not loaded yet', async () => {
    const r = await gen(runtime(false));
    expect(r.escalate).toBe(false);
    expect(r.text).toContain('Daftar harganya');
  });
});
