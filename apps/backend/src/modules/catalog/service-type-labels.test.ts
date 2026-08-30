import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { CatalogService } from './catalog.service';

/**
 * AIRIN-175. The point of these tests is the two rules that are easy to get
 * wrong: the code set stays closed, and "reset to default" is expressed by
 * DELETING the override rather than storing the default string back.
 */
describe('CatalogService — service type labels', () => {
  let service: CatalogService;
  let pool: { query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    pool = { query: vi.fn() };
    service = new CatalogService(pool as never);
  });

  describe('listServiceTypeLabels', () => {
    it('returns all three codes even when the tenant has renamed nothing', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      const out = await service.listServiceTypeLabels('t-1');
      expect(out.map((x) => x.code)).toEqual(['car_wash', 'add_on', 'product']);
      expect(out.every((x) => !x.customized)).toBe(true);
      expect(out[0]!.label).toBe('Car Wash');
    });

    it('marks only the renamed ones as customized', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ code: 'car_wash', label: 'Utama' }] });
      const out = await service.listServiceTypeLabels('t-1');
      expect(out.find((x) => x.code === 'car_wash')).toMatchObject({ label: 'Utama', customized: true });
      expect(out.find((x) => x.code === 'add_on')).toMatchObject({ label: 'Add-on', customized: false });
    });
  });

  describe('saveServiceTypeLabels', () => {
    it('stores a rename', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      await service.saveServiceTypeLabels('t-1', { car_wash: 'Utama' });
      const sqls = pool.query.mock.calls.map((c) => c[0] as string);
      expect(sqls.some((q) => q.includes('INSERT INTO service_type_labels'))).toBe(true);
    });

    it('DELETES the override when the label equals the built-in default', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      await service.saveServiceTypeLabels('t-1', { car_wash: 'Car Wash' });
      const sqls = pool.query.mock.calls.map((c) => c[0] as string);
      expect(sqls.some((q) => q.startsWith('DELETE FROM service_type_labels'))).toBe(true);
      expect(sqls.some((q) => q.includes('INSERT INTO'))).toBe(false);
    });

    it('DELETES the override when the label is blanked', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      await service.saveServiceTypeLabels('t-1', { add_on: '   ' });
      const sqls = pool.query.mock.calls.map((c) => c[0] as string);
      expect(sqls.some((q) => q.startsWith('DELETE FROM service_type_labels'))).toBe(true);
    });

    it('refuses a code outside the fixed set — a fourth type nothing downstream understands', async () => {
      await expect(
        service.saveServiceTypeLabels('t-1', { detailing: 'Detailing' } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a label longer than the column', async () => {
      await expect(
        service.saveServiceTypeLabels('t-1', { car_wash: 'x'.repeat(61) }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses an empty payload', async () => {
      await expect(service.saveServiceTypeLabels('t-1', {})).rejects.toThrow(BadRequestException);
    });
  });
});
