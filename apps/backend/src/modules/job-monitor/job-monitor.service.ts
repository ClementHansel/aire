import { Injectable, Inject, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

export type JobStatus = 'ok' | 'error' | 'running' | 'unknown';

export interface JobHeartbeat {
  status: JobStatus;
  label?: string;
  detail?: string | null;
  durationMs?: number | null;
  /** Expected cadence in ms — drives the "stale" check in the admin view. */
  intervalMs?: number | null;
}

export interface JobRecord {
  jobKey: string;
  label: string;
  lastRunAt: string | null;
  lastStatus: JobStatus;
  lastDetail: string | null;
  lastDurationMs: number | null;
  intervalMs: number | null;
  runCount: number;
  errorCount: number;
  /** true when a cadence is known and the last run is older than 2× that cadence. */
  stale: boolean;
  healthy: boolean;
  updatedAt: string;
}

/**
 * Background-job heartbeats. Scheduled jobs call recordRun() each tick; the admin
 * console reads list() to see that each cron actually ran, when, and its outcome —
 * so a silently-dead job (billing, dunning, automation sweeps) becomes visible.
 *
 * Injected @Optional() everywhere so instrumenting a job never breaks its unit
 * tests (which construct services without the DI container). recordRun never
 * throws — a telemetry failure must not break the job it measures.
 */
@Injectable()
export class JobMonitorService {
  private readonly logger = new Logger(JobMonitorService.name);

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async recordRun(jobKey: string, hb: JobHeartbeat): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO system_jobs
           (job_key, label, last_run_at, last_status, last_detail, last_duration_ms, interval_ms, run_count, error_count, updated_at)
         VALUES ($1, $2, NOW(), $3::text, $4, $5, $6, 1, CASE WHEN $3::text = 'error' THEN 1 ELSE 0 END, NOW())
         ON CONFLICT (job_key) DO UPDATE SET
           label = EXCLUDED.label,
           last_run_at = NOW(),
           last_status = EXCLUDED.last_status,
           last_detail = EXCLUDED.last_detail,
           last_duration_ms = EXCLUDED.last_duration_ms,
           interval_ms = COALESCE(EXCLUDED.interval_ms, system_jobs.interval_ms),
           run_count = system_jobs.run_count + 1,
           error_count = system_jobs.error_count + CASE WHEN EXCLUDED.last_status = 'error' THEN 1 ELSE 0 END,
           updated_at = NOW()`,
        [jobKey, hb.label ?? jobKey, hb.status, hb.detail ?? null, hb.durationMs ?? null, hb.intervalMs ?? null],
      );
    } catch (e) {
      this.logger.warn(`recordRun(${jobKey}) failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * Convenience wrapper: time a job body, record ok/error with duration, and
   * re-throw so the job's own error handling is unchanged.
   */
  async track<T>(jobKey: string, label: string, intervalMs: number, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      const out = await fn();
      await this.recordRun(jobKey, { label, status: 'ok', durationMs: Date.now() - start, intervalMs });
      return out;
    } catch (e) {
      await this.recordRun(jobKey, {
        label, status: 'error', durationMs: Date.now() - start, intervalMs,
        detail: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }

  async list(): Promise<JobRecord[]> {
    const res = await this.pool.query(`SELECT * FROM system_jobs ORDER BY job_key`);
    const now = Date.now();
    return res.rows.map((x: any) => {
      const lastRunMs = x.last_run_at ? new Date(x.last_run_at).getTime() : null;
      const intervalMs = x.interval_ms != null ? Number(x.interval_ms) : null;
      const stale = !!(intervalMs && lastRunMs && now - lastRunMs > intervalMs * 2);
      return {
        jobKey: x.job_key,
        label: x.label,
        lastRunAt: x.last_run_at,
        lastStatus: x.last_status,
        lastDetail: x.last_detail,
        lastDurationMs: x.last_duration_ms,
        intervalMs,
        runCount: Number(x.run_count),
        errorCount: Number(x.error_count),
        stale,
        healthy: x.last_status === 'ok' && !stale,
        updatedAt: x.updated_at,
      };
    });
  }
}
