import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { LLMRouterService, ChatMessage, LLMErrorResponse } from './llm-router.service';
import { AgentService } from './agent.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { SettingsService } from '../settings/settings.service';
import type { ToolDefinition } from './agent.types';

export interface ChatTurnResult {
  sessionId: string;
  reply: string;
  toolsUsed: { tool: string; ok: boolean }[];
}

interface StoredMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
}

const MAX_TOOL_ITERATIONS = 5;
const HISTORY_LIMIT = 20;

/**
 * AgentChatService — the conversational brain.
 *
 * Runs a tool-calling loop against the tenant's configured LLM (OpenRouter or
 * Hermes/Ollama, selected in AI settings). The model can call read tools to
 * "see" the business and action tools to operate it (governed by automation
 * toggles + approval mode). Every message and tool call is persisted.
 */
@Injectable()
export class AgentChatService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly llm: LLMRouterService,
    private readonly agent: AgentService,
    private readonly monitoring: MonitoringService,
    private readonly settings: SettingsService,
  ) {}

  async listSessions(tenantId: string): Promise<unknown[]> {
    const res = await this.pool.query(
      `SELECT id, title, created_at, updated_at FROM agent_chat_sessions
       WHERE tenant_id = $1 ORDER BY updated_at DESC LIMIT 50`,
      [tenantId],
    );
    return res.rows.map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at }));
  }

  async getMessages(tenantId: string, sessionId: string): Promise<unknown[]> {
    const owns = await this.pool.query(
      `SELECT 1 FROM agent_chat_sessions WHERE id = $1 AND tenant_id = $2`,
      [sessionId, tenantId],
    );
    if (owns.rowCount === 0) return [];
    const res = await this.pool.query(
      `SELECT role, content, tool_name, created_at FROM agent_chat_messages
       WHERE session_id = $1 AND role IN ('user','assistant') ORDER BY created_at ASC`,
      [sessionId],
    );
    return res.rows.map((r) => ({ role: r.role, content: r.content, createdAt: r.created_at }));
  }

  /**
   * Handle one user turn. Creates a session if needed, runs the tool loop,
   * and returns the assistant's final reply.
   */
  async chat(
    tenantId: string,
    userId: string | null,
    outletId: string | null,
    sessionId: string | null,
    userMessage: string,
  ): Promise<ChatTurnResult> {
    const start = Date.now();

    // Master AI switch — when off, the app stays fully self-reliant and the
    // assistant declines rather than calling any model.
    const settings = await this.settings.getSettings(tenantId);
    if (!settings.ai_enabled) {
      return {
        sessionId: sessionId ?? '',
        reply: 'AI is currently turned off. Enable it in Settings → AI to chat with the assistant.',
        toolsUsed: [],
      };
    }

    const sid = sessionId ?? (await this.createSession(tenantId, userId, userMessage));

    await this.saveMessage(sid, 'user', userMessage);

    const history = await this.loadHistory(sid);
    const tools = this.agent.getAllTools();
    const messages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt(tools) },
      ...history.map((m) => ({
        role: (m.role === 'tool' ? 'user' : m.role) as ChatMessage['role'],
        content: m.role === 'tool' ? `TOOL_RESULT: ${m.content}` : m.content,
      })),
    ];

    const toolsUsed: { tool: string; ok: boolean }[] = [];
    let finalReply = '';

    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      const res = await this.llm.chat(tenantId, messages, { temperature: 0.4, max_tokens: 1200, outletId: outletId ?? null });
      if ('error' in res && (res as LLMErrorResponse).error === true) {
        finalReply = `I could not reach the AI model. Please check the AI connection in Settings. (${(res as LLMErrorResponse).errorMessage})`;
        break;
      }

      const action = this.parseAction(res.content);

      if (action.kind === 'final') {
        finalReply = action.message;
        break;
      }

      // Tool call
      messages.push({ role: 'assistant', content: res.content });
      const invocation = {
        toolName: action.tool,
        tenantId,
        outletId: outletId ?? '',
        parameters: action.parameters ?? {},
        reasoning: action.reasoning ?? 'Requested during chat',
        confidence: 0.7,
      };
      const result = await this.agent.executeTool(invocation);
      toolsUsed.push({ tool: action.tool, ok: result.success });
      await this.saveMessage(sid, 'tool', JSON.stringify(result).slice(0, 8000), action.tool);
      messages.push({
        role: 'user',
        content: `TOOL_RESULT (${action.tool}): ${JSON.stringify(result).slice(0, 8000)}`,
      });

      if (iter === MAX_TOOL_ITERATIONS - 1) {
        finalReply = 'I gathered the information but ran out of reasoning steps. Please ask me to continue.';
      }
    }

    if (!finalReply) finalReply = 'Sorry, I was unable to produce a response.';

    await this.saveMessage(sid, 'assistant', finalReply);
    await this.pool.query(`UPDATE agent_chat_sessions SET updated_at = NOW() WHERE id = $1`, [sid]);

    await this.monitoring.record({
      tenantId,
      kind: 'chat',
      name: 'assistant_turn',
      status: 'success',
      durationMs: Date.now() - start,
      metadata: { toolsUsed: toolsUsed.length, sessionId: sid },
    });

    return { sessionId: sid, reply: finalReply, toolsUsed };
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private systemPrompt(tools: ToolDefinition[]): string {
    const catalog = tools
      .map((t) => {
        const props = (t.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
        const params = Object.keys(props).join(', ') || 'none';
        const tag = t.readOnly ? '[read]' : '[action]';
        return `- ${t.name} ${tag}: ${t.description} (params: ${params})`;
      })
      .join('\n');

    return `You are AIRE Assistant, an AI operations co-pilot for a car wash / service business.
You can SEE the business through read tools and OPERATE it through action tools.
Action tools may require owner approval depending on settings; if a tool returns "proposal_created", tell the user it is awaiting approval.

Available tools:
${catalog}

PROTOCOL — you MUST reply with a single JSON object and nothing else:
- To call a tool: {"action":"tool","tool":"<name>","parameters":{...},"reasoning":"<why>"}
- To answer the user: {"action":"final","message":"<your answer in the user's language>"}

Rules:
- Prefer read tools to ground answers in real data before responding.
- Use at most a few tool calls, then give a clear, concise final answer.
- Never invent numbers; rely on tool results. Format currency as Rp.
- When a TOOL_RESULT message is provided, use it to decide the next step.`;
  }

  private parseAction(content: string): {
    kind: 'tool' | 'final';
    tool: string;
    parameters?: Record<string, unknown>;
    reasoning?: string;
    message: string;
  } {
    let txt = (content ?? '').trim();
    // Strip markdown code fences
    const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) txt = fence[1]!.trim();
    // Extract the first {...} block
    const brace = txt.indexOf('{');
    const lastBrace = txt.lastIndexOf('}');
    if (brace !== -1 && lastBrace > brace) {
      const candidate = txt.slice(brace, lastBrace + 1);
      try {
        const parsed = JSON.parse(candidate);
        if (parsed.action === 'tool' && typeof parsed.tool === 'string') {
          return {
            kind: 'tool',
            tool: parsed.tool,
            parameters: parsed.parameters ?? {},
            reasoning: parsed.reasoning,
            message: '',
          };
        }
        if (parsed.action === 'final' && typeof parsed.message === 'string') {
          return { kind: 'final', tool: '', message: parsed.message };
        }
      } catch {
        /* fall through to plain text */
      }
    }
    // Not JSON — treat the whole content as the final answer.
    return { kind: 'final', tool: '', message: txt || 'OK' };
  }

  private async createSession(tenantId: string, userId: string | null, firstMessage: string): Promise<string> {
    const title = firstMessage.slice(0, 60);
    const res = await this.pool.query<{ id: string }>(
      `INSERT INTO agent_chat_sessions (tenant_id, user_id, title) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, userId, title],
    );
    return res.rows[0]!.id;
  }

  private async saveMessage(sessionId: string, role: string, content: string, toolName?: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO agent_chat_messages (session_id, role, content, tool_name) VALUES ($1, $2, $3, $4)`,
      [sessionId, role, content, toolName ?? null],
    );
  }

  private async loadHistory(sessionId: string): Promise<StoredMessage[]> {
    const res = await this.pool.query<{ role: string; content: string }>(
      `SELECT role, content FROM agent_chat_messages
       WHERE session_id = $1 ORDER BY created_at ASC LIMIT $2`,
      [sessionId, HISTORY_LIMIT],
    );
    return res.rows.map((r) => ({ role: r.role as StoredMessage['role'], content: r.content }));
  }
}
