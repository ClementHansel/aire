import { describe, it, expect, vi } from 'vitest';
import { CustomerAgentService } from './customer-agent.service';
import type { CustomerContextService, PublicInfo } from './customer-context.service';
import type { LLMRouterService } from '../agent/llm-router.service';
import { DEFAULT_AGENT_STYLE, type AgentStyle } from './agent-style';

/**
 * END-TO-END wiring for the Kalibrasi reply fixes.
 *
 * agent-style.test.ts proves each BLOCK renders the right words. That is not
 * the same claim as "the words reach the model": the blocks could be perfect
 * and the style could still be dropped on the way through reply() →
 * systemPrompt(). This drives the real service with a fake LLM and inspects the
 * actual system message, which is the only artifact that decides how the bot
 * behaves.
 */

const PUB: PublicInfo = { services: [], plans: [], promotions: [] };

/** Run one turn and hand back the system prompt the model was actually given. */
async function systemPromptFor(style: AgentStyle | null, personaName = 'Kalia'): Promise<string> {
  let captured = '';
  // Signature is llm.chat(tenantId, messages, opts) — see runToolLoop.
  const llm = {
    chat: vi.fn(async (_tenantId: string, messages: { role: string; content: string }[]) => {
      captured = messages.find((m) => m.role === 'system')?.content ?? '';
      return { content: 'oke kak' };
    }),
  } as unknown as LLMRouterService;

  const context = {
    getPublicInfo: vi.fn(async () => PUB),
    searchServices: vi.fn(async () => ({ services: [], totalMatches: 0, truncated: false })),
    getCustomerContext: vi.fn(async () => null),
  } as unknown as CustomerContextService;

  const svc = new CustomerAgentService(context, llm);
  await svc.reply({
    tenantId: 'tenant-kalibrasi',
    fromPhone: '628123456789',
    text: 'berapa harga kalibrasi multimeter?',
    basePrompt: null,
    knowledge: null,
    history: [],
    persona: { name: personaName, role: 'customer_service', prompt: null },
    customer: null,
    pub: PUB,
    business: { name: 'PT Dinamika Kalibrasi Indonesia', vertical: 'services' },
    style,
  });
  return captured;
}

describe('Kalibrasi settings reach the actual system prompt', () => {
  it('applies concise length + the tenant line cap', async () => {
    const prompt = await systemPromptFor({
      ...DEFAULT_AGENT_STYLE, replyStyle: 'concise', replyMaxLines: 5,
    });
    expect(prompt).toContain('at most 5 lines');
    expect(prompt).toContain('Lead with the answer');
    // The verbose delivery ritual must be GONE, not merely accompanied.
    expect(prompt).not.toContain('Ease into it in three beats');
  });

  it('applies the strict knowledge boundary', async () => {
    const prompt = await systemPromptFor({ ...DEFAULT_AGENT_STYLE, knowledgeScope: 'strict' });
    expect(prompt).toContain('SCOPE (critical');
    expect(prompt).toContain('do NOT generalise');
    // …and the contradicting "never escalate for a data gap" line is gone.
    expect(prompt).not.toContain('Do not escalate merely because a question is off-topic or you lack the data');
  });

  it('applies quote escalation', async () => {
    const prompt = await systemPromptFor({ ...DEFAULT_AGENT_STYLE, escalateOnQuote: true });
    expect(prompt).toContain('QUOTE REQUESTS GO TO A HUMAN');
    expect(prompt).toContain('penawaran');
  });

  it('appends the tenant\'s own extra instructions', async () => {
    const prompt = await systemPromptFor({
      ...DEFAULT_AGENT_STYLE, styleInstructions: 'Selalu sebut sertifikat terakreditasi KAN.',
    });
    expect(prompt).toContain('Selalu sebut sertifikat terakreditasi KAN.');
    expect(prompt).toContain('ADDITIONAL INSTRUCTIONS FROM THIS BUSINESS');
  });

  it('applies all four together without them cancelling out', async () => {
    // The configuration Kalibrasi is actually meant to run.
    const prompt = await systemPromptFor({
      replyStyle: 'concise',
      replyMaxLines: 5,
      knowledgeScope: 'strict',
      escalateOnQuote: true,
      styleInstructions: 'Jangan pernah menjanjikan lead time.',
    });
    expect(prompt).toContain('at most 5 lines');
    expect(prompt).toContain('SCOPE (critical');
    expect(prompt).toContain('QUOTE REQUESTS GO TO A HUMAN');
    expect(prompt).toContain('Jangan pernah menjanjikan lead time.');
    // Both new escalation reasons are named in ONE rule, not two fighting ones.
    expect(prompt).toContain('you do not have the information');
    expect(prompt).toContain('formal quote');
  });
});

describe('AIRE is untouched when it sets nothing (the other half of the ask)', () => {
  it('produces the pre-105 wording whether style is absent or the defaults', async () => {
    const [omitted, explicit] = await Promise.all([
      systemPromptFor(null),
      systemPromptFor(DEFAULT_AGENT_STYLE),
    ]);
    // Same prompt either way — a tenant with no row and a tenant carrying the
    // column DEFAULTs must be indistinguishable.
    expect(omitted).toBe(explicit);

    expect(omitted).toContain('TONE (very important — the client has called earlier replies "judes"/curt)');
    expect(omitted).toContain('Ease into it in three beats');
    expect(omitted).toContain('a few lines, ideally under ~8 lines');
    expect(omitted).toContain('OFF-TOPIC / OUT-OF-SCOPE:');
    expect(omitted).toContain('Do not escalate merely because a question is off-topic or you lack the data');
    // And none of Kalibrasi's settings leak in.
    expect(omitted).not.toContain('QUOTE REQUESTS GO TO A HUMAN');
    expect(omitted).not.toContain('SCOPE (critical');
    expect(omitted).not.toContain('ADDITIONAL INSTRUCTIONS FROM THIS BUSINESS');
  });
});

describe('a persona name that is really a sentence (live Kalibrasi data)', () => {
  // agents.name held "Halo kak! Aku Kalia, CS-nya Kalibrasi.com", and the prompt
  // pastes that field into every example sentence. The model copies examples,
  // so this alone produced the garbled replies the client reported.
  const BAD = 'Halo kak! Aku Kalia, CS-nya Kalibrasi.com';

  it('never pastes the whole sentence into the prompt', async () => {
    const prompt = await systemPromptFor(DEFAULT_AGENT_STYLE, BAD);
    expect(prompt).not.toContain('Aku Halo kak!');
    expect(prompt).not.toContain(BAD);
  });

  it('uses the real name in the identity line and the examples', async () => {
    const prompt = await systemPromptFor(DEFAULT_AGENT_STYLE, BAD);
    expect(prompt).toContain('You are Kalia, a customer service for');
    expect(prompt).toContain('Aku Kalia, CS-nya PT Dinamika Kalibrasi Indonesia');
  });

  it('still works for a tenant whose name field is correct', async () => {
    const prompt = await systemPromptFor(DEFAULT_AGENT_STYLE, 'Kalia');
    expect(prompt).toContain('You are Kalia, a customer service for');
  });
});

describe('money reaches the model pre-formatted', () => {
  it('tells the model to copy priceText rather than format a number', async () => {
    const prompt = await systemPromptFor(DEFAULT_AGENT_STYLE);
    expect(prompt).toContain('priceText');
    expect(prompt).toContain('character for character');
    // And forbids the arithmetic that invents an unquotable figure.
    expect(prompt).toContain('Do NOT do arithmetic on prices');
  });

  it('hands the price tool a formatted string for every row', async () => {
    // The tool's OWN output, not the prompt: this is what the model copies.
    const context = {
      searchServices: vi.fn(async () => ({
        services: [
          { unit: 'KAL', name: 'Digital Multimeter', description: '3.5 Digit', price: 750000, priceText: 'Rp 750.000' },
          { unit: 'KAL', name: 'Geotech Biogas 5000', description: 'Kalibrasi 4 Gas', price: 22400000, priceText: 'Rp 22.400.000' },
        ],
        totalMatches: 2,
        truncated: false,
      })),
    } as unknown as CustomerContextService;
    const svc = new CustomerAgentService(context);

    const result = await svc.runCustomerTool({
      tenantId: 'tenant-kalibrasi', customer: null, fromPhone: '628',
      role: 'customer_service', tool: 'get_service_prices', parameters: { query: 'multimeter' },
    });

    expect(result.success).toBe(true);
    const services = (result.data as { services: { priceText: string }[] }).services;
    expect(services.map((s) => s.priceText)).toEqual(['Rp 750.000', 'Rp 22.400.000']);
  });
});
