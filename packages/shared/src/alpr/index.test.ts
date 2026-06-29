import { describe, it, expect } from 'vitest';
import {
  routeALPRDetection,
  ALPRDetection,
  CONFIDENCE_HIGH,
  CONFIDENCE_LOW,
  MAX_CANDIDATES,
} from './index';

describe('routeALPRDetection', () => {
  describe('auto_fill action (confidence > 90%)', () => {
    it('returns auto_fill when best detection confidence exceeds 0.9', () => {
      const detections: ALPRDetection[] = [
        { text: 'B1234ABC', confidence: 0.95, cropImageUrl: '/crops/1.jpg' },
      ];

      const result = routeALPRDetection(detections);

      expect(result).toEqual({
        action: 'auto_fill',
        plate: 'B1234ABC',
        confidence: 0.95,
      });
    });

    it('selects the highest confidence detection for auto_fill', () => {
      const detections: ALPRDetection[] = [
        { text: 'B5678DEF', confidence: 0.85, cropImageUrl: '/crops/2.jpg' },
        { text: 'B1234ABC', confidence: 0.97, cropImageUrl: '/crops/1.jpg' },
        { text: 'B9999XYZ', confidence: 0.60, cropImageUrl: '/crops/3.jpg' },
      ];

      const result = routeALPRDetection(detections);

      expect(result).toEqual({
        action: 'auto_fill',
        plate: 'B1234ABC',
        confidence: 0.97,
      });
    });

    it('returns auto_fill for confidence of 1.0 (perfect score)', () => {
      const detections: ALPRDetection[] = [
        { text: 'D4321ZZZ', confidence: 1.0, cropImageUrl: '/crops/1.jpg' },
      ];

      const result = routeALPRDetection(detections);

      expect(result).toEqual({
        action: 'auto_fill',
        plate: 'D4321ZZZ',
        confidence: 1.0,
      });
    });
  });

  describe('show_candidates action (confidence 50% – 90%)', () => {
    it('returns show_candidates when best confidence is between 0.5 and 0.9', () => {
      const detections: ALPRDetection[] = [
        { text: 'B1234ABC', confidence: 0.75, cropImageUrl: '/crops/1.jpg' },
      ];

      const result = routeALPRDetection(detections);

      expect(result).toEqual({
        action: 'show_candidates',
        candidates: [{ text: 'B1234ABC', confidence: 0.75, cropImageUrl: '/crops/1.jpg' }],
      });
    });

    it('returns top 3 candidates sorted by confidence', () => {
      const detections: ALPRDetection[] = [
        { text: 'B1111AAA', confidence: 0.55, cropImageUrl: '/crops/1.jpg' },
        { text: 'B2222BBB', confidence: 0.80, cropImageUrl: '/crops/2.jpg' },
        { text: 'B3333CCC', confidence: 0.70, cropImageUrl: '/crops/3.jpg' },
        { text: 'B4444DDD', confidence: 0.60, cropImageUrl: '/crops/4.jpg' },
      ];

      const result = routeALPRDetection(detections);

      expect(result).toEqual({
        action: 'show_candidates',
        candidates: [
          { text: 'B2222BBB', confidence: 0.80, cropImageUrl: '/crops/2.jpg' },
          { text: 'B3333CCC', confidence: 0.70, cropImageUrl: '/crops/3.jpg' },
          { text: 'B4444DDD', confidence: 0.60, cropImageUrl: '/crops/4.jpg' },
        ],
      });
    });

    it('returns show_candidates at the exact boundary of 0.5', () => {
      const detections: ALPRDetection[] = [
        { text: 'B1234ABC', confidence: 0.5, cropImageUrl: '/crops/1.jpg' },
      ];

      const result = routeALPRDetection(detections);

      expect(result).toEqual({
        action: 'show_candidates',
        candidates: [{ text: 'B1234ABC', confidence: 0.5, cropImageUrl: '/crops/1.jpg' }],
      });
    });

    it('returns show_candidates at the exact boundary of 0.9', () => {
      const detections: ALPRDetection[] = [
        { text: 'B1234ABC', confidence: 0.9, cropImageUrl: '/crops/1.jpg' },
      ];

      const result = routeALPRDetection(detections);

      expect(result).toEqual({
        action: 'show_candidates',
        candidates: [{ text: 'B1234ABC', confidence: 0.9, cropImageUrl: '/crops/1.jpg' }],
      });
    });

    it('limits candidates to MAX_CANDIDATES (3)', () => {
      const detections: ALPRDetection[] = [
        { text: 'A', confidence: 0.89, cropImageUrl: '/crops/a.jpg' },
        { text: 'B', confidence: 0.85, cropImageUrl: '/crops/b.jpg' },
        { text: 'C', confidence: 0.80, cropImageUrl: '/crops/c.jpg' },
        { text: 'D', confidence: 0.75, cropImageUrl: '/crops/d.jpg' },
        { text: 'E', confidence: 0.70, cropImageUrl: '/crops/e.jpg' },
      ];

      const result = routeALPRDetection(detections);

      expect(result.action).toBe('show_candidates');
      if (result.action === 'show_candidates') {
        expect(result.candidates).toHaveLength(MAX_CANDIDATES);
        expect(result.candidates[0].text).toBe('A');
        expect(result.candidates[1].text).toBe('B');
        expect(result.candidates[2].text).toBe('C');
      }
    });
  });

  describe('manual_input action (confidence < 50% or no detections)', () => {
    it('returns manual_input when no detections are provided', () => {
      const result = routeALPRDetection([]);

      expect(result).toEqual({
        action: 'manual_input',
        cropImageUrl: '',
      });
    });

    it('returns manual_input when best confidence is below 0.5', () => {
      const detections: ALPRDetection[] = [
        { text: 'B????XYZ', confidence: 0.3, cropImageUrl: '/crops/low.jpg' },
      ];

      const result = routeALPRDetection(detections);

      expect(result).toEqual({
        action: 'manual_input',
        cropImageUrl: '/crops/low.jpg',
      });
    });

    it('returns manual_input with crop from the best detection', () => {
      const detections: ALPRDetection[] = [
        { text: 'X', confidence: 0.2, cropImageUrl: '/crops/x.jpg' },
        { text: 'Y', confidence: 0.49, cropImageUrl: '/crops/y.jpg' },
        { text: 'Z', confidence: 0.1, cropImageUrl: '/crops/z.jpg' },
      ];

      const result = routeALPRDetection(detections);

      expect(result).toEqual({
        action: 'manual_input',
        cropImageUrl: '/crops/y.jpg',
      });
    });

    it('returns manual_input for confidence of 0.0', () => {
      const detections: ALPRDetection[] = [
        { text: '', confidence: 0.0, cropImageUrl: '/crops/noplate.jpg' },
      ];

      const result = routeALPRDetection(detections);

      expect(result).toEqual({
        action: 'manual_input',
        cropImageUrl: '/crops/noplate.jpg',
      });
    });
  });

  describe('boundary conditions', () => {
    it('confidence exactly 0.9 routes to show_candidates (not auto_fill)', () => {
      const detections: ALPRDetection[] = [
        { text: 'B1234ABC', confidence: CONFIDENCE_HIGH, cropImageUrl: '/crops/1.jpg' },
      ];

      const result = routeALPRDetection(detections);
      expect(result.action).toBe('show_candidates');
    });

    it('confidence just above 0.9 routes to auto_fill', () => {
      const detections: ALPRDetection[] = [
        { text: 'B1234ABC', confidence: 0.901, cropImageUrl: '/crops/1.jpg' },
      ];

      const result = routeALPRDetection(detections);
      expect(result.action).toBe('auto_fill');
    });

    it('confidence exactly 0.5 routes to show_candidates (not manual_input)', () => {
      const detections: ALPRDetection[] = [
        { text: 'B1234ABC', confidence: CONFIDENCE_LOW, cropImageUrl: '/crops/1.jpg' },
      ];

      const result = routeALPRDetection(detections);
      expect(result.action).toBe('show_candidates');
    });

    it('confidence just below 0.5 routes to manual_input', () => {
      const detections: ALPRDetection[] = [
        { text: 'B1234ABC', confidence: 0.499, cropImageUrl: '/crops/1.jpg' },
      ];

      const result = routeALPRDetection(detections);
      expect(result.action).toBe('manual_input');
    });
  });
});
