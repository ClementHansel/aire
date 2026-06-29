import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CctvController } from './cctv.controller';
import { CctvService, CameraStream } from './cctv.service';

describe('CctvController', () => {
  let controller: CctvController;
  let service: CctvService;

  const mockCamera: CameraStream = {
    id: 'cam-001',
    outletId: 'outlet-001',
    name: 'Entrance Camera',
    rtspUrl: 'rtsp://192.168.1.100:554/stream1',
    location: 'Main entrance',
    isActive: true,
  };

  beforeEach(() => {
    service = new CctvService();
    service.registerCamera(mockCamera);
    controller = new CctvController(service);
  });

  describe('GET /api/cctv/cameras', () => {
    it('should return cameras for a given outlet', () => {
      const result = controller.getCameras('outlet-001');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('cam-001');
      expect(result[0].name).toBe('Entrance Camera');
    });

    it('should throw BadRequestException when outletId is missing', () => {
      expect(() => controller.getCameras(undefined)).toThrow(BadRequestException);
    });

    it('should return empty array for outlet with no cameras', () => {
      const result = controller.getCameras('outlet-nonexistent');

      expect(result).toEqual([]);
    });
  });

  describe('GET /api/cctv/cameras/:id/stream', () => {
    it('should return HLS URL for a valid camera', () => {
      const result = controller.getStream('cam-001');

      expect(result.hlsUrl).toBe('/streams/cam-001/index.m3u8');
    });

    it('should throw NotFoundException for non-existent camera', () => {
      expect(() => controller.getStream('cam-nonexistent')).toThrow(NotFoundException);
    });
  });

  describe('POST /api/cctv/cameras/:id/record', () => {
    it('should start recording for a valid camera and order', () => {
      const result = controller.startRecording('cam-001', { orderId: 'order-123' });

      expect(result.cameraId).toBe('cam-001');
      expect(result.orderId).toBe('order-123');
      expect(result.status).toBe('recording');
    });

    it('should throw BadRequestException when orderId is missing', () => {
      expect(() => controller.startRecording('cam-001', { orderId: '' })).toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException for non-existent camera', () => {
      expect(() =>
        controller.startRecording('cam-nonexistent', { orderId: 'order-123' }),
      ).toThrow(NotFoundException);
    });
  });

  describe('DELETE /api/cctv/recordings/:id', () => {
    it('should stop an active recording and return result', () => {
      const session = service.startRecording('cam-001', 'order-123');

      const result = controller.stopRecording(session.id);

      expect(result.id).toBe(session.id);
      expect(result.status).toBe('completed');
      expect(result.storagePath).toContain('.mp4');
    });

    it('should throw NotFoundException for non-existent session', () => {
      expect(() => controller.stopRecording('nonexistent-session')).toThrow(NotFoundException);
    });
  });
});
