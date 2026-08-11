import { LLMRouterService, ChatMessage, LLMErrorResponse } from './llm-router.service';
import { looksLikeReasoning } from '../../common/looks-like-reasoning';
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
- NEVER say you are waiting for, or awaiting, a tool result. You are not waiting — you are driving. If part of the question still needs a tool, emit the tool call as this turn's JSON; only answer once you have what you need (or say plainly which part you could not check).
- Never invent numbers, prices, order numbers, or membership details — rely only on tool results.
- When a TOOL_RESULT message is provided, use it to decide the next step.`;

export interface ParsedAction {
  /** 'unparseable' = the turn was not a usable action (malformed protocol JSON,
   *  empty, or a raw chain-of-thought dump); the loop should re-prompt for a
   *  valid object rather than treat it as an answer. */
  kind: 'tool' | 'final' | 'unparseable';
  tool: string;
  parameters?: Record<string, unknown>;
  reasoning?: string;
  message: string;
  /** How a 'final' was obtained: 'json' = a real `{"action":"final"}` object,
   *  'prose' = the lenient path that accepts a plain-text turn as the answer.
   *  The loop trusts 'prose' less — e.g. it refuses a TRUNCATED prose turn. */
  via?: 'json' | 'prose';
}

/**
 * Extract the FIRST complete, brace-balanced JSON object from a string (aware of
 * strings/escapes). Returns null if none. Crucially, this takes only the first
 * object — some models emit several protocol objects at once, and spanning from
 * the first "{" to the last "}" would produce invalid JSON.
 */
function firstJsonObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

/**
 * Parse a model turn into either a tool call or a final answer. Tolerant of
 * markdown code fences, leading/trailing prose, and models that emit MULTIPLE
 * protocol objects in one turn (we take the first). Never leaks raw protocol
 * JSON to the user: if the text is clearly a (malformed) protocol object we
 * couldn't parse, we return a safe generic reply instead of the JSON.
 */
export function parseAction(content: string): ParsedAction {
  let txt = (content ?? '').trim();
  const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) txt = fence[1]!.trim();

  const candidate = firstJsonObject(txt);
  if (candidate) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed.action === 'tool' && typeof parsed.tool === 'string') {
        return { kind: 'tool', tool: parsed.tool, parameters: parsed.parameters ?? {}, reasoning: parsed.reasoning, message: '' };
      }
      if (parsed.action === 'final' && typeof parsed.message === 'string') {
        // Even inside a well-formed envelope the message can be a scratchpad —
        // some models put their deliberation in `message` when they run long.
        if (looksLikeReasoning(parsed.message)) {
          return { kind: 'unparseable', tool: '', message: '' };
        }
        return { kind: 'final', tool: '', message: parsed.message, via: 'json' };
      }
    } catch {
      /* fall through */
    }
  }

  // Looks like the model tried to speak the protocol but we couldn't parse a
  // valid action — do NOT echo raw JSON to the user, and do NOT silently pass it
  // off as a final answer (that leaked a hardcoded, customer-voiced fallback into
  // the staff surface). Signal 'unparseable' so runToolLoop can re-prompt for a
  // valid protocol object, then fall back to a surface-appropriate message.
  if (txt.startsWith('{') && /"(action|tool)"\s*:/.test(txt)) {
    return { kind: 'unparseable', tool: '', message: '' };
  }

  // Nothing left to say. Previously this returned the literal "OK", which a
  // WhatsApp customer would receive as the reply; it also became reachable once
  // `stripReasoning` started returning empty for an all-scratchpad turn.
  if (!txt) return { kind: 'unparseable', tool: '', message: '' };

  // A plain-prose turn is normally the model ignoring the protocol and simply
  // answering, which we accept. But on 2026-08-07 the "answer" was 600 words of
  // untagged English self-talk ("Okay, let me try to figure out how to respond
  // here. The user asked…") and this lenient path forwarded it to the customer.
  // A scratchpad is not an answer — send it back for a proper one.
  if (looksLikeReasoning(txt)) {
    return { kind: 'unparseable', tool: '', message: '' };
  }

  return { kind: 'final', tool: '', message: txt, via: 'prose' };
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
  /** Null for platform-scoped surfaces (the super-admin console), which belong
   *  to no tenant — the tenant only ever labels the monitoring record. */
  tenantId: string | null;
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
  /** Surface-appropriate message returned when the model keeps emitting protocol
   *  JSON we cannot parse (after one corrective re-prompt). Defaults to a neutral,
   *  persona-free line so the customer "Irene" voice never leaks into staff chat. */
  fallbackReply?: string;
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
  const fallbackReply = opts.fallbackReply ?? 'Maaf, boleh diulangi lagi? / Sorry, could you rephrase that?';

  const toolsUsed: { tool: string; ok: boolean }[] = [];
  let reprompted = false;

  for (let iter = 0; iter < maxIterations; iter++) {
    const res = await llm.chat(tenantId, messages, { temperature, max_tokens: maxTokens, outletId: outletId ?? null });
    if ('error' in res && (res as LLMErrorResponse).error === true) {
      return { reply: null, toolsUsed, llmError: true };
    }

    const action = parseAction(res.content);

    // A turn cut off at max_tokens is a half-thought. Inside the protocol we'd
    // never have parsed it; on the LENIENT prose path we would happily forward
    // the fragment — which is how a customer got a scratchpad that stopped
    // mid-word ("…only 6 in Jabodetabek and"). Treat it as unusable instead.
    const truncatedProse = action.kind === 'final' && action.via === 'prose' && res.truncated === true;

    if (action.kind === 'final' && !truncatedProse) {
      return { reply: action.message, toolsUsed, llmError: false };
    }

    // Unusable turn — malformed protocol, empty, a chain-of-thought dump, or a
    // truncated fragment. Give the model exactly ONE chance to correct itself,
    // otherwise return a safe, surface-appropriate line (never the raw text).
    if (action.kind === 'unparseable' || truncatedProse) {
      if (reprompted) {
        return { reply: fallbackReply, toolsUsed, llmError: false };
      }
      reprompted = true;
      // Do NOT echo the offending turn back as context when it was truncated or
      // a scratchpad: feeding a half-finished monologue to the model invites it
      // to continue the monologue. A short marker keeps the turn order valid.
      const usableEcho = !truncatedProse && !looksLikeReasoning(res.content) && res.content.trim() !== '';
      messages.push({ role: 'assistant', content: usableEcho ? res.content : '(unusable reply omitted)' });
      messages.push({
        role: 'user',
        content:
          'SYSTEM: Your previous reply was not a valid PROTOCOL JSON object. ' +
          'Do NOT write out your thinking, notes, or drafts — the customer sees everything you send. ' +
          'Reply with EXACTLY ONE JSON object — either {"action":"tool",...} or {"action":"final","message":"..."} — and nothing else. ' +
          'Keep "message" short enough to finish in one reply.',
      });
      continue;
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
