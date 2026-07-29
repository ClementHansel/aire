import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractPlate, extractConfidence, forwardDetection } from './lpr';

/**
 * The bridge must accept a plate event from a device nobody has picked yet, so
 * these tests pin the tolerance: differing field names, nested vendor envelopes,
 * and 0..1 vs 0..100 confidence scales. A device that needs a change here should
 * be the rare exception, not the norm.
 */
describe('extractPlate', () => {
  it('reads the common field names', () => {
    for (const key of ['plate', 'plateNumber', 'licensePlate', 'plateNo', 'PlateNumber', 'license_plate']) {
      expect(extractPlate({ [key]: 'B1234ABC' }), key).toBe('B1234ABC');
    }
  });

  it('digs through vendor envelopes', () => {
    expect(extractPlate({ data: { plateNumber: 'B1234ABC' } })).toBe('B1234ABC');
    expect(extractPlate({ event: { licensePlate: 'D5678XYZ' } })).toBe('D5678XYZ');
    // Hikvision-style nesting.
    expect(extractPlate({ AlarmInfo: { plateResult: { plate: 'B9012QWE' } } })).toBe('B9012QWE');
  });

  it('preserves the device spelling — the CLOUD normalises, not the bridge', () => {
    // Normalising here too would hide what the device actually reported, which
    // is the first thing to look at when a read is wrong.
    expect(extractPlate({ plate: 'B 1234 ABC' })).toBe('B 1234 ABC');
  });

  it('trims incidental whitespace', () => {
    expect(extractPlate({ plate: '  B1234ABC  ' })).toBe('B1234ABC');
  });

  it('returns null when there is no plate at all', () => {
    expect(extractPlate({ temperature: 30 })).toBeNull();
    expect(extractPlate({ plate: '' })).toBeNull();
    expect(extractPlate({ plate: '   ' })).toBeNull();
    expect(extractPlate(null)).toBeNull();
    expect(extractPlate('nonsense')).toBeNull();
  });
});

describe('extractConfidence', () => {
  it('accepts a 0..1 score as-is', () => {
    expect(extractConfidence({ confidence: 0.87 })).toBeCloseTo(0.87);
  });

  it('rescales a 0..100 score', () => {
    // Vendors disagree on the scale; 87 must not read as "extremely confident".
    expect(extractConfidence({ confidence: 87 })).toBeCloseTo(0.87);
    expect(extractConfidence({ score: 100 })).toBeCloseTo(1);
  });

  it('reads alternate names and nested envelopes', () => {
    expect(extractConfidence({ reliability: 0.5 })).toBeCloseTo(0.5);
    expect(extractConfidence({ data: { score: 90 } })).toBeCloseTo(0.9);
  });

  it('is undefined when absent or non-numeric, rather than guessing', () => {
    expect(extractConfidence({ plate: 'B1' })).toBeUndefined();
    expect(extractConfidence({ confidence: 'high' })).toBeUndefined();
  });

  it('never returns a negative confidence', () => {
    expect(extractConfidence({ confidence: -0.3 })).toBe(0);
  });
});

describe('forwardDetection', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('POSTs to the cloud with the bridge token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, text: async () => '{}' });
    vi.stubGlobal('fetch', fetchMock);

    await forwardDetection('https://cloud.test', 'tok-123', {
      outletId: 'o1', cameraId: 'cam1', plate: 'B1234ABC',
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://cloud.test/api/lpr/detections');
    // Header name must match LprBridgeGuard on the cloud exactly.
    expect((init.headers as Record<string, string>)['X-Aire-Bridge-Token']).toBe('tok-123');
    expect(JSON.parse(init.body as string).plate).toBe('B1234ABC');
  });

  it('never throws when the LAN or cloud is down', async () => {
    // A branch link drops constantly; losing a plate is acceptable, crashing the
    // agent (and with it CCTV + IoT) is not.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(forwardDetection('https://cloud.test', 't', {
      outletId: 'o1', cameraId: 'c', plate: 'B1',
    })).resolves.toEqual({ ok: false, status: 0 });
  });

  it('reports a rejection without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'nope' }));
    const r = await forwardDetection('https://cloud.test', 'bad', {
      outletId: 'o1', cameraId: 'c', plate: 'B1',
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });
});
