import { Injectable, Inject, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

export type InvocationKind = 'tool' | 'llm' | 'chat' | 'analysis';

export interface RecordInvocationInput {
  tenantId?: string | null;
  kind: InvocationKind;
  name: string;
  status: 'success' | 'error';
  durationMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * MonitoringService — records every agent/LLM/tool/chat invocation and exposes
 * aggregates for the real-time monitoring panel. Recording never throws so it
 * cannot break the operation being measured.
 */
@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async record(input: RecordInvocationInput): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO agent_invocations
          (tenant_id, kind, name, status, duration_ms, prompt_tokens, completion_tokens, error, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          input.tenantId ?? null,
          input.kind,
          input.name,
          input.status,
          input.durationMs ?? null,
          input.promptTokens ?? null,
          input.completionTokens ?? null,
          input.error ?? null,
          JSON.stringify(input.metadata ?? {}),
        ],
      );
    } catch (err) {
      this.logger.error(`Failed to record invocation: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Helper: time an async op and record it. Rethrows the original error. */
  async track<T>(
    meta: Omit<RecordInvocationInput, 'status' | 'durationMs'>,
    fn: () => Promise<T>,
  ): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      await this.record({ ...meta, status: 'success', durationMs: Date.now() - start });
      return result;
    } catch (err) {
      await this.record({
        ...meta,
        status: 'error',
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /** Aggregate summary over a recent window (default 24h) for the dashboard. */
  async summary(tenantId: string, sinceHours = 24): Promise<Record<string, unknown>> {
    const since = `${sinceHours} hours`;
    const totals = await this.pool.query<{
      kind: string;
      total: string;
      errors: string;
      avg_ms: string | null;
      prompt_tokens: string | null;
      completion_tokens: string | null;
    }>(
      `SELECT kind,
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE status = 'error') AS errors,
              AVG(duration_ms) AS avg_ms,
              SUM(prompt_tokens) AS prompt_tokens,
              SUM(completion_tokens) AS completion_tokens
       FROM agent_invocations
       WHERE tenant_id = $1 AND created_at > NOW() - $2::interval
       GROUP BY kind`,
      [tenantId, since],
    );

    const topTools = await this.pool.query<{ name: string; count: string }>(
      `SELECT name, COUNT(*) AS count
       FROM agent_invocations
       WHERE tenant_id = $1 AND kind = 'tool' AND created_at > NOW() - $2::interval
       GROUP BY name ORDER BY count DESC LIMIT 10`,
      [tenantId, since],
    );

    const byKind = totals.rows.map((r) => ({
      kind: r.kind,
      total: parseInt(r.total, 10),
      errors: parseInt(r.errors, 10),
      avgMs: r.avg_ms ? Math.round(parseFloat(r.avg_ms)) : 0,
      promptTokens: r.prompt_tokens ? parseInt(r.prompt_tokens, 10) : 0,
      completionTokens: r.completion_tokens ? parseInt(r.completion_tokens, 10) : 0,
    }));

    return {
      windowHours: sinceHours,
      totalInvocations: byKind.reduce((s, k) => s + k.total, 0),
      totalErrors: byKind.reduce((s, k) => s + k.errors, 0),
      totalTokens: byKind.reduce((s, k) => s + k.promptTokens + k.completionTokens, 0),
      byKind,
      topTools: topTools.rows.map((r) => ({ name: r.name, count: parseInt(r.count, 10) })),
    };
  }

  /** Most recent invocations (for the live feed). */
  async recent(tenantId: string, limit = 50): Promise<Record<string, unknown>[]> {
    const res = await this.pool.query(
      `SELECT id, kind, name, status, duration_ms, prompt_tokens, completion_tokens, error, created_at
       FROM agent_invocations
       WHERE tenant_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [tenantId, Math.min(limit, 200)],
    );
    return res.rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      status: r.status,
      durationMs: r.duration_ms,
      promptTokens: r.prompt_tokens,
      completionTokens: r.completion_tokens,
      error: r.error,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }));
  }
}
