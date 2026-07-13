import { describe, it, expect } from 'vitest';
import { runScan } from './scanner';
import {
  buildRealFfmpegArgs,
  buildSimulatedFfmpegArgs,
  buildWebcamFfmpegArgs,
  isSimulatedSource,
  isWebcamSource,
  webcamDevice,
  parseFirstDshowVideo,
  parseSegmentSeq,
  HLS_SEGMENT_SECONDS,
} from './streamer';
import type { DeviceEvent, ScanDoneEvent } from './types';

describe('simulate scan emit contract', () => {
  it('emits device events + a scan:done matching the protocol shape', async () => {
    const deviceEvents: DeviceEvent[] = [];
    const scanId = 'scan-123';

    const outcome = await runScan({ simulate: true }, (device) => {
      // Mirror what index.ts emits per device.
      deviceEvents.push({ scanId, device });
    });

    // Each device event must carry scanId + a DiscoveredDeviceInput.
    expect(deviceEvents.length).toBeGreaterThanOrEqual(2);
    for (const ev of deviceEvents) {
      expect(ev.scanId).toBe(scanId);
      expect(ev.device).toHaveProperty('ip_address');
      expect(ev.device).toHaveProperty('device_type');
      expect(ev.device).toHaveProperty('manufacturer');
      expect(ev.device).toHaveProperty('model');
      expect(['camera', 'iot_controller', 'router']).toContain(
        ev.device.device_type,
      );
    }

    const scanDone: ScanDoneEvent = {
      scanId,
      count: outcome.devices.length,
      errors: outcome.errors,
    };
    expect(scanDone.count).toBe(deviceEvents.length);
    expect(scanDone.errors).toEqual([]);
  });
});

describe('ffmpeg arg builders', () => {
  it('real args copy video and produce hls', () => {
    const args = buildRealFfmpegArgs('rtsp://cam/stream', '/tmp/out');
    expect(args).toContain('-rtsp_transport');
    expect(args).toContain('rtsp://cam/stream');
    expect(args).toContain('copy');
    expect(args).toContain('hls');
    expect(args).toContain(String(HLS_SEGMENT_SECONDS));
    expect(args[args.length - 1]).toContain('index.m3u8');
  });

  it('simulated args use a lavfi test source', () => {
    const args = buildSimulatedFfmpegArgs('/tmp/out');
    expect(args).toContain('lavfi');
    expect(args.some((a) => a.startsWith('testsrc='))).toBe(true);
    expect(args).toContain('libx264');
  });
});

describe('isSimulatedSource', () => {
  it('true when simulate flag set or url uses test: scheme', () => {
    expect(isSimulatedSource('rtsp://cam', true)).toBe(true);
    expect(isSimulatedSource('test:cam-1', false)).toBe(true);
    expect(isSimulatedSource('rtsp://cam', false)).toBe(false);
  });
});

describe('webcam source', () => {
  it('detects the webcam: scheme and extracts the device', () => {
    expect(isWebcamSource('webcam:')).toBe(true);
    expect(isWebcamSource('webcam:Integrated Camera')).toBe(true);
    expect(isWebcamSource('rtsp://cam')).toBe(false);
    expect(isWebcamSource('test:x')).toBe(false);
    expect(webcamDevice('webcam:Integrated Camera')).toBe('Integrated Camera');
    expect(webcamDevice('webcam:')).toBe('');
    expect(webcamDevice('rtsp://cam')).toBe('');
  });

  it('a webcam: url is NOT treated as a simulated source (real capture)', () => {
    expect(isSimulatedSource('webcam:', false)).toBe(false);
  });

  it('builds OS-specific capture args that produce hls', () => {
    const win = buildWebcamFfmpegArgs('Integrated Camera', '/tmp/out', 'win32');
    expect(win).toContain('dshow');
    expect(win).toContain('video=Integrated Camera');
    expect(win).toContain('libx264');
    expect(win[win.length - 1]).toContain('index.m3u8');

    const lin = buildWebcamFfmpegArgs('', '/tmp/out', 'linux');
    expect(lin).toContain('v4l2');
    expect(lin).toContain('/dev/video0');

    const mac = buildWebcamFfmpegArgs('', '/tmp/out', 'darwin');
    expect(mac).toContain('avfoundation');
    expect(mac).toContain('0');
  });

  it('parses the first dshow video device from ffmpeg output', () => {
    const out = [
      '[dshow @ 0x1] "Integrated Camera" (video)',
      '[dshow @ 0x1]   Alternative name "@device_pnp_..."',
      '[dshow @ 0x1] "Microphone Array" (audio)',
    ].join('\n');
    expect(parseFirstDshowVideo(out)).toBe('Integrated Camera');
    expect(parseFirstDshowVideo('nothing here')).toBeNull();
  });
});

describe('parseSegmentSeq', () => {
  it('extracts sequence numbers and rejects non-segments', () => {
    expect(parseSegmentSeq('seg_0.ts')).toBe(0);
    expect(parseSegmentSeq('seg_42.ts')).toBe(42);
    expect(parseSegmentSeq('index.m3u8')).toBeNull();
    expect(parseSegmentSeq('seg_x.ts')).toBeNull();
  });
});
