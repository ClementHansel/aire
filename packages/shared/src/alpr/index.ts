/**
 * ALPR (Automatic License Plate Recognition) confidence routing logic.
 *
 * Routes ALPR detection results to the appropriate UI action based on
 * the highest confidence score among detected plates.
 *
 * Validates: Requirements 24.2, 24.3, 24.4
 */

export interface ALPRDetection {
  text: string;
  confidence: number; // 0.0 to 1.0
  cropImageUrl: string;
}

export type ALPRRoutingResult =
  | { action: 'auto_fill'; plate: string; confidence: number }
  | { action: 'show_candidates'; candidates: ALPRDetection[] }
  | { action: 'manual_input'; cropImageUrl: string };

/** Confidence threshold above which auto-fill is triggered (exclusive) */
export const CONFIDENCE_HIGH = 0.9;

/** Confidence threshold below which manual input is required (exclusive) */
export const CONFIDENCE_LOW = 0.5;

/** Maximum number of candidates to show in the selection UI */
export const MAX_CANDIDATES = 3;

/**
 * Routes ALPR detection results to the appropriate POS action.
 *
 * - Confidence > 90%: auto-fill plate, prompt Cashier confirmation (Req 24.2)
 * - Confidence 50–90%: display top 3 candidates for selection (Req 24.3)
 * - Confidence < 50% or no detections: display crop image, require manual input (Req 24.4)
 *
 * Detections are sorted by confidence descending before routing.
 */
export function routeALPRDetection(detections: ALPRDetection[]): ALPRRoutingResult {
  // No detections → manual input
  if (detections.length === 0) {
    return { action: 'manual_input', cropImageUrl: '' };
  }

  // Sort by confidence descending to find the best detection
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const best = sorted[0]!;

  // High confidence (> 90%): auto-fill
  if (best.confidence > CONFIDENCE_HIGH) {
    return {
      action: 'auto_fill',
      plate: best.text,
      confidence: best.confidence,
    };
  }

  // Medium confidence (50% – 90%): show candidates
  if (best.confidence >= CONFIDENCE_LOW) {
    return {
      action: 'show_candidates',
      candidates: sorted.slice(0, MAX_CANDIDATES),
    };
  }

  // Low confidence (< 50%): manual input with crop image
  return {
    action: 'manual_input',
    cropImageUrl: best.cropImageUrl,
  };
}
