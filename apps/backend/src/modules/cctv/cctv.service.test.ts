import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { CctvService, CameraDTO } from './cctv.service';
import { BridgeEvents } from '../bridge/bridge.events';
import type { BridgeDispatchService } from '../bridge/bridge-dispatch.service';
import type { StorageService } from '../storage/storage.service';

/** A raw `cameras` row as pg would return it. */
function cameraRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cam-001',
    tenant_id: 'tenant-1',
    outlet_id: 'outlet-1',
    bridge_id: 'bridge-1',
    name: 'Entrance',
    rtsp_url: 'rtsp://192.168.1.100:554/stream',
    location: 'Front',
    device_id: null,
    is_active: true,
    is_streaming: false,
    last_frame_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function recordingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rec-001',
    tenant_id: 'tenant-1',
    outlet_id: 'outlet-1',
    camera_id: 'cam-001',
    order_id: 'order-1',
    status: 'recording',
    storage_prefix: 'recordings/cam-001/rec-001/',
    segment_count: 0,
    duration_seconds: null,
    started_at: '2026-01-01T00:00:00.000Z',
    stopped_at: null,
    ...overrides,
  };
}

const cameraDto: CameraDTO = {
  id: 'cam-001',
  tenantId: 'tenant-1',
  outletId: 'outlet-1',
  bridgeId: 'bridge-1',
  name: 'Entrance',
  rtspUrl: 'rtsp://192.168.1.100:554/stream',
  location: 'Front',
  deviceId: null,
  isActive: true,
  isStreaming: false,
  lastFrameAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function makeService(opts: {
  query?: ReturnType<typeof vi.fn>;
  storageEnabled?: boolean;
  storagePut?: ReturnType<typeof vi.fn>;
  storageGet?: ReturnType<typeof vi.fn>;
  dispatch?: Partial<BridgeDispatchService>;
} = {}) {
  const query = opts.query ?? vi.fn().mockResolvedValue({ rows: [] });
  const pool = { query } as never;

  const put = opts.storagePut ?? vi.fn().mockResolvedValue(undefined);
  const get = opts.storageGet ?? vi.fn().mockResolvedValue(null);
  const storage = {
    isEnabled: () => opts.storageEnabled ?? false,
    put,
    get,
  } as unknown as StorageService;

  const dispatch = (opts.dispatch ?? {
    dispatchStreamStart: vi.fn().mockReturnValue(true),
    dispatchStreamStop: vi.fn().mockReturnValue(true),
  }) as unknown as BridgeDispatchService;

  const bridgeEvents = new BridgeEvents();
  const service = new CctvService(pool, storage, dispatch, bridgeEvents);
  service.subscribeToBridge();
  return { service, query, put, get, dispatch, bridgeEvents };
}

describe('CctvService - live relay', () => {
  it('buffers a relayed segment and serves it by name', () => {
    const { service, bridgeEvents } = makeService();
    bridgeEvents.emit('hls:segment', {
      bridgeId: 'b',
      tenantId: 't',
      outletId: 'o',
      cameraId: 'cam-001',
      name: 'seg0.ts',
      dataB64: Buffer.from('hello').toString('base64'),
      durationSec: 4,
      seq: 0,
    });

    const seg = service.getLiveSegment('cam-001', 'seg0.ts');
    expect(seg).not.toBeNull();
    expect(seg!.toString()).toBe('hello');
  });

  it('caps the live ring buffer at 6 segments', () => {
    const { service, bridgeEvents } = makeService();
    for (let i = 0; i < 8; i++) {
      bridgeEvents.emit('hls:segment', {
        bridgeId: 'b',
        tenantId: 't',
        outletId: 'o',
        cameraId: 'cam-001',
        name: `seg${i}.ts`,
        dataB64: Buffer.from(`s${i}`).toString('base64'),
        durationSec: 4,
        seq: i,
      });
    }
    // First two aged out; last six retained.
    expect(service.getLiveSegment('cam-001', 'seg0.ts')).toBeNull();
    expect(service.getLiveSegment('cam-001', 'seg1.ts')).toBeNull();
    expect(service.getLiveSegment('cam-001', 'seg7.ts')).not.toBeNull();
  });

  it('returns the agent playlist when present and starts streaming', async () => {
    const { service, bridgeEvents, dispatch } = makeService();
    bridgeEvents.emit('hls:playlist', {
      bridgeId: 'b',
      tenantId: 't',
      outletId: 'o',
      cameraId: 'cam-001',
      m3u8: '#EXTM3U\n#EXT-X-VERSION:3\n',
    });

    const playlist = await service.getLivePlaylist(cameraDto);
    expect(playlist).toContain('#EXTM3U');
    expect(dispatch.dispatchStreamStart).toHaveBeenCalledWith('outlet-1', {
      cameraId: 'cam-001',
      rtspUrl: cameraDto.rtspUrl,
    });
  });

  it('synthesises a playlist from the ring buffer when the agent sent none', async () => {
    const { service, bridgeEvents } = makeService();
    bridgeEvents.emit('hls:segment', {
      bridgeId: 'b',
      tenantId: 't',
      outletId: 'o',
      cameraId: 'cam-001',
      name: 'seg5.ts',
      dataB64: Buffer.from('x').toString('base64'),
      durationSec: 4,
      seq: 5,
    });
    const playlist = await service.getLivePlaylist(cameraDto);
    expect(playlist).toContain('#EXTM3U');
    expect(playlist).toContain('#EXT-X-MEDIA-SEQUENCE:5');
    expect(playlist).toContain('seg5.ts');
  });
});

describe('CctvService - camera CRUD', () => {
  it('lists cameras for an outlet', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [cameraRow()] });
    const { service } = makeService({ query });

    const cameras = await service.listByOutlet('tenant-1', 'outlet-1');
    expect(cameras).toHaveLength(1);
    expect(cameras[0]!.id).toBe('cam-001');
    expect(cameras[0]!.rtspUrl).toBe('rtsp://192.168.1.100:554/stream');
  });

  it('throws NotFound when a camera does not exist', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const { service } = makeService({ query });
    await expect(service.getCamera('tenant-1', 'nope')).rejects.toThrow(NotFoundException);
  });

  it('creates a camera', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [cameraRow()] });
    const { service } = makeService({ query });
    const created = await service.createCamera('tenant-1', {
      outletId: 'outlet-1',
      name: 'Entrance',
      rtspUrl: 'rtsp://192.168.1.100:554/stream',
    });
    expect(created.name).toBe('Entrance');
  });
});

describe('CctvService - recording', () => {
  it('starts a recording, inserting a camera_recordings row', async () => {
    const query = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('FROM cameras')) return Promise.resolve({ rows: [cameraRow()] });
      if (sql.includes('INSERT INTO camera_recordings')) {
        return Promise.resolve({ rows: [recordingRow()] });
      }
      return Promise.resolve({ rows: [] });
    });
    const { service, dispatch } = makeService({ query });

    const rec = await service.startRecording('tenant-1', 'cam-001', 'order-1');
    expect(rec.status).toBe('recording');
    expect(rec.cameraId).toBe('cam-001');
    expect(dispatch.dispatchStreamStart).toHaveBeenCalled();
  });

  it('rejects a second concurrent recording for the same camera', async () => {
    const query = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('FROM cameras')) return Promise.resolve({ rows: [cameraRow()] });
      if (sql.includes('INSERT INTO camera_recordings')) {
        return Promise.resolve({ rows: [recordingRow()] });
      }
      return Promise.resolve({ rows: [] });
    });
    const { service } = makeService({ query });
    await service.startRecording('tenant-1', 'cam-001');
    await expect(service.startRecording('tenant-1', 'cam-001')).rejects.toThrow(ConflictException);
  });

  it('persists incoming segments to storage while recording', async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn().mockImplementation((sql: string, params: unknown[]) => {
      if (sql.includes('FROM cameras')) return Promise.resolve({ rows: [cameraRow()] });
      if (sql.includes('INSERT INTO camera_recordings')) {
        return Promise.resolve({
          rows: [recordingRow({ id: params[0], storage_prefix: params[5] })],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    const { service, bridgeEvents } = makeService({ query, storageEnabled: true, storagePut: put });

    const rec = await service.startRecording('tenant-1', 'cam-001', 'order-1');
    bridgeEvents.emit('hls:segment', {
      bridgeId: 'b',
      tenantId: 't',
      outletId: 'o',
      cameraId: 'cam-001',
      name: 'seg0.ts',
      dataB64: Buffer.from('data').toString('base64'),
      durationSec: 4,
      seq: 0,
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(put).toHaveBeenCalledWith(`${rec.storagePrefix}seg0.ts`, expect.any(Buffer), 'video/mp2t');
  });

  it('stops a recording, writing a VOD index and finalising the row', async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn().mockImplementation((sql: string, params: unknown[]) => {
      if (sql.includes('FROM cameras')) return Promise.resolve({ rows: [cameraRow()] });
      if (sql.includes('INSERT INTO camera_recordings')) {
        return Promise.resolve({
          rows: [recordingRow({ id: params[0], storage_prefix: params[5] })],
        });
      }
      if (sql.includes('UPDATE camera_recordings')) {
        return Promise.resolve({
          rows: [
            recordingRow({
              id: params[0],
              status: 'completed',
              segment_count: 1,
              duration_seconds: 4,
            }),
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    const { service, bridgeEvents } = makeService({ query, storageEnabled: true, storagePut: put });

    const rec = await service.startRecording('tenant-1', 'cam-001', 'order-1');
    bridgeEvents.emit('hls:segment', {
      bridgeId: 'b',
      tenantId: 't',
      outletId: 'o',
      cameraId: 'cam-001',
      name: 'seg0.ts',
      dataB64: Buffer.from('data').toString('base64'),
      durationSec: 4,
      seq: 0,
    });
    await new Promise((r) => setTimeout(r, 0));

    const stopped = await service.stopRecording('tenant-1', rec.id);
    expect(stopped.status).toBe('completed');
    expect(put).toHaveBeenCalledWith(
      `${rec.storagePrefix}index.m3u8`,
      expect.any(Buffer),
      'application/vnd.apple.mpegurl',
    );
  });

  it('lists recordings with optional filters', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [recordingRow({ status: 'completed' })] });
    const { service } = makeService({ query });
    const recs = await service.listRecordings('tenant-1', { cameraId: 'cam-001' });
    expect(recs).toHaveLength(1);
    expect(recs[0]!.cameraId).toBe('cam-001');
    // camera filter should be part of the WHERE clause params
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('camera_id ='),
      expect.arrayContaining(['tenant-1', 'cam-001']),
    );
  });

  it('reads a VOD playlist from storage', async () => {
    const get = vi.fn().mockImplementation((key: string) => {
      if (key.endsWith('index.m3u8')) {
        return Promise.resolve({ body: Readable.from(['#EXTM3U\n#EXT-X-ENDLIST\n']), contentType: 'x' });
      }
      return Promise.resolve(null);
    });
    const query = vi.fn().mockResolvedValue({ rows: [{ storage_prefix: 'recordings/cam-001/rec-001/' }] });
    const { service } = makeService({ query, storageEnabled: true, storageGet: get });

    const playlist = await service.getRecordingPlaylist('tenant-1', 'rec-001');
    expect(playlist).toContain('#EXT-X-ENDLIST');
  });
});
