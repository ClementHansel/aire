import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';

function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    legal: '0', branch: '0', service: '0', staff: '0',
    onboarding_completed_at: null, onboarding_state: {},
    ...over,
  };
}

describe('OnboardingService', () => {
  let pool: { query: ReturnType<typeof vi.fn> };
  let service: OnboardingService;

  beforeEach(() => {
    pool = { query: vi.fn() };
    service = new OnboardingService(pool as any);
  });

  describe('getStatus', () => {
    it('derives each step from real counts and computes the mandatory gate', async () => {
      pool.query.mockResolvedValueOnce({ rows: [row({ legal: '1', branch: '2', service: '3', staff: '0' })] });
      const s = await service.getStatus('t1');
      expect(s.steps.legal.done).toBe(true);
      expect(s.steps.branch.count).toBe(2);
      expect(s.steps.service.done).toBe(true);
      expect(s.steps.staff.done).toBe(false);
      expect(s.mandatoryComplete).toBe(true);
      expect(s.completedAt).toBeNull();
    });

    it('mandatory is incomplete when any of legal/branch/service is missing', async () => {
      pool.query.mockResolvedValueOnce({ rows: [row({ legal: '1', branch: '1', service: '0' })] });
      const s = await service.getStatus('t1');
      expect(s.mandatoryComplete).toBe(false);
    });
  });

  describe('complete', () => {
    it('refuses to complete until the mandatory steps are done', async () => {
      pool.query.mockResolvedValueOnce({ rows: [row({ legal: '1', branch: '0', service: '1' })] });
      await expect(service.complete('t1')).rejects.toBeInstanceOf(BadRequestException);
      expect(pool.query).toHaveBeenCalledTimes(1); // only the status read; no UPDATE
    });

    it('marks completion once the mandatory steps are satisfied', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [row({ legal: '1', branch: '1', service: '1' })] }) // getStatus (pre)
        .mockResolvedValueOnce({ rows: [] }) // UPDATE
        .mockResolvedValueOnce({ rows: [row({ legal: '1', branch: '1', service: '1', onboarding_completed_at: new Date() })] }); // getStatus (post)
      const s = await service.complete('t1');
      expect(s.completedAt).not.toBeNull();
      expect(pool.query).toHaveBeenCalledTimes(3);
    });

    it('is idempotent — re-completing does not issue another UPDATE', async () => {
      pool.query.mockResolvedValueOnce({ rows: [row({ legal: '1', branch: '1', service: '1', onboarding_completed_at: new Date() })] });
      const s = await service.complete('t1');
      expect(s.completedAt).not.toBeNull();
      expect(pool.query).toHaveBeenCalledTimes(1); // early return, no UPDATE
    });
  });
});
