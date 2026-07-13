import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AccountingService } from './accounting.service';

/**
 * Unit tests for the ledger's core invariants — the double-entry balance rule and
 * the closed-period guard. These validations run before any DB access (except the
 * period check, which is a single query), so they need minimal mocking. Full
 * posting / trial-balance / closing-entry behavior is covered by the live E2E.
 */
describe('AccountingService', () => {
  let service: AccountingService;
  let mockPool: { query: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = { query: vi.fn(), connect: vi.fn() };
    service = new AccountingService(mockPool as never);
  });

  const line = (accountCode: string, debit = 0, credit = 0) => ({ accountCode, debit, credit });

  describe('postEntry validation (no DB access)', () => {
    it('rejects an entry with fewer than two lines', async () => {
      await expect(service.postEntry('t1', { lines: [line('1000', 100)] }))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('rejects a zero-total entry', async () => {
      await expect(service.postEntry('t1', { lines: [line('1000', 0), line('3000', 0)] }))
        .rejects.toThrow(/positive/i);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('rejects an unbalanced entry (debit ≠ credit)', async () => {
      await expect(service.postEntry('t1', { lines: [line('1000', 100), line('3000', 0, 50)] }))
        .rejects.toThrow(/unbalanced/i);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('accepts a balanced entry past validation (reaches the period check)', async () => {
      // Balanced → validation passes → it queries the period lock. Return "closed"
      // to short-circuit before the transaction, proving it got past balancing.
      mockPool.query.mockResolvedValueOnce({ rows: [{ status: 'closed' }] });
      await expect(service.postEntry('t1', { entryDate: '2026-07-10', lines: [line('1000', 100), line('3000', 0, 100)] }))
        .rejects.toThrow(/closed/i);
      expect(mockPool.query).toHaveBeenCalledTimes(1); // the period-lock check
    });
  });

  describe('closed-period guard', () => {
    it('rejects posting into a closed period', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ status: 'closed' }] });
      await expect(service.postEntry('t1', { entryDate: '2026-06-15', lines: [line('1000', 500), line('4000', 0, 500)] }))
        .rejects.toThrow(/2026-06 is closed/);
    });

    it('allows posting into an open period (no row) — proceeds to the transaction', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // period lock: open
      // Minimal client so the transaction path can run without a real DB.
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ rows: [{ id: 'acc-1', code: '1000' }, { id: 'acc-2', code: '4000' }] }) // accountIdMap
          .mockResolvedValueOnce({ rows: [{ id: 'entry-1' }] }) // INSERT journal_entries
          .mockResolvedValue({}), // INSERT lines + COMMIT
        release: vi.fn(),
      };
      mockPool.connect.mockResolvedValueOnce(client);
      const res = await service.postEntry('t1', { entryDate: '2026-07-10', lines: [line('1000', 500), line('4000', 0, 500)] });
      expect(res.skipped).toBe(false);
      expect(res.id).toBe('entry-1');
      const sqls = client.query.mock.calls.map((c) => String(c[0]));
      expect(sqls.some((s) => s.includes('BEGIN'))).toBe(true);
      expect(sqls.some((s) => s.includes('INSERT INTO journal_entries'))).toBe(true);
      expect(sqls.some((s) => s.includes('COMMIT'))).toBe(true);
    });
  });

  describe('setPeriod validation', () => {
    it('rejects a malformed period', async () => {
      await expect(service.setPeriod('t1', '2026/07', 'closed')).rejects.toThrow(/YYYY-MM/);
    });
    it('rejects an invalid status', async () => {
      await expect(service.setPeriod('t1', '2026-07', 'frozen' as never)).rejects.toThrow(/open or closed/);
    });
  });
});
