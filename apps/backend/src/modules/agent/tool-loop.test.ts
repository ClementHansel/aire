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
  it('never leaks unparseable protocol JSON to the user', () => {
    const a = parseAction('{"action":"tool","tool": get_x, oops not valid json}');
    expect(a.kind).toBe('final');
    expect(a.message).not.toContain('"action"');
  });
  it('extracts a tool call embedded after prose', () => {
    const a = parseAction('Sure! {"action":"tool","tool":"get_x","parameters":{}}');
    expect(a).toMatchObject({ kind: 'tool', tool: 'get_x' });
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
