import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SchedulerService, CRON_PATTERNS } from './scheduler.service';
import type { ScheduleConfig } from './scheduler.service';

/**
 * Unit tests for SchedulerService.
 *
 * Requirements: 8.1, 8.6
 */
describe('SchedulerService', () => {
  let service: SchedulerService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = new SchedulerService();
  });

  afterEach(() => {
    service.onModuleDestroy();
    vi.useRealTimers();
  });

  describe('CRON_PATTERNS', () => {
    it('should define hourly cron pattern', () => {
      expect(CRON_PATTERNS.hourly).toBe('0 * * * *');
    });

    it('should define daily cron pattern (6 AM)', () => {
      expect(CRON_PATTERNS.daily).toBe('0 6 * * *');
    });
  });

  describe('scheduleAnalysis', () => {
    it('should schedule a recurring hourly job for a tenant', () => {
      const config: ScheduleConfig = {
        tenantId: 'tenant-1',
        interval: 'hourly',
        enabled: true,
      };

      service.scheduleAnalysis(config);

      const status = service.getScheduleStatus('tenant-1');
      expect(status.scheduled).toBe(true);
      expect(status.interval).toBe('hourly');
      expect(status.lastRunAt).toBeNull();
    });

    it('should schedule a recurring daily job for a tenant', () => {
      const config: ScheduleConfig = {
        tenantId: 'tenant-2',
        interval: 'daily',
        enabled: true,
      };

      service.scheduleAnalysis(config);

      const status = service.getScheduleStatus('tenant-2');
      expect(status.scheduled).toBe(true);
      expect(status.interval).toBe('daily');
      expect(status.lastRunAt).toBeNull();
    });

    it('should cancel the job when enabled is false', () => {
      // First schedule a job
      service.scheduleAnalysis({
        tenantId: 'tenant-3',
        interval: 'hourly',
        enabled: true,
      });

      expect(service.getScheduleStatus('tenant-3').scheduled).toBe(true);

      // Now disable it
      service.scheduleAnalysis({
        tenantId: 'tenant-3',
        interval: 'hourly',
        enabled: false,
      });

      const status = service.getScheduleStatus('tenant-3');
      expect(status.scheduled).toBe(false);
      expect(status.interval).toBeNull();
      expect(status.lastRunAt).toBeNull();
    });

    it('should update interval when rescheduling an existing job', () => {
      service.scheduleAnalysis({
        tenantId: 'tenant-4',
        interval: 'hourly',
        enabled: true,
      });

      expect(service.getScheduleStatus('tenant-4').interval).toBe('hourly');

      // Update to daily
      service.scheduleAnalysis({
        tenantId: 'tenant-4',
        interval: 'daily',
        enabled: true,
      });

      expect(service.getScheduleStatus('tenant-4').interval).toBe('daily');
    });

    it('should execute the job after the hourly interval elapses', () => {
      service.scheduleAnalysis({
        tenantId: 'tenant-5',
        interval: 'hourly',
        enabled: true,
      });

      // Advance time by 1 hour
      vi.advanceTimersByTime(60 * 60 * 1000);

      const status = service.getScheduleStatus('tenant-5');
      expect(status.lastRunAt).not.toBeNull();
    });

    it('should execute the job after the daily interval elapses', () => {
      service.scheduleAnalysis({
        tenantId: 'tenant-6',
        interval: 'daily',
        enabled: true,
      });

      // Advance time by 24 hours
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);

      const status = service.getScheduleStatus('tenant-6');
      expect(status.lastRunAt).not.toBeNull();
    });

    it('should not execute before the interval elapses', () => {
      service.scheduleAnalysis({
        tenantId: 'tenant-7',
        interval: 'hourly',
        enabled: true,
      });

      // Advance time by 30 minutes (less than hourly interval)
      vi.advanceTimersByTime(30 * 60 * 1000);

      const status = service.getScheduleStatus('tenant-7');
      expect(status.lastRunAt).toBeNull();
    });

    it('should handle multiple tenants independently', () => {
      service.scheduleAnalysis({
        tenantId: 'tenant-a',
        interval: 'hourly',
        enabled: true,
      });

      service.scheduleAnalysis({
        tenantId: 'tenant-b',
        interval: 'daily',
        enabled: true,
      });

      // Advance 1 hour — only tenant-a should have run
      vi.advanceTimersByTime(60 * 60 * 1000);

      expect(service.getScheduleStatus('tenant-a').lastRunAt).not.toBeNull();
      expect(service.getScheduleStatus('tenant-b').lastRunAt).toBeNull();
    });
  });

  describe('cancelAnalysis', () => {
    it('should cancel an existing job', () => {
      service.scheduleAnalysis({
        tenantId: 'tenant-cancel',
        interval: 'hourly',
        enabled: true,
      });

      service.cancelAnalysis('tenant-cancel');

      const status = service.getScheduleStatus('tenant-cancel');
      expect(status.scheduled).toBe(false);
      expect(status.interval).toBeNull();
    });

    it('should not throw when cancelling a non-existent job', () => {
      expect(() => service.cancelAnalysis('non-existent')).not.toThrow();
    });

    it('should prevent future execution after cancellation', () => {
      service.scheduleAnalysis({
        tenantId: 'tenant-stop',
        interval: 'hourly',
        enabled: true,
      });

      service.cancelAnalysis('tenant-stop');

      // Advance time past the interval
      vi.advanceTimersByTime(2 * 60 * 60 * 1000);

      const status = service.getScheduleStatus('tenant-stop');
      expect(status.scheduled).toBe(false);
      expect(status.lastRunAt).toBeNull();
    });
  });

  describe('getScheduleStatus', () => {
    it('should return not-scheduled for unknown tenant', () => {
      const status = service.getScheduleStatus('unknown-tenant');

      expect(status).toEqual({
        scheduled: false,
        interval: null,
        lastRunAt: null,
      });
    });

    it('should return scheduled status with interval', () => {
      service.scheduleAnalysis({
        tenantId: 'tenant-status',
        interval: 'daily',
        enabled: true,
      });

      const status = service.getScheduleStatus('tenant-status');

      expect(status.scheduled).toBe(true);
      expect(status.interval).toBe('daily');
      expect(status.lastRunAt).toBeNull();
    });

    it('should update lastRunAt after job execution', () => {
      service.scheduleAnalysis({
        tenantId: 'tenant-time',
        interval: 'hourly',
        enabled: true,
      });

      const beforeRun = new Date().toISOString();
      vi.advanceTimersByTime(60 * 60 * 1000);

      const status = service.getScheduleStatus('tenant-time');
      expect(status.lastRunAt).not.toBeNull();
      // lastRunAt should be a valid ISO date string
      expect(new Date(status.lastRunAt!).toISOString()).toBe(status.lastRunAt);
    });
  });

  describe('onModuleDestroy', () => {
    it('should clean up all jobs on module destroy', () => {
      service.scheduleAnalysis({
        tenantId: 'tenant-x',
        interval: 'hourly',
        enabled: true,
      });

      service.scheduleAnalysis({
        tenantId: 'tenant-y',
        interval: 'daily',
        enabled: true,
      });

      service.onModuleDestroy();

      expect(service.getScheduleStatus('tenant-x').scheduled).toBe(false);
      expect(service.getScheduleStatus('tenant-y').scheduled).toBe(false);
    });
  });
});
