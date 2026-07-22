import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { ScheduledAnalysisService } from './scheduled-analysis.service';
import { JobMonitorService } from '../job-monitor';

/**
 * Schedule configuration for a tenant's periodic AI analysis.
 */
export interface ScheduleConfig {
  tenantId: string;
  interval: 'hourly' | 'daily';
  enabled: boolean;
}

/**
 * Status of a tenant's scheduled analysis.
 */
export interface ScheduleStatus {
  scheduled: boolean;
  interval: string | null;
  lastRunAt: string | null;
}

/**
 * Internal representation of a scheduled job.
 */
interface ScheduledJob {
  tenantId: string;
  interval: 'hourly' | 'daily';
  timer: ReturnType<typeof setInterval>;
  lastRunAt: string | null;
}

/**
 * Cron pattern reference (for documentation and future Redis locking):
 * - hourly: '0 * * * *'
 * - daily:  '0 6 * * *' (6 AM daily)
 */
const INTERVAL_MS: Record<'hourly' | 'daily', number> = {
  hourly: 60 * 60 * 1000, // 1 hour
  daily: 24 * 60 * 60 * 1000, // 24 hours
};

/**
 * Cron patterns for each interval (stored for future Redis-backed scheduling).
 */
export const CRON_PATTERNS: Record<'hourly' | 'daily', string> = {
  hourly: '0 * * * *',
  daily: '0 6 * * *',
};

/**
 * Scheduler Service.
 *
 * Manages periodic AI analysis jobs for tenants using in-memory scheduling.
 * Uses setInterval for recurring execution with configurable hourly/daily intervals.
 *
 * In production, this should be backed by Redis locking (e.g., BullMQ) to ensure
 * only one instance processes each tenant's scheduled analysis in a multi-node deployment.
 *
 * Requirements: 8.1, 8.6
 */
@Injectable()
export class SchedulerService implements OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly jobs = new Map<string, ScheduledJob>();

  private scheduledAnalysisService: ScheduledAnalysisService | null = null;

  constructor(@Optional() private readonly jobMonitor?: JobMonitorService) {}

  /**
   * Set the ScheduledAnalysisService reference.
   * Called during module init to avoid circular dependency.
   */
  setScheduledAnalysisService(service: ScheduledAnalysisService): void {
    this.scheduledAnalysisService = service;
  }

  /**
   * Cleanup all scheduled jobs when the module is destroyed.
   */
  onModuleDestroy(): void {
    for (const [tenantId] of this.jobs) {
      this.cancelAnalysis(tenantId);
    }
  }

  /**
   * Schedule or update a recurring analysis job for a tenant.
   *
   * If `config.enabled` is true, creates/updates a recurring job at the specified interval.
   * If `config.enabled` is false, cancels any existing job for the tenant.
   *
   * Requirement: 8.1
   */
  scheduleAnalysis(config: ScheduleConfig): void {
    const { tenantId, interval, enabled } = config;

    if (!enabled) {
      this.cancelAnalysis(tenantId);
      return;
    }

    // Cancel existing job if present (to update interval)
    const existingJob = this.jobs.get(tenantId);
    if (existingJob) {
      clearInterval(existingJob.timer);
      this.logger.log(
        `Updating scheduled analysis for tenant ${tenantId}: ${existingJob.interval} → ${interval}`,
      );
    } else {
      this.logger.log(
        `Scheduling analysis for tenant ${tenantId} at interval: ${interval} (cron: ${CRON_PATTERNS[interval]})`,
      );
    }

    const intervalMs = INTERVAL_MS[interval];
    const timer = setInterval(() => {
      this.runJob(tenantId);
    }, intervalMs);

    this.jobs.set(tenantId, {
      tenantId,
      interval,
      timer,
      lastRunAt: existingJob?.lastRunAt ?? null,
    });
  }

  /**
   * Cancel and remove all scheduled jobs for a tenant.
   *
   * Requirement: 8.6
   */
  cancelAnalysis(tenantId: string): void {
    const job = this.jobs.get(tenantId);
    if (job) {
      clearInterval(job.timer);
      this.jobs.delete(tenantId);
      this.logger.log(`Cancelled scheduled analysis for tenant ${tenantId}`);
    }
  }

  /**
   * Get the current schedule status for a tenant.
   *
   * Returns whether a job is scheduled, the interval, and last run time.
   */
  getScheduleStatus(tenantId: string): ScheduleStatus {
    const job = this.jobs.get(tenantId);
    if (!job) {
      return {
        scheduled: false,
        interval: null,
        lastRunAt: null,
      };
    }

    return {
      scheduled: true,
      interval: job.interval,
      lastRunAt: job.lastRunAt,
    };
  }

  /**
   * Execute the scheduled job for a tenant.
   * Calls ScheduledAnalysisService.runScheduledAnalysis to perform the actual analysis.
   *
   * Requirement: 8.2
   */
  private runJob(tenantId: string): void {
    const job = this.jobs.get(tenantId);
    if (!job) return;

    const now = new Date().toISOString();
    job.lastRunAt = now;

    this.logger.log(
      `Running scheduled analysis for tenant ${tenantId} at ${now}`,
    );

    if (this.scheduledAnalysisService) {
      const start = Date.now();
      this.scheduledAnalysisService.runScheduledAnalysis(tenantId)
        .then((run) => {
          // Heartbeat so the scheduled-analysis loop is visible in the job monitor
          // even when it skips (AI off / no automation toggles enabled).
          void this.jobMonitor?.recordRun('scheduled-ai-analysis', {
            label: 'Scheduled AI analysis', status: 'ok',
            detail: run ? `tenant ${tenantId}: ${run.insights_found ?? 0} insight(s)` : `tenant ${tenantId}: skipped (AI off / no toggles)`,
            durationMs: Date.now() - start,
          });
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : 'Unknown error';
          this.logger.error(`Scheduled analysis failed for tenant ${tenantId}: ${message}`);
          void this.jobMonitor?.recordRun('scheduled-ai-analysis', {
            label: 'Scheduled AI analysis', status: 'error', detail: `tenant ${tenantId}: ${message}`,
            durationMs: Date.now() - start,
          });
        });
    } else {
      this.logger.warn(
        `ScheduledAnalysisService not wired — skipping analysis for tenant ${tenantId}`,
      );
    }
  }
}
