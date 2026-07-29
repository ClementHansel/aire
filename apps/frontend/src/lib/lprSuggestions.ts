import type { PlateDetection } from '@aire/shared';
import { LPR_MIN_CONFIDENCE, LPR_SUGGESTION_TTL_SECONDS } from '@aire/shared';

/**
 * Which detections are still worth offering to the cashier as a tappable
 * suggestion (AIRIN-25, POS half). Two independent expiries apply: a
 * confidence floor (devices vary wildly in how they report certainty) and a
 * TTL (a car is rung up within minutes of arriving; an old plate risks
 * attaching to the wrong car). Already-confirmed detections are dropped
 * defensively even though the backend's GET is documented to already filter
 * to unconfirmed — a stale poll response should never re-offer something a
 * cashier (or another till on the same outlet) already actioned.
 *
 * This is the ONLY gate on what's offered. It never mutates a cart/order
 * field itself — filling the plate field happens exclusively when the
 * cashier taps a chip (see new-order/page.tsx#pickDetection), never here and
 * never on arrival. That split is what keeps a probabilistic camera reading
 * from silently overwriting something the cashier typed or a member lookup
 * already set.
 */
export function filterOfferableDetections(
  detections: PlateDetection[],
  now: Date = new Date(),
): PlateDetection[] {
  const nowMs = now.getTime();
  return detections.filter((d) => {
    if (d.confirmedPlate != null || d.orderId != null) return false;
    if (d.confidence < LPR_MIN_CONFIDENCE) return false;
    const ageSeconds = (nowMs - new Date(d.capturedAt).getTime()) / 1000;
    // Negative age (clock skew / capturedAt in the future) is treated as
    // fresh rather than filtered — rejecting it would just be another way to
    // hide a legitimate detection over something outside the cashier's control.
    return ageSeconds <= LPR_SUGGESTION_TTL_SECONDS;
  });
}

/**
 * Merge a newly-arrived (or re-fetched) detection into the list, newest
 * first, replacing any existing entry with the same id instead of
 * duplicating it. Used for both the initial GET (one call per row) and each
 * realtime `lpr:detected` push, so the same camera reading pushed twice
 * (e.g. a reconnect replaying it) never shows two chips for one car.
 */
export function upsertDetection(list: PlateDetection[], detection: PlateDetection): PlateDetection[] {
  const rest = list.filter((d) => d.id !== detection.id);
  return [detection, ...rest];
}

/** Compact "just now" / "Nm ago" label for a chip — deliberately not routed
 *  through a date library for a two-word relative stamp; `t` supplies the
 *  Indonesian/English words so this stays localised without one. */
export function minutesAgoLabel(
  iso: string,
  t: (key: string, fallback?: string) => string,
  now: Date = new Date(),
): string {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return t('pos.new.lprJustNow', 'just now');
  const minutes = Math.round(seconds / 60);
  return `${minutes}${t('pos.new.lprMinAgoSuffix', 'm ago')}`;
}
