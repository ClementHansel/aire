import { LLMRouterService, ChatMessage, LLMErrorResponse } from './llm-router.service';
import type { ToolResult } from './agent.types';

/**
 * Shared tool-calling loop — the ONE brain used by every agent surface.
 *
 * Both the staff co-pilot (full business tools) and the customer-facing
 * WhatsApp agent (customer-scoped tools) run this exact loop against the
 * tenant's configured LLM. What differs between surfaces is only:
 *   - the tool CATALOG advertised in the system prompt, and
 *   - the `execute` function (which enforces scoping/gating).
 *
 * The loop is deliberately provider-agnostic (it drives LLMRouterService, so it
 * works with OpenRouter or a self-hosted Hermes/Ollama) and transport-agnostic
 * (it uses a plain JSON protocol rather than provider-native function-calling,
 * so a small local model can drive it too).
 */

/** One tool as advertised to the model in the system prompt. */
export interface ToolCatalogEntry {
  name: string;
  description: string;
  /** Parameter names, for the human-readable catalog line. */
  params: string[];
  /** True for read-only tools (the agent's "eyes"). */
  readOnly?: boolean;
}

/** Render a tool catalog into the bullet list embedded in the system prompt. */
export function renderToolCatalog(tools: ToolCatalogEntry[]): string {
  return tools
    .map((t) => {
      const params = t.params.length ? t.params.join(', ') : 'none';
      const tag = t.readOnly ? '[read]' : '[action]';
      return `- ${t.name} ${tag}: ${t.description} (params: ${params})`;
    })
    .join('\n');
}

/**
 * The JSON call/answer protocol appended to every agent system prompt. Keeping
 * it identical across surfaces means one contract to reason about and test.
 */
export const TOOL_PROTOCOL = `PROTOCOL — you MUST reply with a single JSON object and nothing else:
- To call a tool: {"action":"tool","tool":"<name>","parameters":{...},"reasoning":"<why>"}
- To answer: {"action":"final","message":"<your answer in the user's language>"}

Rules:
- Prefer read tools to ground answers in real data before responding.
- Use at most a few tool calls, then give a clear, concise final answer.
- Never invent numbers, prices, order numbers, or membership details — rely only on tool results.
- When a TOOL_RESULT message is provided, use it to decide the next step.`;

export interface ParsedAction {
  kind: 'tool' | 'final';
  tool: string;
  parameters?: Record<string, unknown>;
  reasoning?: string;
  message: string;
}

/**
 * Parse a model turn into either a tool call or a final answer. Tolerant of
 * markdown code fences and leading/trailing prose; falls back to treating the
 * whole content as a plain-text final answer.
 */
export function parseAction(content: string): ParsedAction {
  let txt = (content ?? '').trim();
  const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) txt = fence[1]!.trim();
  const brace = txt.indexOf('{');
  const lastBrace = txt.lastIndexOf('}');
  if (brace !== -1 && lastBrace > brace) {
    const candidate = txt.slice(brace, lastBrace + 1);
    try {
      const parsed = JSON.parse(candidate);
      if (parsed.action === 'tool' && typeof parsed.tool === 'string') {
        return { kind: 'tool', tool: parsed.tool, parameters: parsed.parameters ?? {}, reasoning: parsed.reasoning, message: '' };
      }
      if (parsed.action === 'final' && typeof parsed.message === 'string') {
        return { kind: 'final', tool: '', message: parsed.message };
      }
    } catch {
      /* fall through to plain text */
    }
  }
  return { kind: 'final', tool: '', message: txt || 'OK' };
}

export interface ToolLoopResult {
  /** Final assistant text, or null if the model was unreachable. */
  reply: string | null;
  toolsUsed: { tool: string; ok: boolean }[];
  /** True when the model was unreachable/errored (callers may fall back). */
  llmError: boolean;
}

export interface RunToolLoopOptions {
  llm: LLMRouterService;
  tenantId: string;
  outletId?: string | null;
  /** Full message list INCLUDING the system prompt as the first entry. */
  messages: ChatMessage[];
  /** Executes a tool. Scoping / gating lives entirely inside this function. */
  execute: (tool: string, parameters: Record<string, unknown>, reasoning?: string) => Promise<ToolResult>;
  maxIterations?: number;
  temperature?: number;
  maxTokens?: number;
  /** Persistence hook, invoked after each tool executes. */
  onToolResult?: (tool: string, result: ToolResult) => Promise<void> | void;
}

/**
 * Drive the tool-calling loop to a final answer.
 *
 * The caller owns the system prompt (persona + guardrails + tool catalog) and
 * the `execute` function (scoping). This function owns only the loop: call the
 * model, parse, run tools, feed results back, stop on a final answer, an error,
 * or the iteration cap.
 */
export async function runToolLoop(opts: RunToolLoopOptions): Promise<ToolLoopResult> {
  const { llm, tenantId, outletId, execute, onToolResult } = opts;
  const messages = [...opts.messages];
  const maxIterations = opts.maxIterations ?? 5;
  const temperature = opts.temperature ?? 0.4;
  const maxTokens = opts.maxTokens ?? 800;

  const toolsUsed: { tool: string; ok: boolean }[] = [];

  for (let iter = 0; iter < maxIterations; iter++) {
    const res = await llm.chat(tenantId, messages, { temperature, max_tokens: maxTokens, outletId: outletId ?? null });
    if ('error' in res && (res as LLMErrorResponse).error === true) {
      return { reply: null, toolsUsed, llmError: true };
    }

    const action = parseAction(res.content);
    if (action.kind === 'final') {
      return { reply: action.message, toolsUsed, llmError: false };
    }

    // Tool call: echo the model turn, run the tool, feed the result back.
    messages.push({ role: 'assistant', content: res.content });
    const result = await execute(action.tool, action.parameters ?? {}, action.reasoning);
    toolsUsed.push({ tool: action.tool, ok: result.success });
    await onToolResult?.(action.tool, result);
    messages.push({
      role: 'user',
      content: `TOOL_RESULT (${action.tool}): ${JSON.stringify(result).slice(0, 8000)}`,
    });

    if (iter === maxIterations - 1) {
      // Out of reasoning budget — return what we have rather than nothing.
      return {
        reply: 'I gathered the information but ran out of reasoning steps. Please ask me to continue.',
        toolsUsed,
        llmError: false,
      };
    }
  }

  return { reply: null, toolsUsed, llmError: false };
}
