/**
 * LPR/ANPR plate ingest — the on-prem half of AIRIN-59.
 *
 * Recognition is done ON THE DEVICE (an ANPR camera or NVR), never here. The
 * bridge's job is only to receive a plate reading on the LAN and forward it to
 * the cloud over the connection it already holds.
 *
 * WHY A GENERIC WEBHOOK RATHER THAN A VENDOR SDK: there is no device spec list
 * yet, and ANPR event formats differ per vendor and per firmware. Practically
 * every ANPR camera/NVR can be configured to HTTP-POST an event somewhere, so
 * the bridge exposes one small endpoint and normalises whatever arrives. That
 * means a device can be chosen — or swapped — without changing the cloud, and a
 * vendor that needs a bespoke adapter only has to produce this one shape.
 *
 * Deliberately tolerant of field naming: `plate` / `plateNumber` / `licensePlate`
 * / `plateNo`, nested under a `data`/`event`/`AlarmInfo` envelope or not, because
 * that is exactly where vendors differ and none of it is worth a code change.
 */

import http from 'node:http';

/** Normalised reading forwarded to the cloud (mirrors PlateDetectionInput). */
export interface BridgePlateDetection {
  outletId: string;
  cameraId: string;
  plate: string;
  confidence?: number;
  capturedAt?: string;
  cropImageUrl?: string;
  source?: string;
}

/** Pull a plate string out of an arbitrary vendor payload. */
export function extractPlate(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const obj = body as Record<string, unknown>;
  // Unwrap one level of the common envelopes before looking for fields.
  for (const env of ['data', 'event', 'AlarmInfo', 'Picture', 'plateResult']) {
    const inner = obj[env];
    if (inner && typeof inner === 'object') {
      const found = extractPlate(inner);
      if (found) return found;
    }
  }
  for (const key of ['plate', 'plateNumber', 'licensePlate', 'plateNo', 'PlateNumber', 'license_plate']) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/** Pull a 0..1 confidence out of an arbitrary vendor payload. */
export function extractConfidence(body: unknown): number | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const obj = body as Record<string, unknown>;
  for (const key of ['confidence', 'score', 'Confidence', 'reliability']) {
    const v = obj[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      // Vendors report either 0..1 or 0..100; normalise the latter.
      return v > 1 ? Math.min(1, v / 100) : Math.max(0, v);
    }
  }
  for (const env of ['data', 'event', 'AlarmInfo']) {
    const inner = obj[env];
    if (inner && typeof inner === 'object') {
      const found = extractConfidence(inner);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** POST one reading to the cloud using the bridge's own token. */
export async function forwardDetection(
  cloudUrl: string,
  token: string,
  detection: BridgePlateDetection,
): Promise<{ ok: boolean; status: number; body?: string }> {
  try {
    const res = await fetch(`${cloudUrl}/api/lpr/detections`, {
      method: 'POST',
      // Same pairing token the Socket.IO connection uses; LprBridgeGuard resolves
      // it via BridgeService.resolveByToken and derives tenant + outlet from it.
      headers: { 'Content-Type': 'application/json', 'X-Aire-Bridge-Token': token },
      body: JSON.stringify(detection),
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      console.warn(`[lpr] cloud rejected detection ${detection.plate}: ${res.status} ${text.slice(0, 200)}`);
    }
    return { ok: res.ok, status: res.status, body: text.slice(0, 500) };
  } catch (err) {
    // A branch LAN drops constantly; a failed forward must never crash the agent
    // or block the next reading. The plate is simply lost — the cashier types it.
    console.warn(`[lpr] forward failed for ${detection.plate}: ${(err as Error).message}`);
    return { ok: false, status: 0 };
  }
}

/**
 * Register the camera webhook on the bridge's existing local HTTP server.
 * Cameras on the LAN POST here; nothing inbound from the internet is exposed.
 *
 * Returns true when the request was handled, so the caller can fall through to
 * its other routes.
 */
export function handleLprRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { cloudUrl: string; token: string; outletId: string },
): boolean {
  if (req.method !== 'POST' || !req.url || !req.url.startsWith('/lpr')) return false;

  let raw = '';
  req.on('data', (c) => {
    raw += c;
    // Cameras sometimes attach a full JPEG; cap so a rogue device can't exhaust
    // memory on what is often a Raspberry Pi.
    if (raw.length > 512_000) req.destroy();
  });
  req.on('end', () => {
    let body: unknown;
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid JSON' }));
      return;
    }
    const plate = extractPlate(body);
    if (!plate) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'no plate field found in payload' }));
      return;
    }
    const o = (body ?? {}) as Record<string, unknown>;
    const detection: BridgePlateDetection = {
      outletId: ctx.outletId,
      cameraId: String(o.cameraId ?? o.camera ?? o.channel ?? o.DeviceID ?? 'unknown'),
      plate,
      confidence: extractConfidence(body),
      capturedAt: typeof o.capturedAt === 'string' ? o.capturedAt : new Date().toISOString(),
      cropImageUrl: typeof o.cropImageUrl === 'string' ? o.cropImageUrl : undefined,
      source: typeof o.source === 'string' ? o.source : 'webhook',
    };
    void forwardDetection(ctx.cloudUrl, ctx.token, detection);
    // Acknowledge immediately: cameras retry or drop events if the POST is slow.
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ accepted: true, plate }));
  });
  return true;
}

/** Plausible Indonesian plates for simulate mode. */
const SIM_PLATES = ['B 1234 ABC', 'B8882CST', 'D 5678 XYZ', 'B 9012 QWE', 'F 3456 RTY'];

/**
 * Simulate mode: emit a synthetic reading periodically so the whole pipeline —
 * bridge → cloud → match → POS suggestion — is demonstrable and testable with no
 * hardware at all. This is what makes the feature usable before any camera has
 * been chosen. Returns a stop function.
 */
export function startSimulatedLpr(ctx: {
  cloudUrl: string;
  token: string;
  outletId: string;
  intervalMs?: number;
}): () => void {
  let i = 0;
  const timer = setInterval(() => {
    const plate = SIM_PLATES[i % SIM_PLATES.length]!;
    i += 1;
    void forwardDetection(ctx.cloudUrl, ctx.token, {
      outletId: ctx.outletId,
      cameraId: 'sim-cam-1',
      plate,
      // Vary confidence so threshold behaviour is exercised, staying above the
      // cloud's floor for most readings.
      confidence: i % 5 === 0 ? 0.42 : 0.93,
      capturedAt: new Date().toISOString(),
      source: 'simulate',
    });
  }, ctx.intervalMs ?? 45_000);
  timer.unref?.();
  console.log('[lpr] simulate mode: synthetic plate detections every '
    + `${Math.round((ctx.intervalMs ?? 45_000) / 1000)}s`);
  return () => clearInterval(timer);
}
