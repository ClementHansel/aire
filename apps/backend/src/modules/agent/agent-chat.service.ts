import { Injectable } from '@nestjs/common';
import { LLMRouterService, ChatMessage } from './llm-router.service';
import { AgentService } from './agent.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { SettingsService } from '../settings/settings.service';
import type { ToolDefinition } from './agent.types';
import { runToolLoop, renderToolCatalog, TOOL_PROTOCOL, type ToolCatalogEntry } from './tool-loop';
import { ChatStoreService, type ChatSessionSummary, type StoredChatMessage } from './chat-store.service';

export interface ChatTurnResult {
  sessionId: string;
  reply: string;
  toolsUsed: { tool: string; ok: boolean }[];
  /** Set when the automatic titler just named a fresh thread, so the UI can
   *  update the history entry without a refetch. */
  title?: string;
}

const MAX_TOOL_ITERATIONS = 5;

/**
 * AgentChatService — the conversational brain for a TENANT.
 *
 * Runs a tool-calling loop against the platform's configured LLM. The model can
 * call read tools to "see" the business and action tools to operate it (governed
 * by automation toggles + approval mode). Sessions, transcripts and titles live
 * in {@link ChatStoreService}; this service owns the prompt and the loop.
 *
 * The same method serves three surfaces — the full-page assistant, the floating
 * mini chat, and a whitelisted WhatsApp staff number — because they differ only
 * in transport. `readOnly` is the one behavioural switch: a read-only caller is
 * given the eyes but not the hands.
 */
@Injectable()
export class AgentChatService {
  constructor(
    private readonly llm: LLMRouterService,
    private readonly agent: AgentService,
    private readonly monitoring: MonitoringService,
    private readonly settings: SettingsService,
    private readonly store: ChatStoreService,
  ) {}

  // ─── History (delegated to the shared store, tenant-scoped) ───────────────

  listSessions(tenantId: string, userId: string | null): Promise<ChatSessionSummary[]> {
    return this.store.listSessions({ scope: 'tenant', tenantId, userId });
  }

  getMessages(tenantId: string, sessionId: string, userId: string | null): Promise<StoredChatMessage[]> {
    return this.store.getMessages({ scope: 'tenant', tenantId, userId, sessionId });
  }

  renameSession(tenantId: string, userId: string | null, sessionId: string, title: string) {
    return this.store.renameSession({ scope: 'tenant', tenantId, userId, sessionId, title });
  }

  setPinned(tenantId: string, userId: string | null, sessionId: string, pinned: boolean) {
    return this.store.setPinned({ scope: 'tenant', tenantId, userId, sessionId, pinned });
  }

  archiveSession(tenantId: string, userId: string | null, sessionId: string) {
    return this.store.archiveSession({ scope: 'tenant', tenantId, userId, sessionId });
  }

  createSession(tenantId: string, userId: string | null) {
    return this.store.createSession({ scope: 'tenant', tenantId, userId });
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
    options?: {
      /** Hide action tools entirely (read-only WhatsApp staff numbers). */
      readOnly?: boolean;
      /** Extra guidance appended to the system prompt (e.g. "you are on WhatsApp"). */
      surfaceNote?: string;
    },
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

    // An id from the client is only honoured when it really is this user's
    // thread; otherwise we silently start a new one rather than leak or 403.
    let sid = sessionId;
    if (sid && !(await this.store.ownsSession({ scope: 'tenant', tenantId, userId, sessionId: sid }))) {
      sid = null;
    }
    if (!sid) {
      sid = await this.store.createSession({ scope: 'tenant', tenantId, userId, firstMessage: userMessage });
    }

    await this.store.saveMessage(sid, 'user', userMessage);

    const history = await this.store.loadHistory(sid);
    const allTools = this.agent.getAllTools();
    const tools = options?.readOnly ? allTools.filter((t) => t.readOnly) : allTools;
    const messages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt(tools, options?.readOnly ?? false, options?.surfaceNote) },
      ...history.map((m) => ({
        role: (m.role === 'tool' ? 'user' : m.role) as ChatMessage['role'],
        content: m.role === 'tool' ? `TOOL_RESULT: ${m.content}` : m.content,
      })),
    ];

    // Drive the shared brain loop with the tenant's business tool registry.
    const loop = await runToolLoop({
      llm: this.llm,
      tenantId,
      outletId: outletId ?? null,
      messages,
      maxIterations: MAX_TOOL_ITERATIONS,
      temperature: 0.4,
      maxTokens: 1200,
      execute: async (tool, parameters, reasoning) => {
        // Second gate: a read-only caller must not reach an action tool even if
        // the model invents a name that isn't in the catalog it was shown.
        if (options?.readOnly) {
          const def = allTools.find((t) => t.name === tool);
          if (def && !def.readOnly) {
            return { success: false, error: 'This number has read-only access; actions are not permitted.' };
          }
        }
        return this.agent.executeTool({
          toolName: tool,
          tenantId,
          outletId: outletId ?? '',
          parameters,
          reasoning: reasoning ?? 'Requested during chat',
          confidence: 0.7,
        });
      },
      onToolResult: (tool, result) =>
        this.store.saveMessage(sid!, 'tool', JSON.stringify(result).slice(0, 8000), tool),
    });
    const toolsUsed = loop.toolsUsed;
    let finalReply = loop.reply ?? '';
    if (loop.llmError) finalReply = 'I could not reach the AI model. Please check the AI connection in Settings.';
    if (!finalReply) finalReply = 'Sorry, I was unable to produce a response.';

    await this.store.saveMessage(sid, 'assistant', finalReply);
    await this.store.touchSession(sid);
    const title = await this.store.maybeAutoTitle({
      sessionId: sid,
      tenantId,
      userMessage,
      assistantReply: finalReply,
    });

    await this.monitoring.record({
      tenantId,
      kind: 'chat',
      name: 'assistant_turn',
      status: 'success',
      durationMs: Date.now() - start,
      metadata: { toolsUsed: toolsUsed.length, sessionId: sid },
    });

    return { sessionId: sid, reply: finalReply, toolsUsed, ...(title ? { title } : {}) };
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private systemPrompt(tools: ToolDefinition[], readOnly: boolean, surfaceNote?: string): string {
    const catalog: ToolCatalogEntry[] = tools.map((t) => {
      const props = (t.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
      return { name: t.name, description: t.description, params: Object.keys(props), readOnly: t.readOnly };
    });

    return `You are Airin AI Assistant, the AI operations co-pilot built into Airin for a car wash / service business.
Your name is Airin AI Assistant — introduce yourself that way if asked who you are, and never claim another name.
You can SEE the business through read tools${readOnly ? '. You have READ-ONLY access: you cannot change anything, so when asked to act, say plainly that this channel is read-only.' : ' and OPERATE it through action tools.'}
${readOnly ? '' : `Action tools may require owner approval depending on settings; if a tool returns "proposal_created", tell the user the action is AWAITING APPROVAL (not done).\n`}GROUNDING RULE (critical): NEVER claim you created, sent, scheduled, adjusted, or changed anything unless you actually called the matching action tool THIS turn AND it returned success. Do not narrate an action as completed in a final answer instead of calling the tool. If an action tool returned an error or was not enabled, say plainly that it could NOT be done and why — never fabricate a success or invent names/IDs/numbers.
Format currency as Rp.
${surfaceNote ? `\n${surfaceNote}\n` : ''}
Available tools:
${renderToolCatalog(catalog)}

${TOOL_PROTOCOL}`;
  }
}
