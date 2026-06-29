import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  routeALPRDetection,
  ALPRDetection,
  CONFIDENCE_HIGH,
  CONFIDENCE_LOW,
  MAX_CANDIDATES,
} from './index';

/**
 * Property-based tests for ALPR confidence threshold behavior.
 *
 * **Validates: Requirements 24.2, 24.3, 24.4**
 */

// --- Arbitrary Generators ---

/** Generates a valid confidence score between 0 and 1 (inclusive) */
const arbConfidence = fc.double({ min: 0, max: 1, noNaN: true });

/** Generates a confidence score in the high range (> 0.9) */
const arbHighConfidence = fc.double({ min: 0.9001, max: 1.0, noNaN: true });

/** Generates a confidence score in the medium range [0.5, 0.9] */
const arbMediumConfidence = fc.double({ min: 0.5, max: 0.9, noNaN: true });

/** Generates a confidence score in the low range [0, 0.5) */
const arbLowConfidence = fc.double({ min: 0, max: 0.4999, noNaN: true });

/** Generates a plate text string */
const arbPlateText = fc.stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'), {
  minLength: 1,
  maxLength: 10,
});

/** Generates a crop image URL */
const arbCropUrl = fc.webUrl();

/** Generates an ALPR detection with a specific confidence range */
function arbDetection(confidence: fc.Arbitrary<number>): fc.Arbitrary<ALPRDetection> {
  return fc.record({
    text: arbPlateText,
    confidence,
    cropImageUrl: arbCropUrl,
  });
}

/** Generates a non-empty array of ALPR detections with arbitrary confidence */
const arbDetections = fc.array(arbDetection(arbConfidence), { minLength: 1, maxLength: 10 });

describe('ALPR Confidence Threshold Behavior - Property-Based Tests', () => {
  describe('Property 24: ALPR Confidence Threshold Behavior', () => {
    it('high confidence (> 90%) always routes to auto_fill', () => {
      fc.assert(
        fc.property(
          arbDetection(arbHighConfidence),
          fc.array(arbDetection(arbConfidence), { minLength: 0, maxLength: 5 }),
          (highDet, otherDets) => {
            // Ensure the high-confidence detection is the best one
            const detections = [highDet, ...otherDets];
            const result = routeALPRDetection(detections);

            expect(result.action).toBe('auto_fill');
            if (result.action === 'auto_fill') {
              expect(result.confidence).toBeGreaterThan(CONFIDENCE_HIGH);
              expect(result.plate.length).toBeGreaterThan(0);
            }
          },
        ),
        { numRuns: 500 },
      );
    });

    it('medium confidence [50%, 90%] always routes to show_candidates', () => {
      fc.assert(
        fc.property(
          arbDetection(arbMediumConfidence),
          fc.array(arbDetection(arbLowConfidence), { minLength: 0, maxLength: 5 }),
          (medDet, lowDets) => {
            // medDet has [0.5, 0.9], all others are below 0.5 — so best is medDet
            const detections = [medDet, ...lowDets];
            const result = routeALPRDetection(detections);

            expect(result.action).toBe('show_candidates');
            if (result.action === 'show_candidates') {
              expect(result.candidates.length).toBeGreaterThan(0);
              expect(result.candidates.length).toBeLessThanOrEqual(MAX_CANDIDATES);
            }
          },
        ),
        { numRuns: 500 },
      );
    });

    it('low confidence (< 50%) always routes to manual_input', () => {
      fc.assert(
        fc.property(
          fc.array(arbDetection(arbLowConfidence), { minLength: 1, maxLength: 5 }),
          (detections) => {
            const result = routeALPRDetection(detections);

            expect(result.action).toBe('manual_input');
            if (result.action === 'manual_input') {
              expect(result.cropImageUrl).toBeDefined();
            }
          },
        ),
        { numRuns: 500 },
      );
    });

    it('thresholds are mutually exclusive: exactly one action per input', () => {
      fc.assert(
        fc.property(arbDetections, (detections) => {
          const result = routeALPRDetection(detections);

          const actions = ['auto_fill', 'show_candidates', 'manual_input'];
          const matchingActions = actions.filter((a) => a === result.action);

          // Exactly one action must match
          expect(matchingActions).toHaveLength(1);
        }),
        { numRuns: 500 },
      );
    });

    it('thresholds are exhaustive: every valid input produces a defined action', () => {
      fc.assert(
        fc.property(
          fc.array(arbDetection(arbConfidence), { minLength: 0, maxLength: 10 }),
          (detections) => {
            const result = routeALPRDetection(detections);

            expect(result).toBeDefined();
            expect(result).not.toBeNull();
            expect(['auto_fill', 'show_candidates', 'manual_input']).toContain(result.action);
          },
        ),
        { numRuns: 500 },
      );
    });

    it('empty detections always route to manual_input', () => {
      // No generator needed — this is a universal fact
      const result = routeALPRDetection([]);
      expect(result.action).toBe('manual_input');
      if (result.action === 'manual_input') {
        expect(result.cropImageUrl).toBe('');
      }
    });

    it('candidates are limited to MAX_CANDIDATES (3)', () => {
      fc.assert(
        fc.property(
          fc.array(arbDetection(arbMediumConfidence), { minLength: 4, maxLength: 10 }),
          (detections) => {
            const result = routeALPRDetection(detections);

            if (result.action === 'show_candidates') {
              expect(result.candidates.length).toBeLessThanOrEqual(MAX_CANDIDATES);
            }
          },
        ),
        { numRuns: 300 },
      );
    });

    it('auto_fill returns the plate with the highest confidence', () => {
      fc.assert(
        fc.property(
          arbDetection(arbHighConfidence),
          fc.array(arbDetection(arbConfidence), { minLength: 0, maxLength: 5 }),
          (highDet, otherDets) => {
            const detections = [highDet, ...otherDets];
            const result = routeALPRDetection(detections);

            if (result.action === 'auto_fill') {
              // The confidence returned should be the maximum across all detections
              const maxConfidence = Math.max(...detections.map((d) => d.confidence));
              expect(result.confidence).toBeCloseTo(maxConfidence, 10);
            }
          },
        ),
        { numRuns: 500 },
      );
    });

    it('show_candidates returns candidates sorted by confidence descending', () => {
      fc.assert(
        fc.property(
          fc.array(arbDetection(arbMediumConfidence), { minLength: 2, maxLength: 8 }),
          (detections) => {
            const result = routeALPRDetection(detections);

            if (result.action === 'show_candidates') {
              for (let i = 0; i < result.candidates.length - 1; i++) {
                expect(result.candidates[i].confidence).toBeGreaterThanOrEqual(
                  result.candidates[i + 1].confidence,
                );
              }
            }
          },
        ),
        { numRuns: 300 },
      );
    });
  });
});
