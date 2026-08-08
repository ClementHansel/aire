import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { VehicleQueueService } from './vehicle-queue.service';
import { JobMonitorService } from '../job-monitor/job-monitor.service';

/** Jakarta is UTC+7 and observes no DST, so a fixed offset is exact here. */
const WIB_OFFSET_MINUTES = 7 * 60;

/**
 * Clears the arrival queue at 00:00 WIB, every day.
 *
 * The board is a record of one trading day. Left alone it accumulated cars that
 * were never rung up — pushing the next day's positions along, and quietly
 * turning "12 in queue" into a number nobody trusted. Closing them out is not a
 * deletion: `closeOutOpenEntries` writes a reason onto every row it touches, so
 * an unserved car remains answerable for the next morning (AIRIN-171).
 *
 * Deliberately a plain timer rather than @nestjs/schedule: every other periodic
 * job in this backend (membership lifecycle, finance automation, feedback sweep)
 * is written the same way, and adding a scheduler dependency for one cron would
 * make this the odd one out.
 */
@Injectable()
export class QueueDailyCloseService implements OnModuleInit {
  private readonly logger = new Logger(QueueDailyCloseService.name);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(
    private readonly queue: VehicleQueueService,
    @Optional() private readonly jobMonitor?: JobMonitorService,
  ) {}

  onModuleInit(): void {
    this.scheduleNext();
  }

  /** Milliseconds from `now` until the next 00:00 in Jakarta. */
  static msUntilNextMidnightWib(now: Date = new Date()): number {
    const wibNow = new Date(now.getTime() + WIB_OFFSET_MINUTES * 60_000);
    const nextWibMidnight = Date.UTC(
      wibNow.getUTCFullYear(), wibNow.getUTCMonth(), wibNow.getUTCDate() + 1, 0, 0, 0, 0,
    );
    // Back out of WIB into real time to get the delay from `now`.
    const ms = nextWibMidnight - WIB_OFFSET_MINUTES * 60_000 - now.getTime();
    // A zero/negative delay would spin; one full day is the correct fallback.
    return ms > 0 ? ms : 24 * 60 * 60 * 1000;
  }

  private scheduleNext(): void {
    const delay = QueueDailyCloseService.msUntilNextMidnightWib();
    this.timer = setTimeout(() => {
      void this.runOnce().finally(() => this.scheduleNext());
    }, delay);
    // Never hold the process open for a queue sweep.
    this.timer.unref?.();
  }

  /** One close-out pass. Public so an operator/test can trigger it directly. */
  async runOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    const started = Date.now();
    try {
      const closed = await this.queue.closeOutOpenEntries();
      if (closed > 0) this.logger.log(`End-of-day queue close: ${closed} entr(ies) closed out`);
      void this.jobMonitor?.recordRun('queue-daily-close', {
        label: 'Vehicle queue end-of-day close',
        status: 'ok',
        durationMs: Date.now() - started,
        intervalMs: 24 * 60 * 60 * 1000,
        detail: `${closed} entr(ies) closed out`,
      });
      return closed;
    } catch (e) {
      this.logger.warn(`End-of-day queue close failed: ${e}`);
      void this.jobMonitor?.recordRun('queue-daily-close', {
        label: 'Vehicle queue end-of-day close',
        status: 'error',
        durationMs: Date.now() - started,
        intervalMs: 24 * 60 * 60 * 1000,
        detail: String(e),
      });
      return 0;
    } finally {
      this.running = false;
    }
  }
}
