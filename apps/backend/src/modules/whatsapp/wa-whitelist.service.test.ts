import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WaWhitelistService } from './wa-whitelist.service';

/**
 * The whitelist decides who gets the FULL business agent over WhatsApp, so the
 * behaviour that matters is: one phone can only ever be ONE identity (no matter
 * how it is typed), a revoked/unknown number never matches, and tenant scoping
 * holds on every write.
 */
describe('WaWhitelistService', () => {
  let pool: { query: ReturnType<typeof vi.fn> };
  let service: WaWhitelistService;
  const TENANT = 'tenant-1';

  const row = (over: Record<string, unknown> = {}) => ({
    id: 'wl-1', phone: '628123456789', label: 'Owner', access_level: 'full',
    notes: null, is_active: true, user_id: null, last_used_at: null,
    created_at: 'now', updated_at: 'now', ...over,
  });

  beforeEach(() => {
    pool = { query: vi.fn() };
    service = new WaWhitelistService(pool as never);
  });

  describe('normalization', () => {
    // '0812…', '+62 812…' and '62812…@c.us' are the SAME staff member. Storing
    // them as written would let one phone hold three different grants.
    it.each([
      ['0812-3456-789', '628123456789'],
      ['+62 812 3456 789', '628123456789'],
      ['628123456789@c.us', '628123456789'],
    ])('stores %s as bare international digits', async (input, expected) => {
      pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // dupe check
      pool.query.mockResolvedValueOnce({ rows: [row({ phone: expected })] });

      const entry = await service.create(TENANT, { phone: input, label: 'Owner' }, 'user-1');

      expect(entry.phone).toBe(expected);
      expect(pool.query.mock.calls[1]![1]).toContain(expected);
    });

    it('rejects a number too short to be real', async () => {
      await expect(service.create(TENANT, { phone: '0812', label: 'Owner' }, null)).rejects.toThrow(BadRequestException);
      expect(pool.query).not.toHaveBeenCalled();
    });

    // normalizePhone is Indonesia-shaped; a foreign staff number must still work.
    it('accepts a long international number with no Indonesian prefix', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      pool.query.mockResolvedValueOnce({ rows: [row({ phone: '14155552671' })] });

      const entry = await service.create(TENANT, { phone: '+1 415 555 2671', label: 'Consultant' }, null);

      expect(entry.phone).toBe('14155552671');
    });

    it('requires a label so a row is never an anonymous grant', async () => {
      await expect(service.create(TENANT, { phone: '08123456789', label: '  ' }, null)).rejects.toThrow(BadRequestException);
    });

    it('rejects an unknown access level', async () => {
      await expect(
        service.create(TENANT, { phone: '08123456789', label: 'X', accessLevel: 'admin' as never }, null),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('create', () => {
    it('refuses a duplicate number', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ x: 1 }] });
      await expect(service.create(TENANT, { phone: '08123456789', label: 'Again' }, null)).rejects.toThrow(
        /already on the whitelist/,
      );
    });

    it('defaults to full access and active', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      pool.query.mockResolvedValueOnce({ rows: [row()] });

      await service.create(TENANT, { phone: '08123456789', label: 'Owner' }, 'user-1');

      const values = pool.query.mock.calls[1]![1] as unknown[];
      expect(values).toContain('full');
      expect(values).toContain(true);
    });
  });

  describe('update', () => {
    it('writes only the fields provided', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [row({ access_level: 'read_only' })] });

      await service.update(TENANT, 'wl-1', { accessLevel: 'read_only' });

      const sql = pool.query.mock.calls[0]![0] as string;
      expect(sql).toContain('access_level = $3');
      expect(sql).not.toContain('phone =');
      expect(sql).toContain('tenant_id = $2');
    });

    it('is a no-op read when nothing was provided', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [row()] });

      const entry = await service.update(TENANT, 'wl-1', {});

      expect(pool.query.mock.calls[0]![0]).toContain('SELECT *');
      expect(entry.id).toBe('wl-1');
    });

    it('404s when the row belongs to another tenant', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      await expect(service.update(TENANT, 'wl-1', { label: 'Mine now' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('404s rather than reporting a phantom delete', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 0 });
      await expect(service.remove(TENANT, 'wl-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('match', () => {
    it('matches an inbound JID against the stored digits', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [row()] });

      const found = await service.match(TENANT, '628123456789@c.us');

      expect(found?.label).toBe('Owner');
      expect(pool.query.mock.calls[0]![1]).toEqual([TENANT, '628123456789']);
    });

    // A revoked number must fall back to the CUSTOMER agent, not to no agent.
    it('only matches active rows', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      expect(await service.match(TENANT, '628123456789@c.us')).toBeNull();
      expect(pool.query.mock.calls[0]![0]).toContain('is_active = true');
    });

    it('returns null without querying for an unusable address', async () => {
      expect(await service.match(TENANT, 'status@broadcast')).toBeNull();
      expect(pool.query).not.toHaveBeenCalled();
    });
  });
});
