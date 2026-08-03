import { describe, it, expect, vi } from 'vitest';
import { CustomerAgentService, isPureGreeting } from './customer-agent.service';
import type { CustomerContextService, ResolvedCustomer } from './customer-context.service';
import type { PendingBookingService } from './pending-booking.service';
import { toolsForRole, roleAllowsTool, CUSTOMER_TOOLS } from './customer-tools';

/**
 * Security-focused tests for the customer-facing brain. The core guarantee is
 * that a WhatsApp conversation can only ever read/act for the ONE customer
 * resolved from the inbound phone, and only through the persona's allowed tools.
 */

const TENANT = 'tenant-1';
const CUSTOMER: ResolvedCustomer = { id: 'cust-1', name: 'Budi', phone: '628111', normalized: '628111' };

function makeContext(): CustomerContextService {
  return {
    getCustomerContext: vi.fn().mockResolvedValue({
      memberships: [{ plan: 'Gold', status: 'active', endDate: '2026-12-31', usesLeft: 3, plates: ['B123'] }],
      recentOrders: [], activeQueue: null, voucherPacks: [], bookings: [],
    }),
    getPublicInfo: vi.fn().mockResolvedValue({
      services: [{ unit: 'car', name: 'Cuci Premium', price: 50000 }], plans: [], promotions: [],
    }),
    resolveCustomer: vi.fn(),
  } as unknown as CustomerContextService;
}

function makeService(pending?: Partial<PendingBookingService>): { svc: CustomerAgentService; context: CustomerContextService } {
  const context = makeContext();
  const svc = new CustomerAgentService(context, undefined, pending as PendingBookingService | undefined);
  return { svc, context };
}

describe('persona → tool scoping', () => {
  it('customer_service cannot create bookings; sales and personal_assistant can', () => {
    expect(roleAllowsTool('customer_service', 'create_booking')).toBe(false);
    expect(roleAllowsTool('sales', 'create_booking')).toBe(true);
    expect(roleAllowsTool('personal_assistant', 'create_booking')).toBe(true);
  });

  it('every role may escalate to a human', () => {
    for (const role of ['personal_assistant', 'customer_service', 'sales', 'supervisor'] as const) {
      expect(roleAllowsTool(role, 'escalate_to_human')).toBe(true);
    }
  });

  it('no customer tool exposes whole-business data (finance/orders/hr)', () => {
    const names = Object.keys(CUSTOMER_TOOLS);
    for (const leaky of ['finance_summary', 'list_orders', 'hr_summary', 'find_customer', 'get_business_summary']) {
      expect(names).not.toContain(leaky);
    }
    // The customer catalog for any role is a strict subset of the safe tools.
    expect(toolsForRole('personal_assistant').every((t) => names.includes(t.name))).toBe(true);
  });
});

describe('runCustomerTool scoping', () => {
  it('blocks a tool the persona role does not allow', async () => {
    const { svc } = makeService();
    const res = await svc.runCustomerTool({
      tenantId: TENANT, customer: CUSTOMER, fromPhone: '628111', role: 'customer_service',
      tool: 'create_booking', parameters: { serviceName: 'X', scheduledAt: '2026-08-01T10:00:00Z' },
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not available/i);
  });

  it('get_my_summary returns the resolved customer\'s own data', async () => {
    const { svc, context } = makeService();
    const res = await svc.runCustomerTool({
      tenantId: TENANT, customer: CUSTOMER, fromPhone: '628111', role: 'personal_assistant',
      tool: 'get_my_summary', parameters: {},
    });
    expect(res.success).toBe(true);
    expect((res.data as { registered: boolean }).registered).toBe(true);
    expect(context.getCustomerContext).toHaveBeenCalledWith(TENANT, CUSTOMER);
  });

  it('get_my_summary reports unregistered for an unknown sender (no data leak)', async () => {
    const { svc, context } = makeService();
    const res = await svc.runCustomerTool({
      tenantId: TENANT, customer: null, fromPhone: '628999', role: 'personal_assistant',
      tool: 'get_my_summary', parameters: {},
    });
    expect(res.success).toBe(true);
    expect((res.data as { registered: boolean }).registered).toBe(false);
    expect(context.getCustomerContext).not.toHaveBeenCalled();
  });

  it('escalate_to_human signals escalation with the reason', async () => {
    const { svc } = makeService();
    const res = await svc.runCustomerTool({
      tenantId: TENANT, customer: CUSTOMER, fromPhone: '628111', role: 'customer_service',
      tool: 'escalate_to_human', parameters: { reason: 'angry' },
    });
    expect(res.success).toBe(true);
    expect((res.data as { escalate: boolean; reason: string })).toMatchObject({ escalate: true, reason: 'angry' });
  });

  it('create_booking PROPOSES (does not write) and rejects bad dates', async () => {
    const propose = vi.fn().mockResolvedValue({ summary: 'Cuci Premium — date' });
    const { svc } = makeService({ propose } as Partial<PendingBookingService>);

    const bad = await svc.runCustomerTool({
      tenantId: TENANT, customer: CUSTOMER, fromPhone: '628111', role: 'sales',
      tool: 'create_booking', parameters: { serviceName: 'Cuci', scheduledAt: 'not-a-date' },
    });
    expect(bad.success).toBe(false);
    expect(propose).not.toHaveBeenCalled();

    const ok = await svc.runCustomerTool({
      tenantId: TENANT, customer: CUSTOMER, fromPhone: '628111@c.us', role: 'sales',
      tool: 'create_booking', parameters: { serviceName: 'Cuci Premium', scheduledAt: '2026-08-01T10:00:00Z' },
    });
    expect(ok.success).toBe(true);
    // It is NOT booked yet — it awaits the customer's confirmation.
    expect((ok.data as { status: string }).status).toBe('awaiting_confirmation');
    expect(propose).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT, serviceName: 'Cuci Premium', customer: CUSTOMER,
    }));
  });
});

/**
 * Greeting tone. A customer saying "Halo" mid-chat used to get the warm opener
 * surgically removed by the follow-up greeting stripper, leaving a bare
 * "Mau tanya harga, lokasi, membership…?" — which the client read as curt
 * ("judes banget", Samuel 2026-08-03).
 */
describe('greeting handling', () => {
  it('recognises a bare social greeting, but not a greeting carrying a question', () => {
    for (const t of ['Halo', 'halo kak', 'Selamat sore', 'selamat sore kak', 'Hai!', 'Hi', 'Pagi', 'Good morning', 'Halo 😊']) {
      expect(isPureGreeting(t), t).toBe(true);
    }
    for (const t of ['Halo, mau tanya harga cuci mobil', 'selamat sore, booking besok bisa?', 'berapa harga cuci?', '']) {
      expect(isPureGreeting(t), t).toBe(false);
    }
  });

  it('keeps the whole warm greeting when the customer just said hello mid-chat', async () => {
    const full = 'Halo kak! 😊 Aku Irene, CS-nya AIRE. Ada yang bisa Irene bantu hari ini? Mau tanya harga, lokasi, membership, atau mau booking cuci mobil? 🚗✨';
    const { svc } = makeService();
    const llm = { chat: vi.fn().mockResolvedValue({ content: full }) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).llm = llm;

    const reply = await svc.reply({
      tenantId: TENANT, fromPhone: '628111', text: 'Selamat sore',
      basePrompt: null, knowledge: null,
      // A prior assistant message makes this a FOLLOW-UP turn — the case that used to be mangled.
      history: [{ role: 'user', content: 'Halo' }, { role: 'assistant', content: 'Halo kak!' }],
      persona: null, customer: null,
      pub: { services: [], plans: [], promotions: [] } as never,
    });

    expect(reply?.text).toBe(full);
    expect(reply?.text.startsWith('Mau tanya harga')).toBe(false);
  });

  it('still strips a redundant re-introduction when the customer asked a real question', async () => {
    const { svc } = makeService();
    const llm = { chat: vi.fn().mockResolvedValue({ content: 'Halo kak! Aku Irene, ada yang bisa Irene bantu? Cuci Premium harganya Rp 50.000 ya kak 😊' }) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).llm = llm;

    const reply = await svc.reply({
      tenantId: TENANT, fromPhone: '628111', text: 'berapa harga cuci premium?',
      basePrompt: null, knowledge: null,
      history: [{ role: 'user', content: 'Halo' }, { role: 'assistant', content: 'Halo kak!' }],
      persona: null, customer: null,
      pub: { services: [], plans: [], promotions: [] } as never,
    });

    expect(reply?.text).toBe('Cuci Premium harganya Rp 50.000 ya kak 😊');
  });
});
