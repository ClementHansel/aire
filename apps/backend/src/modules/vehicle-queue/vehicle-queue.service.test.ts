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

  it('starts service on arrival instead of waiting for a Start tap (AIRIN-170)', async () => {
    await service.add(TENANT, { outletId: OUTLET, plate: 'B1234ABC' });
    const sql = String(pool.query.mock.calls.find(([s]) => String(s).includes('INSERT INTO vehicle_queue'))![0]);
    expect(sql).toContain("'serving'");
    expect(sql).toContain('started_at');
  });
});

/**
 * AIRIN-170/171: the board shows ONE stage, and it clears itself at midnight
 * without losing the account of what happened to a car nobody served.
 */
describe('VehicleQueueService — board stage and end-of-day close', () => {
  let service: VehicleQueueService;
  let pool: { query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    pool = { query: vi.fn() };
    service = new VehicleQueueService(pool as never);
  });

  const row = (over: Record<string, unknown> = {}) => ({
    id: 'q1', plate: 'B1234ABC', status: 'serving', position: 1,
    created_at: '2026-08-08T01:00:00Z', started_at: '2026-08-08T01:00:00Z',
    payment_status: 'unpaid', order_id: null, ...over,
  });

  it('reports waiting_payment / paid / done as the single stage', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        row(),
        row({ id: 'q2', payment_status: 'paid', order_id: 'o1' }),
        row({ id: 'q3', status: 'done', payment_status: 'paid', order_id: 'o2' }),
      ],
    });

    const list = await service.list(TENANT, OUTLET, true);
    expect(list.map((e) => e.stage)).toEqual(['waiting_payment', 'paid', 'done']);
  });

  it('records arrival → payment as the service duration', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [row({ payment_status: 'paid', order_id: 'o1', paid_at: '2026-08-08T01:30:00Z' })],
    });

    const [entry] = await service.list(TENANT, OUTLET);
    expect(entry!.serviceSeconds).toBe(30 * 60);
  });

  it('closes out open entries with a reason instead of deleting them', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT, outlet_id: OUTLET }], rowCount: 1 });

    const closed = await service.closeOutOpenEntries('End of day');
    expect(closed).toBe(1);

    const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
    // Kept as rows, marked auto-closed, and carrying WHY — never DELETEd.
    expect(sql).toContain('UPDATE vehicle_queue');
    expect(sql).not.toContain('DELETE');
    expect(sql).toContain('auto_closed = true');
    expect(sql).toContain('close_reason');
    expect(sql).toContain("status IN ('waiting','serving')");
    expect(params).toContain('End of day');
  });

  it('keeps a cashier-supplied reason when a car is taken off the board', async () => {
    pool.query.mockResolvedValueOnce({ rows: [row({ status: 'cancelled', outlet_id: OUTLET })] });

    await service.setStatus(TENANT, 'q1', 'cancelled', 'Pelanggan pergi');

    const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('close_reason');
    expect(params).toContain('Pelanggan pergi');
  });
});
