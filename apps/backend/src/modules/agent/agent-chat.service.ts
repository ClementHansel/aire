import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { LLMRouterService, ChatMessage } from './llm-router.service';
import { AgentService } from './agent.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { SettingsService } from '../settings/settings.service';
import type { ToolDefinition } from './agent.types';
import { runToolLoop, renderToolCatalog, TOOL_PROTOCOL, type ToolCatalogEntry } from './tool-loop';

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

    // Drive the shared brain loop with the FULL business tool registry.
    const loop = await runToolLoop({
      llm: this.llm,
      tenantId,
      outletId: outletId ?? null,
      messages,
      maxIterations: MAX_TOOL_ITERATIONS,
      temperature: 0.4,
      maxTokens: 1200,
      execute: (tool, parameters, reasoning) =>
        this.agent.executeTool({
          toolName: tool,
          tenantId,
          outletId: outletId ?? '',
          parameters,
          reasoning: reasoning ?? 'Requested during chat',
          confidence: 0.7,
        }),
      onToolResult: (tool, result) => this.saveMessage(sid, 'tool', JSON.stringify(result).slice(0, 8000), tool),
    });
    const toolsUsed = loop.toolsUsed;
    let finalReply = loop.reply ?? '';
    if (loop.llmError) finalReply = 'I could not reach the AI model. Please check the AI connection in Settings.';
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
    const catalog: ToolCatalogEntry[] = tools.map((t) => {
      const props = (t.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
      return { name: t.name, description: t.description, params: Object.keys(props), readOnly: t.readOnly };
    });

    return `You are AIRE Assistant, an AI operations co-pilot for a car wash / service business.
You can SEE the business through read tools and OPERATE it through action tools.
Action tools may require owner approval depending on settings; if a tool returns "proposal_created", tell the user the action is AWAITING APPROVAL (not done).
GROUNDING RULE (critical): NEVER claim you created, sent, scheduled, adjusted, or changed anything unless you actually called the matching action tool THIS turn AND it returned success. Do not narrate an action as completed in a final answer instead of calling the tool. If an action tool returned an error or was not enabled, say plainly that it could NOT be done and why — never fabricate a success or invent names/IDs/numbers.
Format currency as Rp.

Available tools:
${renderToolCatalog(catalog)}

${TOOL_PROTOCOL}`;
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
