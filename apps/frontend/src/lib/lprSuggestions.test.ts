/**
 * Unit tests for the LPR suggestion-offering logic (AIRIN-25, POS half).
 * Focus: only confidence >= LPR_MIN_CONFIDENCE and within
 * LPR_SUGGESTION_TTL_SECONDS are offered, already-confirmed detections are
 * dropped defensively, and upsertDetection dedupes by id instead of growing
 * duplicates on re-fetch/reconnect replay.
 */
import { describe, it, expect } from 'vitest';
import { filterOfferableDetections, upsertDetection, minutesAgoLabel } from './lprSuggestions';
import { LPR_MIN_CONFIDENCE, LPR_SUGGESTION_TTL_SECONDS, type PlateDetection } from '@aire/shared';

function makeDetection(overrides: Partial<PlateDetection> = {}): PlateDetection {
  return {
    id: 'd1',
    outletId: 'outlet-1',
    cameraId: 'cam-1',
    plate: 'B 1234 ABC',
    plateNormalized: 'B1234ABC',
    confidence: 0.9,
    capturedAt: new Date().toISOString(),
    cropImageUrl: null,
    source: 'test-device',
    match: null,
    confirmedPlate: null,
    orderId: null,
    ...overrides,
  };
}

describe('filterOfferableDetections', () => {
  it('keeps a fresh, high-confidence, unconfirmed detection', () => {
    const d = makeDetection();
    expect(filterOfferableDetections([d])).toEqual([d]);
  });

  it('drops a detection below the confidence floor', () => {
    const d = makeDetection({ confidence: LPR_MIN_CONFIDENCE - 0.01 });
    expect(filterOfferableDetections([d])).toEqual([]);
  });

  it('keeps a detection exactly at the confidence floor', () => {
    const d = makeDetection({ confidence: LPR_MIN_CONFIDENCE });
    expect(filterOfferableDetections([d])).toEqual([d]);
  });

  it('drops a detection older than the TTL', () => {
    const staleIso = new Date(Date.now() - (LPR_SUGGESTION_TTL_SECONDS + 60) * 1000).toISOString();
    const d = makeDetection({ capturedAt: staleIso });
    expect(filterOfferableDetections([d])).toEqual([]);
  });

  it('keeps a detection just inside the TTL', () => {
    const freshIso = new Date(Date.now() - (LPR_SUGGESTION_TTL_SECONDS - 60) * 1000).toISOString();
    const d = makeDetection({ capturedAt: freshIso });
    expect(filterOfferableDetections([d])).toEqual([d]);
  });

  it('drops a detection already confirmed onto an order', () => {
    const d = makeDetection({ orderId: 'order-1', confirmedPlate: 'B1234ABC' });
    expect(filterOfferableDetections([d])).toEqual([]);
  });

  it('drops a detection with a confirmedPlate even if orderId is still null', () => {
    // Defensive: the documented contract is GET returns only unconfirmed rows,
    // but a stale poll response should never re-offer an actioned detection.
    const d = makeDetection({ confirmedPlate: 'B1234ABC' });
    expect(filterOfferableDetections([d])).toEqual([]);
  });

  it('filters a mixed batch down to only the offerable ones', () => {
    const good = makeDetection({ id: 'good' });
    const lowConfidence = makeDetection({ id: 'low', confidence: 0.1 });
    const stale = makeDetection({ id: 'stale', capturedAt: new Date(Date.now() - 3600_000).toISOString() });
    const confirmed = makeDetection({ id: 'confirmed', orderId: 'order-9' });
    expect(filterOfferableDetections([good, lowConfidence, stale, confirmed]).map((d) => d.id)).toEqual(['good']);
  });
});

describe('upsertDetection', () => {
  it('adds a new detection to the front of the list', () => {
    const a = makeDetection({ id: 'a' });
    const b = makeDetection({ id: 'b' });
    expect(upsertDetection([a], b).map((d) => d.id)).toEqual(['b', 'a']);
  });

  it('replaces an existing detection by id instead of duplicating it', () => {
    const a = makeDetection({ id: 'a', confidence: 0.5 });
    const a2 = makeDetection({ id: 'a', confidence: 0.95 });
    const result = upsertDetection([a], a2);
    expect(result).toHaveLength(1);
    expect(result[0]!.confidence).toBe(0.95);
  });
});

describe('minutesAgoLabel', () => {
  const t = (_key: string, fallback?: string) => fallback ?? _key;

  it('labels a very recent detection as "just now"', () => {
    const iso = new Date(Date.now() - 5000).toISOString();
    expect(minutesAgoLabel(iso, t)).toBe('just now');
  });

  it('labels an older detection in whole minutes', () => {
    const iso = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(minutesAgoLabel(iso, t)).toBe('5m ago');
  });
});
