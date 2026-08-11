import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { LLMRouterService, ChatMessage } from '../agent/llm-router.service';
import {
  runToolLoop, renderToolCatalog, TOOL_PROTOCOL, type ToolCatalogEntry,
} from '../agent/tool-loop';
import { ChatStoreService } from '../agent/chat-store.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { SettingsService } from '../settings/settings.service';
import { AdminMetricsService } from './admin-metrics.service';
import { PlatformOpsService } from './platform-ops.service';
import { PlatformInvoiceService } from './platform-invoice.service';
import { JobMonitorService } from '../job-monitor';
import type { ToolResult } from '../agent/agent.types';

export interface PlatformChatTurnResult {
  sessionId: string;
  reply: string;
  toolsUsed: { tool: string; ok: boolean }[];
  title?: string;
}

interface PlatformTool {
  name: string;
  description: string;
  params: string[];
  run: (p: Record<string, unknown>) => Promise<unknown>;
}

const MAX_TOOL_ITERATIONS = 5;

/**
 * PlatformChatService — the super-admin's AI console.
 *
 * Same brain, different eyes: it drives the shared {@link runToolLoop} but its
 * tool catalog is CROSS-TENANT and deliberately READ-ONLY. A super-admin can ask
 * "which tenants are overdue?" or "what broke in the last day?" and get an
 * answer grounded in the real control-plane tables — but the model cannot
 * suspend a tenant, write an invoice, or touch tenant data. Those actions carry
 * consequences for paying customers and stay in the hands of a human clicking a
 * button in /admin, where they are audited.
 *
 * Threads live in the shared chat tables under `scope = 'platform'` (no tenant),
 * so history/rename/pin behave exactly like the tenant console.
 */
@Injectable()
export class PlatformChatService {
  private readonly tools: PlatformTool[];

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly llm: LLMRouterService,
    private readonly store: ChatStoreService,
    private readonly monitoring: MonitoringService,
    private readonly settings: SettingsService,
    private readonly metrics: AdminMetricsService,
    private readonly ops: PlatformOpsService,
    private readonly invoices: PlatformInvoiceService,
    private readonly jobs: JobMonitorService,
  ) {
    this.tools = this.buildTools();
  }

  // ─── History ──────────────────────────────────────────────────────────────

  listSessions(userId: string | null) {
    return this.store.listSessions({ scope: 'platform', tenantId: null, userId });
  }

  getMessages(userId: string | null, sessionId: string) {
    return this.store.getMessages({ scope: 'platform', tenantId: null, userId, sessionId });
  }

  renameSession(userId: string | null, sessionId: string, title: string) {
    return this.store.renameSession({ scope: 'platform', tenantId: null, userId, sessionId, title });
  }

  setPinned(userId: string | null, sessionId: string, pinned: boolean) {
    return this.store.setPinned({ scope: 'platform', tenantId: null, userId, sessionId, pinned });
  }

  archiveSession(userId: string | null, sessionId: string) {
    return this.store.archiveSession({ scope: 'platform', tenantId: null, userId, sessionId });
  }

  createSession(userId: string | null) {
    return this.store.createSession({ scope: 'platform', tenantId: null, userId });
  }

  // ─── One turn ─────────────────────────────────────────────────────────────

  async chat(userId: string | null, sessionId: string | null, userMessage: string): Promise<PlatformChatTurnResult> {
    const start = Date.now();

    // The platform LLM connection is the same one tenants use; if it isn't
    // configured there is nothing to talk to.
    const platform = await this.settings.getPlatformLlm();
    if (platform.provider === 'openrouter' && !platform.apiKey?.trim()) {
      return {
        sessionId: sessionId ?? '',
        reply: 'No AI model is configured. Set the platform LLM key in Admin → Platform Config → AI.',
        toolsUsed: [],
      };
    }

    let sid = sessionId;
    if (sid && !(await this.store.ownsSession({ scope: 'platform', tenantId: null, userId, sessionId: sid }))) {
      sid = null;
    }
    if (!sid) {
      sid = await this.store.createSession({ scope: 'platform', tenantId: null, userId, firstMessage: userMessage });
    }

    await this.store.saveMessage(sid, 'user', userMessage);
    const history = await this.store.loadHistory(sid);

    const messages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt() },
      ...history.map((m) => ({
        role: (m.role === 'tool' ? 'user' : m.role) as ChatMessage['role'],
        content: m.role === 'tool' ? `TOOL_RESULT: ${m.content}` : m.content,
      })),
    ];

    const loop = await runToolLoop({
      llm: this.llm,
      tenantId: null,
      messages,
      maxIterations: MAX_TOOL_ITERATIONS,
      temperature: 0.3,
      maxTokens: 1400,
      execute: (tool, parameters) => this.execute(tool, parameters),
      onToolResult: (tool, result) =>
        this.store.saveMessage(sid!, 'tool', JSON.stringify(result).slice(0, 8000), tool),
    });

    let reply = loop.reply ?? '';
    if (loop.llmError) reply = 'I could not reach the AI model. Check the platform LLM settings in Platform Config.';
    if (!reply) reply = 'Sorry, I was unable to produce a response.';

    await this.store.saveMessage(sid, 'assistant', reply);
    await this.store.touchSession(sid);
    const title = await this.store.maybeAutoTitle({
      sessionId: sid,
      tenantId: null,
      userMessage,
      assistantReply: reply,
    });

    await this.monitoring.record({
      tenantId: null,
      kind: 'chat',
      name: 'platform_admin_turn',
      status: 'success',
      durationMs: Date.now() - start,
      metadata: { toolsUsed: loop.toolsUsed.length, sessionId: sid },
    });

    return { sessionId: sid, reply, toolsUsed: loop.toolsUsed, ...(title ? { title } : {}) };
  }

  /** The catalog, for the UI's "what can it see?" panel. */
  listTools(): { name: string; description: string; params: string[] }[] {
    return this.tools.map(({ name, description, params }) => ({ name, description, params }));
  }

  // ─── Tools ────────────────────────────────────────────────────────────────

  private async execute(tool: string, parameters: Record<string, unknown>): Promise<ToolResult> {
    const def = this.tools.find((t) => t.name === tool);
    if (!def) return { success: false, error: `Unknown tool: ${tool}` };
    try {
      const data = await def.run(parameters ?? {});
      return { success: true, data: { result: data } as Record<string, unknown> };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private buildTools(): PlatformTool[] {
    const int = (v: unknown, dflt: number, max: number) => {
      const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
      return Number.isFinite(n) ? Math.min(Math.max(1, n), max) : dflt;
    };
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

    return [
      {
        name: 'platform_overview',
        description: 'Platform-wide totals: tenant counts by status, outlets, users, customers, revenue today/7d/30d, active memberships, estimated MRR, AI calls in 30d.',
        params: [],
        run: () => this.metrics.getOverview(),
      },
      {
        name: 'list_tenants',
        description: 'All tenant accounts with plan, status, slug and creation date. Optionally filter by status (active|suspended|cancelled) or a name/slug search.',
        params: ['status', 'search', 'limit'],
        run: async (p) => {
          const status = str(p.status).toLowerCase();
          const search = str(p.search).toLowerCase();
          const limit = int(p.limit, 50, 200);
          const res = await this.pool.query(
            `SELECT id, name, slug, plan, status, created_at
               FROM tenants
              WHERE ($1 = '' OR status = $1)
                AND ($2 = '' OR LOWER(name) LIKE '%' || $2 || '%' OR LOWER(slug) LIKE '%' || $2 || '%')
              ORDER BY created_at DESC LIMIT $3`,
            [status, search, limit],
          );
          return res.rows;
        },
      },
      {
        name: 'tenant_detail',
        description: 'One tenant in depth: its status/plan, its own business metrics (orders, revenue, memberships), branch count and enabled modules. Accepts a tenant slug, name or id.',
        params: ['tenant'],
        run: async (p) => {
          const key = str(p.tenant);
          if (!key) throw new Error('tenant is required (slug, name or id)');
          const t = await this.resolveTenant(key);
          const [overview, branches, modules] = await Promise.all([
            this.metrics.getOverview(t.id),
            this.metrics.getBranches(t.id).catch(() => []),
            this.pool
              .query<{ feature_flags: Record<string, unknown> }>(
                `SELECT COALESCE(settings->'feature_flags', '{}'::jsonb) AS feature_flags FROM tenants WHERE id = $1`,
                [t.id],
              )
              .then((r) => r.rows[0]?.feature_flags ?? {}),
          ]);
          return { tenant: t, overview, branches, modules };
        },
      },
      {
        name: 'billing_summary',
        description: 'Subscription billing health: outstanding and overdue amounts, paid this month, and invoice counts by status.',
        params: [],
        run: () => this.invoices.summary(),
      },
      {
        name: 'list_invoices',
        description: 'Platform subscription invoices, newest first. Filter by status (draft|open|paid|overdue|void) to find who owes money.',
        params: ['status', 'limit'],
        run: async (p) => {
          const status = str(p.status);
          const all = await this.invoices.list(status ? { status: status as never } : {});
          return all.slice(0, int(p.limit, 50, 200));
        },
      },
      {
        name: 'ops_feed',
        description: 'Recent platform-significant events across ALL tenants (churn, auto-suspensions, plan changes, limit hits, paid invoices, anomalies). Filter by severity (info|warning|critical).',
        params: ['severity', 'limit'],
        run: async (p) => {
          const severity = str(p.severity).toLowerCase();
          const pageSize = int(p.limit, 30, 200);
          const res = await this.ops.feed({
            ...(severity ? { severity: severity as never } : {}),
            page: 1,
            pageSize,
          });
          return { events: res.data, total: res.total };
        },
      },
      {
        name: 'alerts_summary',
        description: 'Counts of platform events by severity over the last 24 hours and 7 days — the quickest read on whether anything is on fire.',
        params: [],
        run: () => this.ops.alertsSummary(),
      },
      {
        name: 'jobs_health',
        description: 'Background job heartbeats: last run, status, duration, error count, and whether each job is stale (overdue vs its interval).',
        params: [],
        run: () => this.jobs.list(),
      },
      {
        name: 'ai_usage',
        description: 'AI/LLM usage and estimated cost over a window of days, broken down as the AI Usage page shows it.',
        params: ['days'],
        run: (p) => this.metrics.getAiUsage({ scope: 'global', windowDays: int(p.days, 30, 365) }),
      },
      {
        name: 'system_health',
        description: 'Reachability of the database and WhatsApp gateway plus core row counts — the System Health check.',
        params: [],
        run: () => this.metrics.getHealth(),
      },
    ];
  }

  /** Resolve a tenant by id, slug or (unique) name; throws a clear error if ambiguous. */
  private async resolveTenant(key: string): Promise<{ id: string; name: string; slug: string; plan: string; status: string }> {
    const res = await this.pool.query(
      `SELECT id, name, slug, plan, status FROM tenants
        WHERE slug = $1 OR LOWER(name) = LOWER($1)
           OR ($1 ~ '^[0-9a-fA-F-]{36}$' AND id = $1::uuid)
        LIMIT 5`,
      [key],
    );
    if (res.rowCount === 0) throw new Error(`No tenant matches "${key}"`);
    if ((res.rowCount ?? 0) > 1) {
      throw new Error(`"${key}" matches several tenants: ${res.rows.map((r) => r.slug).join(', ')}`);
    }
    return res.rows[0];
  }

  private systemPrompt(): string {
    const catalog: ToolCatalogEntry[] = this.tools.map((t) => ({
      name: t.name,
      description: t.description,
      params: t.params,
      readOnly: true,
    }));

    return `You are Airin AI Assistant, working here as the platform console for the SaaS operator running this multi-tenant car-wash platform.
Your name is Airin AI Assistant — introduce yourself that way if asked who you are.
Your users are platform super-admins. You see ACROSS all tenants.
You are READ-ONLY: you have no tools that change anything. If asked to suspend a tenant, edit an invoice, change a plan, or modify tenant data, explain that this console only reads, and point them at the matching page in /admin.
GROUNDING RULE (critical): every number, tenant name, status and date you state must come from a tool result in this conversation. Never estimate, never fill gaps from memory, and never invent a tenant. If a tool returned nothing, say so.
When you report money, format it as Rp with thousands separators. When comparing tenants, prefer a short table-like list over prose.
Be concise and operational: lead with the answer, then the few numbers that support it.

Available tools:
${renderToolCatalog(catalog)}

${TOOL_PROTOCOL}`;
  }
}
