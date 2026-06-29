import { describe, it, expect, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { CctvService, CameraStream } from './cctv.service';

describe('CctvService', () => {
  let service: CctvService;

  const mockCamera: CameraStream = {
    id: 'cam-001',
    outletId: 'outlet-001',
    name: 'Entrance Camera',
    rtspUrl: 'rtsp://192.168.1.100:554/stream1',
    location: 'Main entrance',
    isActive: true,
  };

  const mockCamera2: CameraStream = {
    id: 'cam-002',
    outletId: 'outlet-001',
    name: 'Bay 1 Camera',
    rtspUrl: 'rtsp://192.168.1.101:554/stream1',
    location: 'Wash bay 1',
    isActive: true,
  };

  const mockCameraInactive: CameraStream = {
    id: 'cam-003',
    outletId: 'outlet-001',
    name: 'Inactive Camera',
    rtspUrl: 'rtsp://192.168.1.102:554/stream1',
    location: 'Back entrance',
    isActive: false,
  };

  const mockCameraOtherOutlet: CameraStream = {
    id: 'cam-004',
    outletId: 'outlet-002',
    name: 'Other Outlet Camera',
    rtspUrl: 'rtsp://192.168.1.200:554/stream1',
    location: 'Other outlet entrance',
    isActive: true,
  };

  beforeEach(() => {
    service = new CctvService();
    service.registerCamera(mockCamera);
    service.registerCamera(mockCamera2);
    service.registerCamera(mockCameraInactive);
    service.registerCamera(mockCameraOtherOutlet);
  });

  describe('getStreams', () => {
    it('should return active cameras for a given outlet', () => {
      const result = service.getStreams('outlet-001');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('cam-001');
      expect(result[1].id).toBe('cam-002');
    });

    it('should not include inactive cameras', () => {
      const result = service.getStreams('outlet-001');

      const ids = result.map((c) => c.id);
      expect(ids).not.toContain('cam-003');
    });

    it('should not include cameras from other outlets', () => {
      const result = service.getStreams('outlet-001');

      const ids = result.map((c) => c.id);
      expect(ids).not.toContain('cam-004');
    });

    it('should return empty array for outlet with no cameras', () => {
      const result = service.getStreams('outlet-nonexistent');

      expect(result).toEqual([]);
    });
  });

  describe('getStreamUrl', () => {
    it('should return HLS URL for a valid camera', () => {
      const result = service.getStreamUrl('cam-001');

      expect(result.hlsUrl).toBe('/streams/cam-001/index.m3u8');
    });

    it('should throw NotFoundException for non-existent camera', () => {
      expect(() => service.getStreamUrl('cam-nonexistent')).toThrow(NotFoundException);
    });
  });

  describe('startRecording', () => {
    it('should start a recording session linked to an order', () => {
      const result = service.startRecording('cam-001', 'order-123');

      expect(result.id).toBeDefined();
      expect(result.cameraId).toBe('cam-001');
      expect(result.orderId).toBe('order-123');
      expect(result.status).toBe('recording');
      expect(result.startedAt).toBeDefined();
    });

    it('should generate a unique session id', () => {
      const session1 = service.startRecording('cam-001', 'order-001');
      const session2 = service.startRecording('cam-001', 'order-002');

      expect(session1.id).not.toBe(session2.id);
    });

    it('should throw NotFoundException for non-existent camera', () => {
      expect(() => service.startRecording('cam-nonexistent', 'order-123')).toThrow(
        NotFoundException,
      );
    });
  });

  describe('stopRecording', () => {
    it('should stop an active recording and return the result', () => {
      const session = service.startRecording('cam-001', 'order-123');

      const result = service.stopRecording(session.id);

      expect(result.id).toBe(session.id);
      expect(result.cameraId).toBe('cam-001');
      expect(result.orderId).toBe('order-123');
      expect(result.startedAt).toBe(session.startedAt);
      expect(result.stoppedAt).toBeDefined();
      expect(result.storagePath).toContain('recordings/cam-001/order-123/');
      expect(result.storagePath).toContain('.mp4');
      expect(result.durationSeconds).toBeGreaterThanOrEqual(0);
      expect(result.status).toBe('completed');
    });

    it('should throw NotFoundException for non-existent session', () => {
      expect(() => service.stopRecording('session-nonexistent')).toThrow(NotFoundException);
    });

    it('should throw NotFoundException when stopping an already stopped session', () => {
      const session = service.startRecording('cam-001', 'order-123');
      service.stopRecording(session.id);

      expect(() => service.stopRecording(session.id)).toThrow(NotFoundException);
    });
  });
});
