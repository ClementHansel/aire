import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VehicleQueueService } from './vehicle-queue.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const OUTLET = '22222222-2222-2222-2222-222222222222';

/**
 * AIRIN-117: a car queued at arrival must be stored under the same canonical
 * plate the POS later searches for. Storing "B 1234 ABC" verbatim meant the
 * member lookup — which normalises before matching — could not resolve the queued
 * car to its membership, and the same vehicle showed up under two spellings
 * across the queue and its order.
 */
describe('VehicleQueueService.add — plate normalisation', () => {
  let service: VehicleQueueService;
  let pool: { query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    pool = { query: vi.fn() };
    // 1st call = next position, 2nd = the INSERT.
    pool.query.mockResolvedValueOnce({ rows: [{ next: 1 }] });
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'q1', plate: 'B1234ABC', position: 1 }] });
    service = new VehicleQueueService(pool as never);
  });

  /** Bound parameters of the INSERT. */
  const insertParams = () => {
    const call = pool.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO vehicle_queue'),
    );
    expect(call, 'no vehicle_queue INSERT issued').toBeDefined();
    return call![1] as unknown[];
  };

  it('stores a spaced plate in canonical form', async () => {
    await service.add(TENANT, { outletId: OUTLET, plate: 'b 1234 abc' });
    expect(insertParams()).toContain('B1234ABC');
    expect(insertParams()).not.toContain('b 1234 abc');
  });

  it('leaves an already-canonical plate untouched', async () => {
    await service.add(TENANT, { outletId: OUTLET, plate: 'B1234ABC' });
    expect(insertParams()).toContain('B1234ABC');
  });

  it('stores null rather than an empty string when no plate is given', async () => {
    await service.add(TENANT, { outletId: OUTLET });
    // Position 3 of the bound params is `plate`.
    expect(insertParams()[2]).toBeNull();
  });

  it('stores null for a whitespace-only plate rather than an empty string', async () => {
    // '' would be a distinct, meaningless plate value that an ILIKE search matches.
    await service.add(TENANT, { outletId: OUTLET, plate: '   ' });
    expect(insertParams()[2]).toBeNull();
  });
});
