import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { JWTPayload } from '@aire/shared';
import { CctvController } from './cctv.controller';
import { CctvService, CameraDTO, RecordingDTO } from './cctv.service';

const user: JWTPayload = {
  sub: 'user-1',
  tenant_id: 'tenant-1',
  outlet_id: 'outlet-1',
  role: 'tenant_owner',
  iat: 0,
  exp: 0,
};

const camera: CameraDTO = {
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

const recording: RecordingDTO = {
  id: 'rec-001',
  tenantId: 'tenant-1',
  outletId: 'outlet-1',
  cameraId: 'cam-001',
  orderId: 'order-1',
  status: 'recording',
  storagePrefix: 'recordings/cam-001/rec-001/',
  segmentCount: 0,
  durationSeconds: null,
  startedAt: '2026-01-01T00:00:00.000Z',
  stoppedAt: null,
};

function mockRes() {
  return {
    set: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    type: vi.fn().mockReturnThis(),
  } as never;
}

describe('CctvController', () => {
  let controller: CctvController;
  let service: {
    listByOutlet: ReturnType<typeof vi.fn>;
    getCamera: ReturnType<typeof vi.fn>;
    createCamera: ReturnType<typeof vi.fn>;
    updateCamera: ReturnType<typeof vi.fn>;
    listRecordings: ReturnType<typeof vi.fn>;
    startRecording: ReturnType<typeof vi.fn>;
    stopRecording: ReturnType<typeof vi.fn>;
    getLivePlaylist: ReturnType<typeof vi.fn>;
    getLiveSegment: ReturnType<typeof vi.fn>;
    getRecordingPlaylist: ReturnType<typeof vi.fn>;
    getRecordingSegment: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      listByOutlet: vi.fn().mockResolvedValue([camera]),
      getCamera: vi.fn().mockResolvedValue(camera),
      createCamera: vi.fn().mockResolvedValue(camera),
      updateCamera: vi.fn().mockResolvedValue(camera),
      listRecordings: vi.fn().mockResolvedValue([recording]),
      startRecording: vi.fn().mockResolvedValue(recording),
      stopRecording: vi.fn().mockResolvedValue({ ...recording, status: 'completed' }),
      getLivePlaylist: vi.fn().mockResolvedValue('#EXTM3U\n'),
      getLiveSegment: vi.fn().mockReturnValue(Buffer.from('ts')),
      getRecordingPlaylist: vi.fn().mockResolvedValue('#EXTM3U\n#EXT-X-ENDLIST\n'),
      getRecordingSegment: vi.fn().mockResolvedValue(Buffer.from('ts')),
    };
    controller = new CctvController(service as unknown as CctvService);
  });

  describe('cameras', () => {
    it('lists cameras for an outlet', async () => {
      const result = await controller.getCameras(user, 'outlet-1');
      expect(service.listByOutlet).toHaveBeenCalledWith('tenant-1', 'outlet-1');
      expect(result).toHaveLength(1);
    });

    it('requires outletId', async () => {
      await expect(controller.getCameras(user, undefined)).rejects.toThrow(BadRequestException);
    });

    it('creates a camera', async () => {
      const result = await controller.createCamera(user, {
        outletId: 'outlet-1',
        name: 'Entrance',
        rtspUrl: 'rtsp://x',
      });
      expect(result.id).toBe('cam-001');
      expect(service.createCamera).toHaveBeenCalled();
    });

    it('rejects incomplete camera creation', async () => {
      await expect(
        controller.createCamera(user, { outletId: '', name: '', rtspUrl: '' } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates a camera', async () => {
      await controller.updateCamera(user, 'cam-001', { isActive: false });
      expect(service.updateCamera).toHaveBeenCalledWith('tenant-1', 'cam-001', { isActive: false });
    });
  });

  describe('recordings', () => {
    it('lists recordings with filters', async () => {
      await controller.listRecordings(user, 'outlet-1', 'cam-001');
      expect(service.listRecordings).toHaveBeenCalledWith('tenant-1', {
        outletId: 'outlet-1',
        cameraId: 'cam-001',
      });
    });

    it('starts a recording', async () => {
      const result = await controller.startRecording(user, 'cam-001', { orderId: 'order-1' });
      expect(service.startRecording).toHaveBeenCalledWith('tenant-1', 'cam-001', 'order-1');
      expect(result.status).toBe('recording');
    });

    it('stops a recording', async () => {
      const result = await controller.stopRecording(user, 'rec-001');
      expect(service.stopRecording).toHaveBeenCalledWith('tenant-1', 'rec-001');
      expect(result.status).toBe('completed');
    });
  });

  describe('live serving', () => {
    it('serves the live playlist with the HLS content-type', async () => {
      const res = mockRes();
      await controller.livePlaylist(user, 'cam-001', res);
      expect(service.getCamera).toHaveBeenCalledWith('tenant-1', 'cam-001');
      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({ 'Content-Type': 'application/vnd.apple.mpegurl' }),
      );
      expect(res.send).toHaveBeenCalledWith('#EXTM3U\n');
    });

    it('serves a live segment with the mp2t content-type', () => {
      const res = mockRes();
      controller.liveSegment('cam-001', 'seg0.ts', res);
      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({ 'Content-Type': 'video/mp2t' }),
      );
      expect(res.send).toHaveBeenCalled();
    });

    it('404s when a live segment is not buffered', () => {
      service.getLiveSegment.mockReturnValue(null);
      const res = mockRes();
      expect(() => controller.liveSegment('cam-001', 'missing.ts', res)).toThrow(NotFoundException);
    });
  });

  describe('VOD serving', () => {
    it('serves a recording playlist', async () => {
      const res = mockRes();
      await controller.recordingPlaylist(user, 'rec-001', res);
      expect(res.send).toHaveBeenCalledWith('#EXTM3U\n#EXT-X-ENDLIST\n');
    });

    it('404s when a recording playlist is missing', async () => {
      service.getRecordingPlaylist.mockResolvedValue(null);
      const res = mockRes();
      await expect(controller.recordingPlaylist(user, 'rec-001', res)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('serves a recording segment', async () => {
      const res = mockRes();
      await controller.recordingSegment(user, 'rec-001', 'seg0.ts', res);
      expect(res.send).toHaveBeenCalled();
    });
  });
});
