import { describe, it, expect, vi } from 'vitest';
import { runToolLoop, parseAction, renderToolCatalog } from './tool-loop';
import type { LLMRouterService } from './llm-router.service';

/** A scripted LLM that returns queued responses in order. */
function scriptedLlm(responses: string[]): LLMRouterService {
  let i = 0;
  return {
    chat: vi.fn(async () => {
      const content = responses[Math.min(i, responses.length - 1)];
      i++;
      return { content, model: 'test' };
    }),
  } as unknown as LLMRouterService;
}

/** Same, but every turn is flagged as cut off at max_tokens. */
function truncatedLlm(responses: string[]): LLMRouterService {
  let i = 0;
  return {
    chat: vi.fn(async () => {
      const content = responses[Math.min(i, responses.length - 1)];
      i++;
      return { content, model: 'test', truncated: true };
    }),
  } as unknown as LLMRouterService;
}

/** The untagged chain-of-thought a customer received on 2026-08-07 (abridged). */
const SCRATCHPAD = [
  'Okay, let me try to figure out how to respond here. The user asked where the AIRE branches are.',
  'I just got the tool result with all the branch info. Now I need to present that in a friendly way',
  'without listing everything dryly. First, I should acknowledge their question warmly.',
  'Wait, the business knowledge says AIRE serves Jabodetabek and Surabaya, but the tool result also',
  'includes two outlets in Jakarta. Should I include those? Let me check the guidelines again.',
].join(' ');

describe('parseAction', () => {
  it('parses a fenced tool call', () => {
    const a = parseAction('```json\n{"action":"tool","tool":"get_x","parameters":{"a":1}}\n```');
    expect(a.kind).toBe('tool');
    expect(a.tool).toBe('get_x');
    expect(a.parameters).toEqual({ a: 1 });
  });
  it('parses a final answer', () => {
    expect(parseAction('{"action":"final","message":"hello"}')).toMatchObject({ kind: 'final', message: 'hello' });
  });
  it('treats non-JSON as a plain final answer', () => {
    expect(parseAction('just text')).toMatchObject({ kind: 'final', message: 'just text' });
  });
  it('takes the FIRST tool call when the model emits several at once (no JSON leak)', () => {
    const a = parseAction(
      '{"action":"tool","tool":"get_my_summary","parameters":{}}\n{"action":"tool","tool":"get_my_vouchers","parameters":{}}',
    );
    expect(a.kind).toBe('tool');
    expect(a.tool).toBe('get_my_summary');
  });
  it('flags unparseable protocol JSON (no leak, no silent final)', () => {
    const a = parseAction('{"action":"tool","tool": get_x, oops not valid json}');
    expect(a.kind).toBe('unparseable');
    expect(a.message).toBe('');
    expect(a.message).not.toContain('"action"');
  });
  it('extracts a tool call embedded after prose', () => {
    const a = parseAction('Sure! {"action":"tool","tool":"get_x","parameters":{}}');
    expect(a).toMatchObject({ kind: 'tool', tool: 'get_x' });
  });
  it('refuses an untagged chain-of-thought dump instead of forwarding it', () => {
    const a = parseAction(SCRATCHPAD);
    expect(a.kind).toBe('unparseable');
    expect(a.message).toBe('');
  });
  it('refuses a scratchpad even inside a well-formed final envelope', () => {
    const a = parseAction(JSON.stringify({ action: 'final', message: SCRATCHPAD }));
    expect(a.kind).toBe('unparseable');
  });
  it('does not answer "OK" when the turn is empty', () => {
    // Reachable since stripReasoning started returning '' for an all-scratchpad turn.
    expect(parseAction('').kind).toBe('unparseable');
    expect(parseAction('   ').kind).toBe('unparseable');
  });
  it('marks how a final was obtained so the loop can distrust the lenient path', () => {
    expect(parseAction('{"action":"final","message":"hello"}').via).toBe('json');
    expect(parseAction('just text').via).toBe('prose');
  });
});

describe('renderToolCatalog', () => {
  it('tags read vs action tools', () => {
    const out = renderToolCatalog([
      { name: 'r', description: 'read it', params: [], readOnly: true },
      { name: 'a', description: 'do it', params: ['x'] },
    ]);
    expect(out).toContain('- r [read]: read it (params: none)');
    expect(out).toContain('- a [action]: do it (params: x)');
  });
});

describe('runToolLoop', () => {
  it('calls a tool then returns the final answer', async () => {
    const llm = scriptedLlm([
      '{"action":"tool","tool":"get_data","parameters":{}}',
      '{"action":"final","message":"done"}',
    ]);
    const execute = vi.fn().mockResolvedValue({ success: true, data: { value: 42 } });

    const res = await runToolLoop({
      llm, tenantId: 't1',
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
      execute,
    });

    expect(execute).toHaveBeenCalledWith('get_data', {}, undefined);
    expect(res.reply).toBe('done');
    expect(res.toolsUsed).toEqual([{ tool: 'get_data', ok: true }]);
    expect(res.llmError).toBe(false);
  });

  it('returns llmError when the model is unreachable', async () => {
    const llm = {
      chat: vi.fn().mockResolvedValue({ content: '', model: 'x', error: true, errorType: 'timeout', errorMessage: 'boom' }),
    } as unknown as LLMRouterService;

    const res = await runToolLoop({
      llm, tenantId: 't1',
      messages: [{ role: 'system', content: 'sys' }],
      execute: vi.fn(),
    });
    expect(res.reply).toBeNull();
    expect(res.llmError).toBe(true);
  });

  it('re-prompts once on malformed protocol, then recovers to a final answer', async () => {
    const llm = scriptedLlm([
      '{"action":"tool", bogus not json}',        // unparseable → triggers one re-prompt
      '{"action":"final","message":"recovered"}', // model corrects itself
    ]);
    const execute = vi.fn();
    const res = await runToolLoop({
      llm, tenantId: 't1',
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
      execute,
    });
    expect(execute).not.toHaveBeenCalled();
    expect(res.reply).toBe('recovered');
    expect(res.llmError).toBe(false);
  });

  it('returns the surface fallback (never raw JSON) if malformed protocol persists', async () => {
    const llm = scriptedLlm(['{"action":"tool", still bogus}']); // always unparseable
    const res = await runToolLoop({
      llm, tenantId: 't1',
      messages: [{ role: 'system', content: 'sys' }],
      execute: vi.fn(),
      fallbackReply: 'FALLBACK',
    });
    expect(res.reply).toBe('FALLBACK');
    expect(res.reply).not.toContain('action');
  });

  it('never sends a chain-of-thought dump to the customer', async () => {
    const llm = scriptedLlm([SCRATCHPAD]); // the model keeps thinking out loud
    const res = await runToolLoop({
      llm, tenantId: 't1',
      messages: [{ role: 'system', content: 'sys' }],
      execute: vi.fn(),
      fallbackReply: 'FALLBACK',
    });
    expect(res.reply).toBe('FALLBACK');
    expect(res.reply).not.toContain('let me');
  });

  it('recovers when the model corrects itself after a scratchpad turn', async () => {
    const llm = scriptedLlm([SCRATCHPAD, '{"action":"final","message":"Halo kak! Cabang kami ada di BSD."}']);
    const res = await runToolLoop({
      llm, tenantId: 't1',
      messages: [{ role: 'system', content: 'sys' }],
      execute: vi.fn(),
      fallbackReply: 'FALLBACK',
    });
    expect(res.reply).toBe('Halo kak! Cabang kami ada di BSD.');
  });

  it('refuses a prose answer that was cut off at max_tokens', async () => {
    // A plain-prose turn is normally accepted; a truncated one is a fragment.
    const llm = truncatedLlm(['Cabang kami ada di BSD, Bintaro, Kencana Loka dan']);
    const res = await runToolLoop({
      llm, tenantId: 't1',
      messages: [{ role: 'system', content: 'sys' }],
      execute: vi.fn(),
      fallbackReply: 'FALLBACK',
    });
    expect(res.reply).toBe('FALLBACK');
  });

  it('still accepts a truncated turn that parsed as real protocol JSON', async () => {
    // If it parsed, the envelope closed, so the message itself is complete.
    const llm = truncatedLlm(['{"action":"final","message":"Halo kak!"}']);
    const res = await runToolLoop({
      llm, tenantId: 't1',
      messages: [{ role: 'system', content: 'sys' }],
      execute: vi.fn(),
    });
    expect(res.reply).toBe('Halo kak!');
  });

  it('stops at the iteration cap without looping forever', async () => {
    const llm = scriptedLlm(['{"action":"tool","tool":"loopy","parameters":{}}']); // always a tool call
    const execute = vi.fn().mockResolvedValue({ success: true, data: {} });

    const res = await runToolLoop({
      llm, tenantId: 't1', maxIterations: 3,
      messages: [{ role: 'system', content: 'sys' }],
      execute,
    });
    expect(execute).toHaveBeenCalledTimes(3);
    expect(res.reply).toMatch(/ran out of reasoning steps/i);
  });
});
