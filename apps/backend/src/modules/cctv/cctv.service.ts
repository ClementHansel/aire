import {
  Injectable,
  Inject,
  Optional,
  Logger,
  NotFoundException,
  ConflictException,
  OnModuleInit,
} from '@nestjs/common';
import { Pool } from 'pg';
import { Readable } from 'node:stream';
import { v4 as uuidv4 } from 'uuid';
import { DATABASE_POOL } from '../auth/database.provider';
import { StorageService } from '../storage/storage.service';
import { BridgeDispatchService } from '../bridge/bridge-dispatch.service';
import {
  BridgeEvents,
  HlsPlaylistEvent,
  HlsSegmentEvent,
  BridgeOfflineEvent,
} from '../bridge/bridge.events';

/** A configured CCTV camera (row of the `cameras` table). */
export interface CameraDTO {
  id: string;
  tenantId: string;
  outletId: string;
  bridgeId: string | null;
  name: string;
  rtspUrl: string;
  location: string | null;
  deviceId: string | null;
  isActive: boolean;
  isStreaming: boolean;
  lastFrameAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A recording session (row of the `camera_recordings` table). */
export interface RecordingDTO {
  id: string;
  tenantId: string;
  outletId: string;
  cameraId: string;
  orderId: string | null;
  status: 'recording' | 'completed' | 'failed';
  storagePrefix: string | null;
  segmentCount: number;
  durationSeconds: number | null;
  startedAt: string;
  stoppedAt: string | null;
}

/** One buffered HLS media segment held in the per-camera live ring buffer. */
interface LiveSegment {
  name: string;
  data: Buffer;
  seq: number;
  durationSec: number;
}

/** In-progress recording state kept in memory while a camera records. */
interface ActiveRecording {
  recordingId: string;
  cameraId: string;
  tenantId: string;
  outletId: string;
  storagePrefix: string;
  segments: { name: string; seq: number; durationSec: number }[];
}

/** How many live segments to retain per camera for the rolling playlist. */
const MAX_LIVE_SEGMENTS = 6;
const HLS_TARGET_DURATION = 4;
const M3U8_CONTENT_TYPE = 'application/vnd.apple.mpegurl';
const TS_CONTENT_TYPE = 'video/mp2t';

/**
 * CctvService — DB-backed camera registry + live HLS relay + VOD recordings.
 *
 * Cloud never touches RTSP directly. The branch-bridge agent relays segments up
 * the socket (`hls:playlist` / `hls:segment`); this service keeps the last N
 * segments per camera in memory plus the rolling `live.m3u8`, and (when a
 * recording is active) also persists each incoming segment to MinIO. Playback
 * is pull-based HLS, so browsers need no socket — they poll the controller's
 * `.m3u8` / `.ts` endpoints.
 *
 * Requirements: 25.1 (live HLS), 25.2 (event recording), 25.4 (MinIO storage).
 */
@Injectable()
export class CctvService implements OnModuleInit {
  private readonly logger = new Logger(CctvService.name);

  /** cameraId → rolling ring buffer of the most recent live segments. */
  private readonly liveSegments = new Map<string, LiveSegment[]>();
  /** cameraId → latest live playlist as sent by the agent. */
  private readonly livePlaylists = new Map<string, string>();
  /** cameraIds we have already asked the agent to start relaying. */
  private readonly streaming = new Set<string>();
  /** cameraId → active recording session (at most one per camera). */
  private readonly activeRecordings = new Map<string, ActiveRecording>();

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() private readonly storage?: StorageService,
    @Optional()
    @Inject(BridgeDispatchService)
    private readonly bridgeDispatch?: BridgeDispatchService,
    @Optional() @Inject(BridgeEvents) private readonly bridgeEvents?: BridgeEvents,
  ) {}

  onModuleInit(): void {
    this.subscribeToBridge();
  }

  /** Subscribe to the relayed HLS events. Safe when no bus is wired (tests). */
  subscribeToBridge(): void {
    if (!this.bridgeEvents) return;
    this.bridgeEvents.on('hls:playlist', (e: HlsPlaylistEvent) => this.onPlaylist(e));
    this.bridgeEvents.on('hls:segment', (e: HlsSegmentEvent) => void this.onSegment(e));
    this.bridgeEvents.on('bridge:offline', (e: BridgeOfflineEvent) => void this.onBridgeOffline(e));
  }

  /**
   * When a branch's agent disconnects, drop the live state for its cameras so a
   * reconnected agent gets a fresh `stream:start` on the next live request
   * (otherwise the "already streaming" guard would keep serving frozen, stale
   * segments from the ring buffer forever).
   */
  private async onBridgeOffline(e: BridgeOfflineEvent): Promise<void> {
    try {
      const res = await this.pool.query<{ id: string }>(
        `SELECT id FROM cameras WHERE outlet_id = $1`,
        [e.outletId],
      );
      for (const row of res.rows) {
        this.streaming.delete(row.id);
        this.liveSegments.delete(row.id);
        this.livePlaylists.delete(row.id);
      }
      await this.pool
        .query(`UPDATE cameras SET is_streaming = false, updated_at = NOW() WHERE outlet_id = $1`, [
          e.outletId,
        ])
        .catch(() => undefined);
      this.logger.log(`Cleared live state for outlet ${e.outletId} after bridge offline`);
    } catch (err) {
      this.logger.error(`Failed clearing live state for outlet ${e.outletId}: ${err}`);
    }
  }

  // ─── Live relay ingestion ────────────────────────────────────────────────────

  private onPlaylist(e: HlsPlaylistEvent): void {
    this.livePlaylists.set(e.cameraId, e.m3u8);
  }

  private async onSegment(e: HlsSegmentEvent): Promise<void> {
    const data = Buffer.from(e.dataB64, 'base64');

    const buf = this.liveSegments.get(e.cameraId) ?? [];
    buf.push({ name: e.name, data, seq: e.seq, durationSec: e.durationSec });
    while (buf.length > MAX_LIVE_SEGMENTS) buf.shift();
    this.liveSegments.set(e.cameraId, buf);

    // If recording, also persist this segment to object storage.
    const rec = this.activeRecordings.get(e.cameraId);
    if (rec && this.storage?.isEnabled()) {
      try {
        await this.storage.put(`${rec.storagePrefix}${e.name}`, data, TS_CONTENT_TYPE);
        rec.segments.push({ name: e.name, seq: e.seq, durationSec: e.durationSec });
      } catch (err) {
        this.logger.error(
          `Failed persisting recording segment ${e.name} for camera ${e.cameraId}: ${err}`,
        );
      }
    }
  }

  // ─── Live serving ────────────────────────────────────────────────────────────

  /**
   * Return the current live playlist for a camera, starting its relay if this
   * is the first request. Prefers the agent's own playlist; falls back to one
   * synthesised from the ring buffer.
   */
  async getLivePlaylist(camera: CameraDTO): Promise<string> {
    this.ensureStreaming(camera);
    return this.livePlaylists.get(camera.id) ?? this.buildLivePlaylist(camera.id);
  }

  /** Return a buffered live segment by name, or null if it has aged out. */
  getLiveSegment(cameraId: string, name: string): Buffer | null {
    const seg = this.liveSegments.get(cameraId)?.find((s) => s.name === name);
    return seg ? seg.data : null;
  }

  /** Ask the agent to begin relaying this camera (idempotent per process). */
  private ensureStreaming(camera: CameraDTO): void {
    if (this.streaming.has(camera.id)) return;
    if (this.bridgeDispatch && camera.rtspUrl) {
      this.bridgeDispatch.dispatchStreamStart(camera.outletId, {
        cameraId: camera.id,
        rtspUrl: camera.rtspUrl,
      });
      this.streaming.add(camera.id);
      void this.pool
        .query(`UPDATE cameras SET is_streaming = true, updated_at = NOW() WHERE id = $1`, [
          camera.id,
        ])
        .catch(() => undefined);
    }
  }

  /** Synthesize a live media playlist from the in-memory ring buffer. */
  private buildLivePlaylist(cameraId: string): string {
    const segs = this.liveSegments.get(cameraId) ?? [];
    const mediaSeq = segs.length > 0 ? segs[0]!.seq : 0;
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      `#EXT-X-TARGETDURATION:${HLS_TARGET_DURATION}`,
      `#EXT-X-MEDIA-SEQUENCE:${mediaSeq}`,
    ];
    for (const s of segs) {
      lines.push(`#EXTINF:${s.durationSec.toFixed(3)},`);
      lines.push(s.name);
    }
    return lines.join('\n') + '\n';
  }

  // ─── Camera CRUD ─────────────────────────────────────────────────────────────

  /** List active cameras for an outlet (tenant-scoped). */
  async listByOutlet(tenantId: string, outletId: string): Promise<CameraDTO[]> {
    const res = await this.pool.query(
      `SELECT ${CctvService.CAMERA_COLUMNS} FROM cameras
       WHERE tenant_id = $1 AND outlet_id = $2 AND is_active
       ORDER BY created_at DESC`,
      [tenantId, outletId],
    );
    return res.rows.map((r) => this.mapCamera(r));
  }

  /** Fetch a single camera scoped to the tenant, throwing if absent. */
  async getCamera(tenantId: string, id: string): Promise<CameraDTO> {
    const res = await this.pool.query(
      `SELECT ${CctvService.CAMERA_COLUMNS} FROM cameras WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    if (res.rows.length === 0) throw new NotFoundException(`Camera ${id} not found`);
    return this.mapCamera(res.rows[0]);
  }

  /** Create a camera row. */
  async createCamera(
    tenantId: string,
    input: {
      outletId: string;
      name: string;
      rtspUrl: string;
      location?: string;
      bridgeId?: string;
      deviceId?: string;
    },
  ): Promise<CameraDTO> {
    const res = await this.pool.query(
      `INSERT INTO cameras (tenant_id, outlet_id, bridge_id, name, rtsp_url, location, device_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${CctvService.CAMERA_COLUMNS}`,
      [
        tenantId,
        input.outletId,
        input.bridgeId ?? null,
        input.name,
        input.rtspUrl,
        input.location ?? null,
        input.deviceId ?? null,
      ],
    );
    return this.mapCamera(res.rows[0]);
  }

  /** Patch mutable camera fields (name/location/rtsp/is_active). */
  async updateCamera(
    tenantId: string,
    id: string,
    patch: { name?: string; location?: string; rtspUrl?: string; isActive?: boolean },
  ): Promise<CameraDTO> {
    const res = await this.pool.query(
      `UPDATE cameras SET
         name = COALESCE($3, name),
         location = COALESCE($4, location),
         rtsp_url = COALESCE($5, rtsp_url),
         is_active = COALESCE($6, is_active),
         updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING ${CctvService.CAMERA_COLUMNS}`,
      [id, tenantId, patch.name ?? null, patch.location ?? null, patch.rtspUrl ?? null, patch.isActive ?? null],
    );
    if (res.rows.length === 0) throw new NotFoundException(`Camera ${id} not found`);
    return this.mapCamera(res.rows[0]);
  }

  // ─── Recording ───────────────────────────────────────────────────────────────

  /**
   * Begin an event-based recording for a camera. Incoming live segments are
   * additionally written to MinIO under `recordings/{cameraId}/{recordingId}/`.
   */
  async startRecording(
    tenantId: string,
    cameraId: string,
    orderId?: string,
  ): Promise<RecordingDTO> {
    if (this.activeRecordings.has(cameraId)) {
      throw new ConflictException(`Camera ${cameraId} is already recording`);
    }
    const camera = await this.getCamera(tenantId, cameraId);

    const recordingId = uuidv4();
    const storagePrefix = `recordings/${cameraId}/${recordingId}/`;
    const res = await this.pool.query(
      `INSERT INTO camera_recordings
         (id, tenant_id, outlet_id, camera_id, order_id, status, storage_prefix)
       VALUES ($1, $2, $3, $4, $5, 'recording', $6)
       RETURNING ${CctvService.RECORDING_COLUMNS}`,
      [recordingId, tenantId, camera.outletId, cameraId, orderId ?? null, storagePrefix],
    );

    this.activeRecordings.set(cameraId, {
      recordingId,
      cameraId,
      tenantId,
      outletId: camera.outletId,
      storagePrefix,
      segments: [],
    });
    // Make sure segments are actually flowing so there is something to record.
    this.ensureStreaming(camera);

    this.logger.log(`Started recording ${recordingId} for camera ${cameraId}`);
    return this.mapRecording(res.rows[0]);
  }

  /**
   * Stop a recording: write a VOD `index.m3u8` listing the stored segments and
   * finalise the DB row (status/duration/segment_count).
   */
  async stopRecording(tenantId: string, recordingId: string): Promise<RecordingDTO> {
    // Locate the in-memory session (keyed by camera).
    let active: ActiveRecording | undefined;
    for (const rec of this.activeRecordings.values()) {
      if (rec.recordingId === recordingId) {
        active = rec;
        break;
      }
    }

    let segmentCount = 0;
    let durationSeconds = 0;
    if (active) {
      this.activeRecordings.delete(active.cameraId);
      segmentCount = active.segments.length;
      durationSeconds = Math.round(active.segments.reduce((s, x) => s + x.durationSec, 0));

      if (this.storage?.isEnabled()) {
        const vod = this.buildVodPlaylist(active.segments);
        try {
          await this.storage.put(
            `${active.storagePrefix}index.m3u8`,
            Buffer.from(vod, 'utf8'),
            M3U8_CONTENT_TYPE,
          );
        } catch (err) {
          this.logger.error(`Failed writing VOD index for recording ${recordingId}: ${err}`);
        }
      }
    }

    const res = await this.pool.query(
      `UPDATE camera_recordings SET
         status = 'completed',
         stopped_at = NOW(),
         segment_count = $3,
         duration_seconds = $4
       WHERE id = $1 AND tenant_id = $2
       RETURNING ${CctvService.RECORDING_COLUMNS}`,
      [recordingId, tenantId, segmentCount, durationSeconds],
    );
    if (res.rows.length === 0) throw new NotFoundException(`Recording ${recordingId} not found`);

    this.logger.log(
      `Stopped recording ${recordingId} (${segmentCount} segments, ${durationSeconds}s)`,
    );
    return this.mapRecording(res.rows[0]);
  }

  /** List recordings, optionally filtered by outlet and/or camera. */
  async listRecordings(
    tenantId: string,
    filters: { outletId?: string; cameraId?: string } = {},
  ): Promise<RecordingDTO[]> {
    const clauses = ['tenant_id = $1'];
    const params: unknown[] = [tenantId];
    if (filters.outletId) {
      params.push(filters.outletId);
      clauses.push(`outlet_id = $${params.length}`);
    }
    if (filters.cameraId) {
      params.push(filters.cameraId);
      clauses.push(`camera_id = $${params.length}`);
    }
    const res = await this.pool.query(
      `SELECT ${CctvService.RECORDING_COLUMNS} FROM camera_recordings
       WHERE ${clauses.join(' AND ')}
       ORDER BY started_at DESC`,
      params,
    );
    return res.rows.map((r) => this.mapRecording(r));
  }

  /** Fetch a recording's VOD playlist from MinIO (tenant-scoped). */
  async getRecordingPlaylist(tenantId: string, recordingId: string): Promise<string | null> {
    const prefix = await this.recordingPrefix(tenantId, recordingId);
    if (!prefix || !this.storage?.isEnabled()) return null;
    const obj = await this.storage.get(`${prefix}index.m3u8`);
    if (!obj) return null;
    return (await this.streamToBuffer(obj.body)).toString('utf8');
  }

  /** Fetch a single stored VOD segment from MinIO (tenant-scoped). */
  async getRecordingSegment(
    tenantId: string,
    recordingId: string,
    name: string,
  ): Promise<Buffer | null> {
    const prefix = await this.recordingPrefix(tenantId, recordingId);
    if (!prefix || !this.storage?.isEnabled()) return null;
    const obj = await this.storage.get(`${prefix}${name}`);
    if (!obj) return null;
    return this.streamToBuffer(obj.body);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async recordingPrefix(tenantId: string, recordingId: string): Promise<string | null> {
    const res = await this.pool.query<{ storage_prefix: string | null }>(
      `SELECT storage_prefix FROM camera_recordings WHERE id = $1 AND tenant_id = $2`,
      [recordingId, tenantId],
    );
    return res.rows[0]?.storage_prefix ?? null;
  }

  /** Build a closed (VOD) HLS playlist from an ordered segment list. */
  private buildVodPlaylist(segments: { name: string; durationSec: number }[]): string {
    const maxDur = segments.reduce((m, s) => Math.max(m, s.durationSec), HLS_TARGET_DURATION);
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-PLAYLIST-TYPE:VOD',
      `#EXT-X-TARGETDURATION:${Math.ceil(maxDur)}`,
      '#EXT-X-MEDIA-SEQUENCE:0',
    ];
    for (const s of segments) {
      lines.push(`#EXTINF:${s.durationSec.toFixed(3)},`);
      lines.push(s.name);
    }
    lines.push('#EXT-X-ENDLIST');
    return lines.join('\n') + '\n';
  }

  private async streamToBuffer(readable: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of readable) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  private static readonly CAMERA_COLUMNS =
    'id, tenant_id, outlet_id, bridge_id, name, rtsp_url, location, device_id, is_active, is_streaming, last_frame_at, created_at, updated_at';

  private static readonly RECORDING_COLUMNS =
    'id, tenant_id, outlet_id, camera_id, order_id, status, storage_prefix, segment_count, duration_seconds, started_at, stopped_at';

  private mapCamera = (r: any): CameraDTO => ({
    id: r.id,
    tenantId: r.tenant_id,
    outletId: r.outlet_id,
    bridgeId: r.bridge_id ?? null,
    name: r.name,
    rtspUrl: r.rtsp_url,
    location: r.location ?? null,
    deviceId: r.device_id ?? null,
    isActive: r.is_active,
    isStreaming: r.is_streaming,
    lastFrameAt: r.last_frame_at ? new Date(r.last_frame_at).toISOString() : null,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : r.created_at,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : r.updated_at,
  });

  private mapRecording = (r: any): RecordingDTO => ({
    id: r.id,
    tenantId: r.tenant_id,
    outletId: r.outlet_id,
    cameraId: r.camera_id,
    orderId: r.order_id ?? null,
    status: r.status,
    storagePrefix: r.storage_prefix ?? null,
    segmentCount: r.segment_count ?? 0,
    durationSeconds: r.duration_seconds ?? null,
    startedAt: r.started_at ? new Date(r.started_at).toISOString() : r.started_at,
    stoppedAt: r.stopped_at ? new Date(r.stopped_at).toISOString() : null,
  });
}
