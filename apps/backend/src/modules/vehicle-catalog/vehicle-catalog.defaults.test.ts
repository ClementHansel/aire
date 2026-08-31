import { describe, it, expect, vi, beforeEach } from 'vitest';
import { seedDefaultVehicleCatalog } from './vehicle-catalog.defaults';

/**
 * Regression guard for the empty-catalog bug.
 *
 * Migrations 035/036 seeded the vehicle catalog with `SELECT ... FROM tenants`,
 * a one-shot back-fill of the tenants alive on 2026-07-10. Provisioning never
 * seeded it, so every tenant created afterwards found the Vehicle Catalog page
 * and the POS brand/model pickers empty and reported it as lost data.
 *
 * Two properties matter here and neither is obvious from the call site: the
 * seed must actually run for a fresh tenant, and it must NOT run for a tenant
 * that already has brands — someone who pruned the list to the two marques they
 * wash must not watch 35 grow back.
 */
describe('seedDefaultVehicleCatalog', () => {
  let pool: { query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    pool = { query: vi.fn() };
  });

  it('fills brands and models for a tenant with an empty catalog', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })  // existing-brand probe: none
      .mockResolvedValueOnce({ rows: [], rowCount: 35 }) // brands inserted
      .mockResolvedValueOnce({ rows: [], rowCount: 202 }); // models inserted

    await expect(seedDefaultVehicleCatalog(pool as never, 't-1')).resolves.toBe(35);

    expect(pool.query).toHaveBeenCalledTimes(3);
    // Both writes copy from the single template table rather than an inline
    // list, so the seed cannot drift from the migration's back-fill.
    expect(pool.query.mock.calls[1][0]).toContain('vehicle_catalog_defaults');
    expect(pool.query.mock.calls[2][0]).toContain('vehicle_catalog_defaults');
    expect(pool.query.mock.calls[1][0]).toContain('INSERT INTO vehicle_brands');
    expect(pool.query.mock.calls[2][0]).toContain('INSERT INTO vehicle_types');
  });

  it('is a no-op when the tenant already has brands, so a pruned list stays pruned', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 });

    await expect(seedDefaultVehicleCatalog(pool as never, 't-1')).resolves.toBe(0);

    expect(pool.query).toHaveBeenCalledTimes(1); // probed, then stopped
  });

  it('scopes every write to the tenant it was asked to seed', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 35 })
      .mockResolvedValueOnce({ rows: [], rowCount: 202 });

    await seedDefaultVehicleCatalog(pool as never, 'tenant-abc');

    for (const call of pool.query.mock.calls) {
      expect(call[1]).toEqual(['tenant-abc']);
    }
  });
});
