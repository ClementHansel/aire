import { Injectable, Inject, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { LLMRouterService } from './llm-router.service';

/**
 * Which console a thread belongs to. 'tenant' = the business co-pilot in
 * /dashboard/assistant (scoped to one tenant's data); 'platform' = the
 * super-admin console in /admin/assistant (cross-tenant, no tenant_id).
 */
export type ChatScope = 'tenant' | 'platform';

export interface ChatSessionSummary {
  id: string;
  title: string;
  pinned: boolean;
  messageCount: number;
  /** First ~120 chars of the last user/assistant message, for the history list. */
  preview: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredChatMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolName?: string | null;
  createdAt?: string;
}

/** How many prior messages are replayed into the model's context. */
export const HISTORY_LIMIT = 30;

const UNTITLED = 'New chat';

/**
 * ChatStoreService — the session/message store shared by every chat surface.
 *
 * Both consoles (tenant co-pilot, platform admin) keep their threads in the same
 * two tables, separated by `scope`. Everything a chat product needs beyond
 * "append a message" lives here: thread listing with previews, rename, pin,
 * archive, and the automatic titler.
 *
 * Ownership is enforced on every read/write by re-checking (scope, tenant, user)
 * inside the query rather than trusting an id from the client, so one tenant can
 * never open another's thread by guessing a UUID.
 */
@Injectable()
export class ChatStoreService {
  private readonly logger = new Logger(ChatStoreService.name);

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly llm: LLMRouterService,
  ) {}

  // ─── Sessions ─────────────────────────────────────────────────────────────

  /**
   * A user's threads, newest first, pinned on top. Archived threads are hidden.
   *
   * Tenant threads are per-user, EXCEPT legacy rows written before this table
   * carried a user (user_id IS NULL) — those stay visible so nobody's history
   * silently disappears on upgrade.
   */
  async listSessions(params: {
    scope: ChatScope;
    tenantId: string | null;
    userId: string | null;
  }): Promise<ChatSessionSummary[]> {
    const res = await this.pool.query(
      `SELECT s.id, s.title, s.pinned, s.created_at, s.updated_at,
              COUNT(m.id) FILTER (WHERE m.role IN ('user','assistant'))::int AS message_count,
              (SELECT content FROM agent_chat_messages
                WHERE session_id = s.id AND role IN ('user','assistant')
                ORDER BY created_at DESC LIMIT 1) AS preview
         FROM agent_chat_sessions s
         LEFT JOIN agent_chat_messages m ON m.session_id = s.id
        WHERE s.scope = $1
          AND s.archived_at IS NULL
          AND ($2::uuid IS NULL OR s.tenant_id = $2::uuid)
          AND ($3::uuid IS NULL OR s.user_id = $3::uuid OR s.user_id IS NULL)
        GROUP BY s.id
        ORDER BY s.pinned DESC, s.updated_at DESC
        LIMIT 100`,
      [params.scope, params.tenantId, params.userId],
    );
    return res.rows.map((r) => ({
      id: r.id,
      title: r.title || UNTITLED,
      pinned: r.pinned,
      messageCount: r.message_count ?? 0,
      preview: r.preview ? String(r.preview).slice(0, 120) : null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /** True when the thread exists and belongs to this scope/tenant/user. */
  async ownsSession(params: {
    scope: ChatScope;
    tenantId: string | null;
    userId: string | null;
    sessionId: string;
  }): Promise<boolean> {
    // A malformed id would make Postgres throw on the ::uuid cast; treat any
    // non-UUID as "not yours" instead of surfacing a 500.
    if (!isUuid(params.sessionId)) return false;
    const res = await this.pool.query(
      `SELECT 1 FROM agent_chat_sessions
        WHERE id = $1 AND scope = $2
          AND ($3::uuid IS NULL OR tenant_id = $3::uuid)
          AND ($4::uuid IS NULL OR user_id = $4::uuid OR user_id IS NULL)`,
      [params.sessionId, params.scope, params.tenantId, params.userId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async createSession(params: {
    scope: ChatScope;
    tenantId: string | null;
    userId: string | null;
    firstMessage?: string;
  }): Promise<string> {
    const title = params.firstMessage?.trim() ? truncateTitle(params.firstMessage) : UNTITLED;
    const res = await this.pool.query<{ id: string }>(
      `INSERT INTO agent_chat_sessions (tenant_id, user_id, scope, title, auto_titled)
       VALUES ($1, $2, $3, $4, true) RETURNING id`,
      [params.tenantId, params.userId, params.scope, title],
    );
    return res.rows[0]!.id;
  }

  /**
   * Rename a thread. Marks it `auto_titled = false` so the automatic titler
   * never overwrites a name a human chose.
   */
  async renameSession(params: {
    scope: ChatScope;
    tenantId: string | null;
    userId: string | null;
    sessionId: string;
    title: string;
  }): Promise<{ id: string; title: string } | null> {
    if (!(await this.ownsSession(params))) return null;
    const title = truncateTitle(params.title, 120) || UNTITLED;
    const res = await this.pool.query<{ id: string; title: string }>(
      `UPDATE agent_chat_sessions SET title = $2, auto_titled = false, updated_at = NOW()
        WHERE id = $1 RETURNING id, title`,
      [params.sessionId, title],
    );
    return res.rows[0] ?? null;
  }

  async setPinned(params: {
    scope: ChatScope;
    tenantId: string | null;
    userId: string | null;
    sessionId: string;
    pinned: boolean;
  }): Promise<boolean> {
    if (!(await this.ownsSession(params))) return false;
    await this.pool.query(`UPDATE agent_chat_sessions SET pinned = $2 WHERE id = $1`, [
      params.sessionId,
      params.pinned,
    ]);
    return true;
  }

  /**
   * Archive a thread — it leaves the history list immediately but the transcript
   * is kept, because these conversations can contain a record of actions the
   * agent actually took on the business (an audit trail worth more than the row).
   */
  async archiveSession(params: {
    scope: ChatScope;
    tenantId: string | null;
    userId: string | null;
    sessionId: string;
  }): Promise<boolean> {
    if (!(await this.ownsSession(params))) return false;
    await this.pool.query(
      `UPDATE agent_chat_sessions SET archived_at = NOW() WHERE id = $1 AND archived_at IS NULL`,
      [params.sessionId],
    );
    return true;
  }

  // ─── Messages ─────────────────────────────────────────────────────────────

  /**
   * The visible transcript: user + assistant turns only. Tool calls are stored
   * too (see {@link saveMessage}) but they are the agent's plumbing, surfaced
   * separately as badges rather than as chat bubbles.
   */
  async getMessages(params: {
    scope: ChatScope;
    tenantId: string | null;
    userId: string | null;
    sessionId: string;
  }): Promise<StoredChatMessage[]> {
    if (!(await this.ownsSession(params))) return [];
    const res = await this.pool.query(
      `SELECT role, content, tool_name, created_at FROM agent_chat_messages
        WHERE session_id = $1 AND role IN ('user','assistant')
        ORDER BY created_at ASC`,
      [params.sessionId],
    );
    return res.rows.map((r) => ({
      role: r.role,
      content: r.content ?? '',
      toolName: r.tool_name,
      createdAt: r.created_at,
    }));
  }

  async saveMessage(
    sessionId: string,
    role: StoredChatMessage['role'],
    content: string,
    toolName?: string | null,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO agent_chat_messages (session_id, role, content, tool_name) VALUES ($1,$2,$3,$4)`,
      [sessionId, role, content, toolName ?? null],
    );
  }

  /** Prior turns replayed into the model's context (oldest first). */
  async loadHistory(sessionId: string, limit = HISTORY_LIMIT): Promise<StoredChatMessage[]> {
    // Take the LAST `limit` rows, then flip back to chronological order — a plain
    // ASC + LIMIT would replay the START of a long thread and drop what was just said.
    const res = await this.pool.query<{ role: string; content: string }>(
      `SELECT role, content FROM (
         SELECT role, content, created_at FROM agent_chat_messages
          WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2
       ) t ORDER BY created_at ASC`,
      [sessionId, limit],
    );
    return res.rows.map((r) => ({ role: r.role as StoredChatMessage['role'], content: r.content ?? '' }));
  }

  async touchSession(sessionId: string): Promise<void> {
    await this.pool.query(`UPDATE agent_chat_sessions SET updated_at = NOW() WHERE id = $1`, [sessionId]);
  }

  // ─── Automatic titles ─────────────────────────────────────────────────────

  /**
   * Give a fresh thread a real name after the first exchange.
   *
   * Runs only while the title is still automatic, and only on the first couple of
   * turns — so it costs one tiny completion per thread, not one per message. The
   * model gets a hard "≤6 words, no quotes" instruction; anything unusable falls
   * back to a truncation of the user's own first line, which is always sensible.
   */
  async maybeAutoTitle(params: {
    sessionId: string;
    tenantId: string | null;
    userMessage: string;
    assistantReply: string;
  }): Promise<string | null> {
    try {
      const row = await this.pool.query<{ auto_titled: boolean; n: number }>(
        `SELECT s.auto_titled,
                (SELECT COUNT(*) FROM agent_chat_messages m
                  WHERE m.session_id = s.id AND m.role = 'user')::int AS n
           FROM agent_chat_sessions s WHERE s.id = $1`,
        [params.sessionId],
      );
      const state = row.rows[0];
      if (!state || !state.auto_titled || state.n > 1) return null;

      const fallback = truncateTitle(params.userMessage);
      let title = fallback;
      const res = await this.llm.chat(
        params.tenantId,
        [
          {
            role: 'system',
            content:
              'You name chat threads. Reply with ONLY a title of at most 6 words that describes the topic. No quotes, no punctuation at the end, no prefix like "Title:". Use the same language as the user.',
          },
          { role: 'user', content: `${params.userMessage}\n\n---\n${params.assistantReply}`.slice(0, 1500) },
        ],
        { temperature: 0.2, max_tokens: 24 },
      );
      if (!('error' in res && res.error === true)) {
        const cleaned = cleanTitle(res.content);
        if (cleaned) title = cleaned;
      }
      await this.pool.query(
        `UPDATE agent_chat_sessions SET title = $2 WHERE id = $1 AND auto_titled = true`,
        [params.sessionId, title],
      );
      return title;
    } catch (err) {
      // A missing title is cosmetic — never fail the user's turn over it.
      this.logger.warn(`auto-title failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: string): boolean {
  return UUID_RE.test((v ?? '').trim());
}

/** First line of a message, trimmed to a title-sized string. */
export function truncateTitle(text: string, max = 60): string {
  const line = (text ?? '').replace(/\s+/g, ' ').trim();
  if (line.length <= max) return line;
  return `${line.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Strip what small models wrap titles in: surrounding quotes, a "Title:" prefix,
 * trailing punctuation, and any second line. Returns '' when nothing usable is
 * left (e.g. the model answered the question instead of naming it).
 */
export function cleanTitle(raw: string): string {
  let t = (raw ?? '').split('\n').find((l) => l.trim() !== '') ?? '';
  t = t.trim().replace(/^(title|judul)\s*[:\-]\s*/i, '');
  t = t.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '').trim();
  t = t.replace(/[.,;:!?]+$/, '').trim();
  if (!t || t.length > 80) return '';
  return t;
}
