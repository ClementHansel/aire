/**
 * License-plate recognition (LPR/ANPR) contract — AIRIN-59 / AIRIN-25.
 *
 * Deliberately VENDOR-NEUTRAL. Recognition happens off-platform (an ANPR camera
 * or NVR doing it on-device), and the branch bridge forwards whatever it
 * receives in this shape. Nothing here assumes Hikvision vs Dahua vs a future
 * self-hosted detector, so a device can be chosen later without reworking the
 * pipeline — which matters because there is no device spec list yet.
 *
 * Flow: camera/NVR → branch bridge → POST /api/lpr/detections → match against
 * membership plates → realtime push to the POS → cashier CONFIRMS.
 *
 * The cashier confirmation step is not optional politeness: plate recognition is
 * probabilistic, so a detection is a *suggestion*. It must never silently
 * overwrite what a cashier typed.
 */

/** A plate reading as reported by a device. */
export interface PlateDetectionInput {
  /** Branch the camera watches. */
  outletId: string;
  /** Opaque device identifier — vendor serial, channel id, whatever the device gives. */
  cameraId: string;
  /** Plate exactly as the device reported it; the server normalises. */
  plate: string;
  /** 0..1. Devices that report no confidence should send 1 rather than guess. */
  confidence?: number;
  /** Device capture time (ISO). Defaults to receipt time when absent. */
  capturedAt?: string;
  /** Optional URL/path to the plate crop, for cashier verification. */
  cropImageUrl?: string;
  /** Free-form device/vendor label, for support and debugging. */
  source?: string;
}

/** What a detection matched in the member database. */
export interface PlateDetectionMatch {
  customerId: string;
  customerName: string;
  customerPhone: string;
  membershipId: string | null;
  membershipStatus: string | null;
  planName: string | null;
  /** Vehicle details registered against the matched plate, when known. */
  vehicleBrand: string | null;
  vehicleModel: string | null;
}

/** A stored detection as returned to clients. */
export interface PlateDetection {
  id: string;
  outletId: string;
  cameraId: string;
  /** As reported by the device. */
  plate: string;
  /** Canonical form (whitespace stripped, uppercased) — what matching uses. */
  plateNormalized: string;
  confidence: number;
  capturedAt: string;
  cropImageUrl: string | null;
  source: string | null;
  /** Null when the plate matched no member — still shown, still confirmable. */
  match: PlateDetectionMatch | null;
  /** Set once a cashier accepts it onto an order. */
  confirmedPlate: string | null;
  orderId: string | null;
}

/** Realtime payload pushed to the POS for a branch. */
export interface PlateDetectedPayload {
  detection: PlateDetection;
}

/** Socket event name for a new detection (mirrors `queue:updated`). */
export const LPR_DETECTED_EVENT = 'lpr:detected';

/**
 * How long a detection stays offerable in the POS. A car is rung up within
 * minutes of arriving; an hours-old plate is noise and risks attaching the wrong
 * vehicle to an order.
 */
export const LPR_SUGGESTION_TTL_SECONDS = 15 * 60;

/**
 * Below this, a reading is too unreliable to offer as a one-tap suggestion.
 * Devices vary wildly, so this is a floor rather than a tuned threshold.
 */
export const LPR_MIN_CONFIDENCE = 0.5;
