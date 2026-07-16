import { describe, it, expect } from 'vitest';
import {
  classifyByPorts,
  classifyMdnsService,
  deriveLocalSubnet,
  hostsInSubnet,
  dedupeByIp,
  simulatedDevices,
  PORT_CAMERA_RTSP,
  PORT_MQTT,
  PORT_HTTP,
  injectRtspCreds,
  stripRtspCreds,
  detectNvrVendor,
  nvrLiveUrl,
  nvrPlaybackUrl,
} from './scanner';

describe('NVR url helpers', () => {
  it('injects and strips rtsp credentials', () => {
    expect(injectRtspCreds('rtsp://10.0.0.2:554/x', 'admin', 'p@ss')).toBe(
      'rtsp://admin:p%40ss@10.0.0.2:554/x',
    );
    expect(injectRtspCreds('rtsp://u:old@10.0.0.2/x', 'admin', 'new')).toBe(
      'rtsp://admin:new@10.0.0.2/x',
    );
    expect(injectRtspCreds('rtsp://10.0.0.2/x', '', '')).toBe('rtsp://10.0.0.2/x');
    expect(stripRtspCreds('rtsp://admin:p@10.0.0.2:554/x')).toBe('rtsp://10.0.0.2:554/x');
  });
  it('detects vendor', () => {
    expect(detectNvrVendor('HIKVISION')).toBe('hikvision');
    expect(detectNvrVendor('Dahua Technology')).toBe('dahua');
    expect(detectNvrVendor('Acme')).toBe('onvif');
    expect(detectNvrVendor(null)).toBe('onvif');
  });
  it('builds hikvision live + playback urls (main/sub)', () => {
    expect(nvrLiveUrl('hikvision', '10.0.0.2', 554, 3, 'main')).toBe(
      'rtsp://10.0.0.2:554/Streaming/Channels/301',
    );
    expect(nvrLiveUrl('hikvision', '10.0.0.2', 554, 3, 'sub')).toBe(
      'rtsp://10.0.0.2:554/Streaming/Channels/302',
    );
    expect(
      nvrPlaybackUrl('hikvision', '10.0.0.2', 554, 1, '2026-01-02T03:04:05Z', '2026-01-02T04:04:05Z'),
    ).toBe(
      'rtsp://10.0.0.2:554/Streaming/tracks/101?starttime=20260102T030405Z&endtime=20260102T040405Z',
    );
  });
  it('builds dahua live + playback urls (main/sub)', () => {
    expect(nvrLiveUrl('dahua', '10.0.0.2', 554, 2, 'main')).toBe(
      'rtsp://10.0.0.2:554/cam/realmonitor?channel=2&subtype=0',
    );
    expect(nvrLiveUrl('dahua', '10.0.0.2', 554, 2, 'sub')).toBe(
      'rtsp://10.0.0.2:554/cam/realmonitor?channel=2&subtype=1',
    );
    expect(
      nvrPlaybackUrl('dahua', '10.0.0.2', 554, 2, '2026-01-02T03:04:05Z', '2026-01-02T04:04:05Z'),
    ).toBe(
      'rtsp://10.0.0.2:554/cam/playback?channel=2&subtype=0&starttime=2026_01_02_03_04_05&endtime=2026_01_02_04_04_05',
    );
  });
});

describe('classifyByPorts', () => {
  it('maps RTSP 554 -> camera', () => {
    expect(classifyByPorts([PORT_CAMERA_RTSP])).toBe('camera');
  });
  it('maps MQTT 1883 -> iot_controller', () => {
    expect(classifyByPorts([PORT_MQTT])).toBe('iot_controller');
  });
  it('maps HTTP 80 -> router', () => {
    expect(classifyByPorts([PORT_HTTP])).toBe('router');
  });
  it('prefers camera when RTSP + HTTP both open', () => {
    expect(classifyByPorts([PORT_HTTP, PORT_CAMERA_RTSP])).toBe('camera');
  });
  it('prefers iot_controller over router', () => {
    expect(classifyByPorts([PORT_HTTP, PORT_MQTT])).toBe('iot_controller');
  });
  it('returns null when nothing relevant is open', () => {
    expect(classifyByPorts([])).toBeNull();
    expect(classifyByPorts([22, 443])).toBeNull();
  });
});

describe('classifyMdnsService', () => {
  it('rtsp -> camera, mqtt -> iot_controller, http -> router', () => {
    expect(classifyMdnsService('rtsp')).toBe('camera');
    expect(classifyMdnsService('mqtt')).toBe('iot_controller');
    expect(classifyMdnsService('http')).toBe('router');
  });
});

describe('deriveLocalSubnet', () => {
  it('derives a /24 from a non-internal IPv4 interface', () => {
    const subnet = deriveLocalSubnet({
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true } as any],
      eth0: [{ address: '192.168.7.42', family: 'IPv4', internal: false } as any],
    });
    expect(subnet).toBe('192.168.7.0/24');
  });
  it('returns null when only internal interfaces exist', () => {
    expect(
      deriveLocalSubnet({
        lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true } as any],
      }),
    ).toBeNull();
  });
});

describe('hostsInSubnet', () => {
  it('enumerates 254 hosts for a /24', () => {
    const hosts = hostsInSubnet('10.0.0.0/24');
    expect(hosts).toHaveLength(254);
    expect(hosts[0]).toBe('10.0.0.1');
    expect(hosts[253]).toBe('10.0.0.254');
  });
  it('returns empty for non-/24', () => {
    expect(hostsInSubnet('10.0.0.0/16')).toHaveLength(0);
  });
});

describe('dedupeByIp', () => {
  it('merges by ip and keeps the most specific device_type', () => {
    const out = dedupeByIp([
      { ip_address: '1.1.1.1', device_type: 'router', manufacturer: null, model: null, connection_params: { a: 1 } },
      { ip_address: '1.1.1.1', device_type: 'camera', manufacturer: 'Acme', model: 'X', connection_params: { b: 2 } },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].device_type).toBe('camera');
    expect(out[0].manufacturer).toBe('Acme');
    expect(out[0].connection_params).toEqual({ a: 1, b: 2 });
  });
});

describe('simulatedDevices', () => {
  it('emits a camera with a test: rtsp_url and an iot_controller', () => {
    const devices = simulatedDevices();
    const cam = devices.find((d) => d.device_type === 'camera');
    const iot = devices.find((d) => d.device_type === 'iot_controller');
    expect(cam).toBeTruthy();
    expect(iot).toBeTruthy();
    expect(String(cam!.connection_params!.rtsp_url)).toMatch(/^test:/);
    expect(cam!.ip_address).toBe('127.0.0.1');
  });
});
