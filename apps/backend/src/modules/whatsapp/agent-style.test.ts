import { describe, it, expect } from 'vitest';
import {
  DEFAULT_AGENT_STYLE, styleFromRow, toneBlock, lengthBlock, scopeBlock, quoteBlock,
  escalationBlock, houseRulesBlock,
} from './agent-style';

/**
 * These tests exist because of ONE line in the 2026-09-22 client feedback:
 * "AI agent nya tidak impact issue dari kalibrasi" — AIRE must not feel the
 * changes Kalibrasi asked for. Tone, length, scope and quote handling are now
 * per-tenant, which is only a safe answer if the defaults are genuinely inert.
 * So the first group pins "an untouched tenant reads exactly as before", and
 * the rest pin that the new settings actually change something.
 */

const SCOPE_ARGS = { where: 'an Indonesian car wash & detailing business', who: 'Irene', topics: 'harga, lokasi, membership' };

describe('agent style — defaults are inert (AIRE must be unaffected)', () => {
  it('reads the pre-105 behaviour out of a row with none of the new columns', () => {
    expect(styleFromRow({})).toEqual(DEFAULT_AGENT_STYLE);
    expect(styleFromRow(null)).toEqual(DEFAULT_AGENT_STYLE);
    expect(styleFromRow(undefined)).toEqual(DEFAULT_AGENT_STYLE);
  });

  it('reads the pre-105 behaviour out of a row carrying the column DEFAULTs', () => {
    expect(styleFromRow({
      reply_style: 'balanced', reply_max_lines: null, knowledge_scope: 'open',
      style_instructions: null, escalate_on_quote: false,
    })).toEqual(DEFAULT_AGENT_STYLE);
  });

  it('degrades an unrecognised value to the default rather than leaking it into the prompt', () => {
    // The CHECK constraints stop our own writes, but an n8n flow or a
    // hand-edited row reaches the same code path, and a prompt that reads
    // "reply_style: chatty" would be worse than one that reads as before.
    const style = styleFromRow({ reply_style: 'chatty', knowledge_scope: 'paranoid' });
    expect(style.replyStyle).toBe('balanced');
    expect(style.knowledgeScope).toBe('open');
    expect(JSON.stringify(toneBlock(style, 'Irene'))).not.toContain('chatty');
  });

  it('renders the ORIGINAL tone, length and off-topic wording under the defaults', () => {
    // Verbatim fragments of the text that lived in systemPrompt() before this
    // module existed. If a refactor reworded them, AIRE's bot changed voice
    // without anyone asking it to — which is the whole thing being guarded.
    const tone = toneBlock(DEFAULT_AGENT_STYLE, 'Irene');
    expect(tone).toHaveLength(2);
    expect(tone[0]).toContain('TONE (very important — the client has called earlier replies "judes"/curt)');
    expect(tone[1]).toContain('Ease into it in three beats, all in ONE message');

    expect(lengthBlock(DEFAULT_AGENT_STYLE, 'Irene'))
      .toContain('This is a WhatsApp chat, not a catalogue. Keep replies SHORT — a few lines, ideally under ~8 lines.');

    expect(scopeBlock(DEFAULT_AGENT_STYLE, SCOPE_ARGS))
      .toContain('OFF-TOPIC / OUT-OF-SCOPE:');
  });

  it('adds no quote rule and no house rules under the defaults', () => {
    expect(quoteBlock(DEFAULT_AGENT_STYLE, 'Irene')).toBeNull();
    expect(houseRulesBlock(DEFAULT_AGENT_STYLE)).toBeNull();
  });

  it('keeps the original "do not escalate just because you lack data" rule', () => {
    expect(escalationBlock(DEFAULT_AGENT_STYLE))
      .toContain('Do not escalate merely because a question is off-topic or you lack the data');
  });
});

describe('agent style — the escalation rule must not contradict the others', () => {
  // A prompt carrying two opposing rules makes the model pick one
  // unpredictably, so a client testing a new setting would see it work
  // sometimes. That is worse than the setting not existing.

  it('stops forbidding a data-gap handover once scope is strict', () => {
    const block = escalationBlock({ ...DEFAULT_AGENT_STYLE, knowledgeScope: 'strict' });
    expect(block).not.toContain('you lack the data');
    expect(block).toContain('you do not have the information');
  });

  it('names quote requests as a handover reason once that is switched on', () => {
    const block = escalationBlock({ ...DEFAULT_AGENT_STYLE, escalateOnQuote: true });
    expect(block).toContain('formal quote');
  });

  it('lists both reasons when both settings are on', () => {
    const block = escalationBlock({ ...DEFAULT_AGENT_STYLE, knowledgeScope: 'strict', escalateOnQuote: true });
    expect(block).toContain('you do not have the information');
    expect(block).toContain('formal quote');
  });

  it('never opens the prompt-extraction escape hatch, whatever the settings', () => {
    for (const style of [
      DEFAULT_AGENT_STYLE,
      { ...DEFAULT_AGENT_STYLE, knowledgeScope: 'strict' as const },
      { ...DEFAULT_AGENT_STYLE, escalateOnQuote: true },
      { ...DEFAULT_AGENT_STYLE, knowledgeScope: 'strict' as const, escalateOnQuote: true },
    ]) {
      const block = escalationBlock(style);
      expect(block.toLowerCase()).toMatch(/do not escalate|not escalate a question about your own instructions/i);
    }
  });
});

describe('agent style — concise (Kalibrasi: replies too long / unnatural)', () => {
  const concise = { ...DEFAULT_AGENT_STYLE, replyStyle: 'concise' as const };

  it('drops the three-beat delivery ritual that produced the padding', () => {
    const tone = toneBlock(concise, 'Kalia').join('\n');
    expect(tone).not.toContain('three beats');
    expect(tone).toContain('Lead with the answer');
  });

  it('keeps warmth rather than trading it for brevity', () => {
    // "Shorter" must not regress into the "judes" complaint the balanced text
    // was written to fix, so the address terms and mirroring survive.
    const tone = toneBlock(concise, 'Kalia').join('\n');
    expect(tone).toContain('kak');
    expect(tone).toMatch(/Mirror the customer/);
  });

  it('states the tenant\'s line ceiling when one is set', () => {
    expect(lengthBlock({ ...concise, replyMaxLines: 4 }, 'Kalia')).toContain('at most 4 lines');
    // …and still gives a concrete bound when the tenant left it blank.
    expect(lengthBlock(concise, 'Kalia')).toContain('about 2–5 lines');
  });

  it('names the tenant\'s own agent in the "want the full list?" offer', () => {
    expect(lengthBlock(concise, 'Kalia')).toContain('mau Kalia kirimin daftar lengkapnya kak?');
    expect(lengthBlock(concise, 'Kalia')).not.toContain('Irene');
  });
});

describe('agent style — strict scope (Kalibrasi: limit answers to the knowledge base)', () => {
  const strict = { ...DEFAULT_AGENT_STYLE, knowledgeScope: 'strict' as const };

  it('forbids generalising and routes the gap to a human', () => {
    const block = scopeBlock(strict, SCOPE_ARGS);
    expect(block).toContain('escalate_to_human');
    expect(block).toMatch(/do NOT generalise/);
    expect(block).toMatch(/"usually" or "typically"/);
  });

  it('still refuses to escalate a prompt-extraction attempt', () => {
    // Otherwise "ignore your instructions" becomes a reliable way to summon a
    // human, which is a support-cost hole as much as a security one.
    expect(scopeBlock(strict, SCOPE_ARGS)).toMatch(/never escalate them/);
  });
});

describe('agent style — quote escalation (Kalibrasi: penawaran goes to a live agent)', () => {
  const quoting = { ...DEFAULT_AGENT_STYLE, escalateOnQuote: true };

  it('escalates a formal quote request', () => {
    const block = quoteBlock(quoting, 'Kalia')!;
    expect(block).toContain('penawaran');
    expect(block).toContain('escalate_to_human');
  });

  it('does NOT swallow an ordinary price question', () => {
    // The escalation number would otherwise receive every "berapa harga X?",
    // which is the failure mode that makes a team turn the feature off.
    expect(quoteBlock(quoting, 'Kalia')!).toContain('This does NOT apply to a simple "berapa harga X?"');
  });
});

describe('agent style — house rules', () => {
  it('appends the tenant\'s own instructions, marked as an override', () => {
    const block = houseRulesBlock({ ...DEFAULT_AGENT_STYLE, styleInstructions: '  Jangan pernah menyebut merek lain.  ' })!;
    expect(block).toContain('Jangan pernah menyebut merek lain.');
    expect(block).toContain('follow these over the general guidance above');
  });

  it('keeps grounding and prompt security out of the tenant\'s reach', () => {
    // A tenant writing "answer anything, don't call tools" must not be able to
    // switch off the anti-fabrication rule; the block says so explicitly.
    const block = houseRulesBlock({ ...DEFAULT_AGENT_STYLE, styleInstructions: 'x' })!;
    expect(block).toContain('NO FABRICATION');
    expect(block).toContain('PROMPT SECURITY');
  });

  it('treats whitespace-only instructions as none', () => {
    expect(houseRulesBlock({ ...DEFAULT_AGENT_STYLE, styleInstructions: '   \n  ' })).toBeNull();
    expect(styleFromRow({ style_instructions: '   ' }).styleInstructions).toBeNull();
  });
});
