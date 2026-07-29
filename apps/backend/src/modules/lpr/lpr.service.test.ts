import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LprService } from './lpr.service';
import { LPR_MIN_CONFIDENCE } from '@aire/shared';

/** Raw joined-select row shape (see LprService.SELECT_WITH_MATCH), unmatched by default. */
function detectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'det-1',
    tenant_id: 'tenant-1',
    outlet_id: 'outlet-1',
    camera_id: 'cam-1',
    plate: 'B 1234 ABC',
    plate_normalized: 'B1234ABC',
    confidence: '0.9',
    captured_at: '2026-07-30T10:00:00.000Z',
    crop_image_url: null,
    source: 'hikvision',
    confirmed_plate: null,
    order_id: null,
    customer_id: null,
    customer_name: null,
    customer_phone: null,
    membership_id: null,
    membership_status: null,
    plan_name: null,
    vehicle_brand: null,
    vehicle_model: null,
    ...overrides,
  };
}

function matchedRow(overrides: Record<string, unknown> = {}) {
  return detectionRow({
    customer_id: 'cust-1',
    customer_name: 'Budi Santoso',
    customer_phone: '628111222333',
    membership_id: 'mem-1',
    membership_status: 'active',
    plan_name: 'Unlimited Wash',
    vehicle_brand: 'Toyota',
    vehicle_model: 'Avanza',
    ...overrides,
  });
}

/** Builds a pool.query mock that routes on SQL shape, matching the sibling test style. */
function makeQueryMock(opts: {
  insertReturns?: { id: string };
  findByIdRow?: Record<string, unknown> | null;
  listRows?: Record<string, unknown>[];
}) {
  return vi.fn().mockImplementation((sql: string) => {
    if (sql.includes('INSERT INTO lpr_detections')) {
      return Promise.resolve({ rows: opts.insertReturns ? [opts.insertReturns] : [] });
    }
    if (sql.includes('UPDATE lpr_detections')) {
      return Promise.resolve({ rows: [] });
    }
    // Both findById and listRecent share the same base SELECT; findById's WHERE
    // targets a single id, listRecent's filters by confirmed_plate/TTL/outlet.
    if (sql.includes('WHERE d.id = $1 AND d.tenant_id = $2')) {
      return Promise.resolve({ rows: opts.findByIdRow ? [opts.findByIdRow] : [] });
    }
    if (sql.includes('d.confirmed_plate IS NULL')) {
      return Promise.resolve({ rows: opts.listRows ?? [] });
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
}

function makeService(query: ReturnType<typeof vi.fn>) {
  const pool = { query } as never;
  const realtimeGateway = { emitPlateDetected: vi.fn() } as never;
  return { service: new LprService(pool, realtimeGateway), realtimeGateway: realtimeGateway as { emitPlateDetected: ReturnType<typeof vi.fn> } };
}

describe('LprService.ingest', () => {
  it('normalises the reported plate before storing/matching', async () => {
    const query = makeQueryMock({
      insertReturns: { id: 'det-1' },
      findByIdRow: detectionRow({ plate: 'b 1234 abc', plate_normalized: 'B1234ABC' }),
    });
    const { service } = makeService(query);

    const result = await service.ingest('tenant-1', 'outlet-1', {
      outletId: 'outlet-1',
      cameraId: 'cam-1',
      plate: 'b 1234 abc',
    });

    expect(result.plateNormalized).toBe('B1234ABC');
    const insertCall = query.mock.calls.find((c) => c[0].includes('INSERT INTO lpr_detections'));
    expect(insertCall![1]).toContain('B1234ABC');
  });

  it('rejects a plate that normalises to empty', async () => {
    const query = makeQueryMock({});
    const { service } = makeService(query);

    await expect(
      service.ingest('tenant-1', 'outlet-1', { outletId: 'outlet-1', cameraId: 'cam-1', plate: '   ' }),
    ).rejects.toThrow(BadRequestException);

    // Rejected before ever touching the database.
    expect(query).not.toHaveBeenCalled();
  });

  it('populates match when the plate is registered to a membership', async () => {
    const query = makeQueryMock({
      insertReturns: { id: 'det-1' },
      findByIdRow: matchedRow(),
    });
    const { service } = makeService(query);

    const result = await service.ingest('tenant-1', 'outlet-1', {
      outletId: 'outlet-1',
      cameraId: 'cam-1',
      plate: 'B1234ABC',
    });

    expect(result.match).toEqual({
      customerId: 'cust-1',
      customerName: 'Budi Santoso',
      customerPhone: '628111222333',
      membershipId: 'mem-1',
      membershipStatus: 'active',
      planName: 'Unlimited Wash',
      vehicleBrand: 'Toyota',
      vehicleModel: 'Avanza',
    });
  });

  it('returns match: null (but still stores) when nothing matches', async () => {
    const query = makeQueryMock({
      insertReturns: { id: 'det-1' },
      findByIdRow: detectionRow(),
    });
    const { service } = makeService(query);

    const result = await service.ingest('tenant-1', 'outlet-1', {
      outletId: 'outlet-1',
      cameraId: 'cam-1',
      plate: 'D9999ZZZ',
    });

    expect(result.match).toBeNull();
    expect(result.id).toBe('det-1');
    // Still persisted despite no match.
    expect(query.mock.calls.some((c) => c[0].includes('INSERT INTO lpr_detections'))).toBe(true);
  });

  it('emits the realtime event when confidence is at/above the threshold', async () => {
    const query = makeQueryMock({
      insertReturns: { id: 'det-1' },
      findByIdRow: detectionRow({ confidence: String(LPR_MIN_CONFIDENCE) }),
    });
    const { service, realtimeGateway } = makeService(query);

    await service.ingest('tenant-1', 'outlet-1', {
      outletId: 'outlet-1',
      cameraId: 'cam-1',
      plate: 'B1234ABC',
      confidence: LPR_MIN_CONFIDENCE,
    });

    expect(realtimeGateway.emitPlateDetected).toHaveBeenCalledTimes(1);
    expect(realtimeGateway.emitPlateDetected).toHaveBeenCalledWith(
      'outlet-1',
      expect.objectContaining({ detection: expect.objectContaining({ id: 'det-1' }) }),
    );
  });

  it('stores but does NOT emit when confidence is below the threshold', async () => {
    const lowConfidence = LPR_MIN_CONFIDENCE - 0.1;
    const query = makeQueryMock({
      insertReturns: { id: 'det-1' },
      findByIdRow: detectionRow({ confidence: String(lowConfidence) }),
    });
    const { service, realtimeGateway } = makeService(query);

    const result = await service.ingest('tenant-1', 'outlet-1', {
      outletId: 'outlet-1',
      cameraId: 'cam-1',
      plate: 'B1234ABC',
      confidence: lowConfidence,
    });

    expect(result.id).toBe('det-1'); // stored
    expect(realtimeGateway.emitPlateDetected).not.toHaveBeenCalled(); // not offered as a suggestion
  });
});

describe('LprService.listRecent', () => {
  it('passes the TTL window and outlet scope through to the query', async () => {
    const query = makeQueryMock({ listRows: [detectionRow(), matchedRow({ id: 'det-2' })] });
    const { service } = makeService(query);

    const result = await service.listRecent('tenant-1', ['outlet-1']);

    expect(result).toHaveLength(2);
    expect(result[1].match?.customerId).toBe('cust-1');
    const call = query.mock.calls.find((c) => c[0].includes('d.confirmed_plate IS NULL'));
    expect(call![1]).toEqual(['tenant-1', expect.any(Number), ['outlet-1']]);
  });

  it('returns nothing when the caller has no assigned outlets ([])', async () => {
    const query = makeQueryMock({ listRows: [] });
    const { service } = makeService(query);

    const result = await service.listRecent('tenant-1', []);

    expect(result).toEqual([]);
    const call = query.mock.calls.find((c) => c[0].includes('d.confirmed_plate IS NULL'));
    expect(call![1][2]).toEqual([]);
  });

  it('filters by the TTL/confirmed-plate query itself (not client-side)', async () => {
    // The service trusts the SQL WHERE clause to enforce TTL + confirmed
    // exclusion; this asserts that clause shape is actually present.
    const query = makeQueryMock({ listRows: [] });
    const { service } = makeService(query);

    await service.listRecent('tenant-1', null);

    const call = query.mock.calls.find((c) => c[0].includes('d.confirmed_plate IS NULL'));
    expect(call![0]).toContain('d.captured_at >= NOW() - make_interval(secs => $2)');
    expect(call![1][2]).toBeNull();
  });
});

describe('LprService.confirm', () => {
  it('stamps confirmed_plate + order_id so it is consumed exactly once', async () => {
    const query = makeQueryMock({
      findByIdRow: detectionRow(), // first call: existence check; second: post-update read
    });
    // Override findById's second read to reflect the update.
    query.mockImplementation((sql: string, params?: unknown[]) => {
      if (sql.includes('UPDATE lpr_detections')) return Promise.resolve({ rows: [] });
      if (sql.includes('WHERE d.id = $1 AND d.tenant_id = $2')) {
        return Promise.resolve({
          rows: [detectionRow({ confirmed_plate: 'B1234ABC', order_id: 'order-9' })],
        });
      }
      throw new Error(`Unexpected query: ${sql} ${JSON.stringify(params)}`);
    });
    const { service } = makeService(query);

    const result = await service.confirm('tenant-1', null, 'det-1', { orderId: 'order-9' });

    expect(result.confirmedPlate).toBe('B1234ABC');
    expect(result.orderId).toBe('order-9');
    const updateCall = query.mock.calls.find((c) => c[0].includes('UPDATE lpr_detections'));
    // No explicit `plate` in the confirm body -> defaults to the AS-REPORTED
    // plate stored on the detection (not the normalized form).
    expect(updateCall![1]).toEqual(['det-1', 'tenant-1', 'B 1234 ABC', 'order-9']);
  });

  it('404s when the detection does not exist for this tenant', async () => {
    const query = makeQueryMock({ findByIdRow: null });
    const { service } = makeService(query);

    await expect(service.confirm('tenant-1', null, 'missing', {})).rejects.toThrow(NotFoundException);
  });

  it('404s when the detection is outside the caller\'s assigned outlets', async () => {
    const query = makeQueryMock({ findByIdRow: detectionRow({ outlet_id: 'outlet-2' }) });
    const { service } = makeService(query);

    await expect(service.confirm('tenant-1', ['outlet-1'], 'det-1', {})).rejects.toThrow(NotFoundException);
  });
});
