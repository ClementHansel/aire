import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { BusinessUnitService } from './business-unit.service';

/**
 * AIRIN-176. Migration 096 dropped the CHECK constraints that used to be the
 * only thing stopping a junk value landing in a `business_unit` column, so the
 * guarantee now lives in this service. These tests are about that handover:
 * validation, and the refusal to delete a unit history still points at.
 */
describe('BusinessUnitService', () => {
  let service: BusinessUnitService;
  let pool: { query: ReturnType<typeof vi.fn> };

  const row = {
    id: 'bu-1', tenant_id: 't-1', code: 'AIRE', name: 'AIRE',
    color: '#0ea5e9', sort_order: 0, is_active: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    pool = { query: vi.fn() };
    service = new BusinessUnitService(pool as never);
  });

  describe('assertValid — the replacement for the dropped CHECK', () => {
    it('accepts a code the tenant owns', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
      await expect(service.assertValid('t-1', 'AIRE')).resolves.toBeUndefined();
    });

    it('rejects a code the tenant does not own, and names the ones they do', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })                       // lookup misses
        .mockResolvedValueOnce({ rows: [row, { ...row, code: 'LEAD' }] }); // list for the message
      await expect(service.assertValid('t-1', 'NOPE')).rejects.toThrow(BadRequestException);
    });

    it('normalizes case before looking up, so "aire" is not a different unit', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
      await service.assertValid('t-1', 'aire');
      expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['t-1', 'AIRE']);
    });
  });

  describe('create', () => {
    it('uppercases the code and trims the name', async () => {
      pool.query.mockResolvedValueOnce({ rows: [row] });
      await service.create('t-1', { code: ' wrap ', name: '  Wrapping  ' });
      expect(pool.query).toHaveBeenCalledWith(
        expect.any(String),
        ['t-1', 'WRAP', 'Wrapping', '#1652F0', 0],
      );
    });

    it('rejects a code with characters the business_unit columns should never hold', async () => {
      await expect(service.create('t-1', { code: 'A B', name: 'x' })).rejects.toThrow(BadRequestException);
    });

    it('rejects a code longer than the column', async () => {
      await expect(service.create('t-1', { code: 'ABCDEFGHIJK', name: 'x' })).rejects.toThrow(BadRequestException);
    });

    it('rejects a blank name', async () => {
      await expect(service.create('t-1', { code: 'WRAP', name: '   ' })).rejects.toThrow(BadRequestException);
    });

    it('turns a unique violation into a clear conflict', async () => {
      pool.query.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
      await expect(service.create('t-1', { code: 'AIRE', name: 'AIRE' })).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('refuses while rows still carry the code, rather than orphaning history', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ code: 'AIRE' }] })  // the unit exists
        .mockResolvedValueOnce({ rows: [{ total: '7' }] });   // and is in use
      await expect(service.remove('t-1', 'bu-1')).rejects.toThrow(ConflictException);
      // The DELETE must not have been attempted.
      expect(pool.query).toHaveBeenCalledTimes(2);
    });

    it('deletes when nothing references it', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ code: 'WRAP' }] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rowCount: 1 });
      await expect(service.remove('t-1', 'bu-9')).resolves.toBeUndefined();
      expect(pool.query).toHaveBeenCalledTimes(3);
    });

    it('404s on a unit that is not this tenant’s', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      await expect(service.remove('t-1', 'bu-x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('has no path to change the code — history would stop matching', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ ...row, name: 'Car Wash' }] });
      await service.update('t-1', 'bu-1', { name: 'Car Wash' } as never);
      const [sql] = pool.query.mock.calls[0] as [string];
      expect(sql).not.toMatch(/\bcode\s*=/);
    });

    it('rejects an empty patch', async () => {
      await expect(service.update('t-1', 'bu-1', {})).rejects.toThrow(BadRequestException);
    });
  });
});
