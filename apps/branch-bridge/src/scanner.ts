import net from 'node:net';
import os from 'node:os';
import { Bonjour } from 'bonjour-service';
import { Client as SsdpClient } from 'node-ssdp';
import { Discovery, type OnvifProbeMatch } from 'onvif';
import type {
  DeviceType,
  DiscoveredDeviceInput,
  ScanError,
} from './types';

/** Ports we probe on the LAN and how each maps to a device type. */
export const PORT_CAMERA_RTSP = 554;
export const PORT_MQTT = 1883;
export const PORT_HTTP = 80;
export const PROBE_PORTS = [PORT_CAMERA_RTSP, PORT_MQTT, PORT_HTTP];

/**
 * Classify a device by which of the probed ports are open.
 * Priority: RTSP (camera) > MQTT (iot_controller) > HTTP (router).
 * Returns null when no meaningful port is open.
 */
export function classifyByPorts(openPorts: number[]): DeviceType | null {
  if (openPorts.includes(PORT_CAMERA_RTSP)) return 'camera';
  if (openPorts.includes(PORT_MQTT)) return 'iot_controller';
  if (openPorts.includes(PORT_HTTP)) return 'router';
  return null;
}

/**
 * Map an mDNS service type to a device type.
 * `_rtsp._tcp` -> camera, `_mqtt._tcp` -> iot_controller, `_http._tcp` -> router.
 */
export function classifyMdnsService(serviceType: string): DeviceType {
  if (serviceType.includes('rtsp')) return 'camera';
  if (serviceType.includes('mqtt')) return 'iot_controller';
  return 'router';
}

/** True for a private (RFC1918) IPv4 address. */
function isPrivateV4(address: string): boolean {
  const o = address.split('.').map((n) => parseInt(n, 10));
  if (o.length !== 4 || o.some((n) => Number.isNaN(n))) return false;
  if (o[0] === 10) return true;
  if (o[0] === 172 && o[1]! >= 16 && o[1]! <= 31) return true;
  if (o[0] === 192 && o[1] === 168) return true;
  return false;
}

/**
 * Interface-name patterns that are virtual/host-only adapters (WSL, Docker,
 * Hyper-V, VirtualBox/VMware, loopback-ish). We DE-PRIORITISE these — a real
 * branch camera is on the physical LAN, and picking a virtual adapter's subnet
 * (e.g. WSL's 192.168.208.0/24) makes the scan silently find nothing.
 */
function isVirtualAdapter(name: string): boolean {
  return /vethernet|wsl|docker|hyper-v|virtualbox|vmware|vmnet|loopback|tailscale|zerotier|utun|tun\d|tap\d/i.test(
    name,
  );
}

/**
 * Every distinct private /24 CIDR across the host's non-internal IPv4
 * interfaces, physical adapters first (virtual/host-only adapters last).
 * We scan ALL of them so a machine with WSL/Docker/VPN adapters still covers
 * the real LAN. Returns e.g. ["192.168.1.0/24", "192.168.208.0/24"].
 */
export function deriveLocalSubnets(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): string[] {
  const physical: string[] = [];
  const virtual: string[] = [];
  for (const [name, infos] of Object.entries(interfaces)) {
    if (!infos) continue;
    for (const info of infos) {
      // node >=18 reports family as 'IPv4'; older as 4.
      const isV4 = info.family === 'IPv4' || (info.family as unknown) === 4;
      if (!isV4 || info.internal || !isPrivateV4(info.address)) continue;
      const octets = info.address.split('.');
      if (octets.length !== 4) continue;
      const cidr = `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
      (isVirtualAdapter(name) ? virtual : physical).push(cidr);
    }
  }
  return [...new Set([...physical, ...virtual])];
}

/**
 * Derive a single local /24 CIDR — the first PHYSICAL private interface (falls
 * back to any private interface). Kept for callers/tests that want one subnet.
 * Returns e.g. "192.168.1.0/24", or null when no suitable interface exists.
 */
export function deriveLocalSubnet(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): string | null {
  return deriveLocalSubnets(interfaces)[0] ?? null;
}

/**
 * Enumerate host addresses for a /24 CIDR (skips .0 network and .255 broadcast).
 */
export function hostsInSubnet(cidr: string): string[] {
  const [base, maskRaw] = cidr.split('/');
  const mask = parseInt(maskRaw ?? '24', 10);
  if (mask !== 24) {
    // Only /24 is supported for the simple probe.
    return [];
  }
  const octets = base.split('.');
  if (octets.length !== 4) return [];
  const prefix = `${octets[0]}.${octets[1]}.${octets[2]}`;
  const hosts: string[] = [];
  for (let i = 1; i <= 254; i += 1) {
    hosts.push(`${prefix}.${i}`);
  }
  return hosts;
}

/** Attempt a TCP connect to ip:port; resolves true if the port accepts. */
export function probePort(
  ip: string,
  port: number,
  timeoutMs = 400,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, ip);
  });
}

/** Run an async mapper over items with a bounded concurrency. */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(concurrency, items.length))
    .fill(0)
    .map(async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        results[index] = await fn(items[index]);
      }
    });
  await Promise.all(workers);
  return results;
}

/** Normalise a possibly-array onvif scope/name field to a single string. */
function firstString(value: unknown): string | null {
  if (Array.isArray(value)) return value.length ? String(value[0]) : null;
  if (typeof value === 'string') return value;
  return null;
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Individual protocol scans. Each resolves { devices, error? } and never throws.
// ---------------------------------------------------------------------------

interface ProtocolResult {
  protocol: string;
  devices: DiscoveredDeviceInput[];
  error?: ScanError;
}

async function scanOnvif(timeoutMs: number): Promise<ProtocolResult> {
  const protocol = 'onvif';
  return new Promise<ProtocolResult>((resolve) => {
    try {
      Discovery.probe(
        { timeout: timeoutMs, resolve: false },
        (err: Error | null, cams: OnvifProbeMatch[]) => {
          if (err) {
            resolve({
              protocol,
              devices: [],
              error: { protocol, message: err.message },
            });
            return;
          }
          const devices: DiscoveredDeviceInput[] = (cams || []).map((cam) => {
            const xaddr =
              (cam.xaddrs && cam.xaddrs[0]) || cam.xaddr || '';
            const ip = xaddr ? hostFromUrl(xaddr) ?? '' : '';
            return {
              ip_address: ip,
              device_type: 'camera' as DeviceType,
              manufacturer: firstString(cam.hardware) ?? firstString(cam.name),
              model: firstString(cam.name),
              connection_params: { onvif_xaddr: xaddr },
            };
          }).filter((d) => d.ip_address);
          resolve({ protocol, devices });
        },
      );
    } catch (e) {
      resolve({
        protocol,
        devices: [],
        error: { protocol, message: (e as Error).message },
      });
    }
  });
}

async function scanMdns(timeoutMs: number): Promise<ProtocolResult> {
  const protocol = 'mdns';
  const serviceTypes = [
    { type: 'rtsp', protocol: 'tcp' as const },
    { type: 'http', protocol: 'tcp' as const },
    { type: 'mqtt', protocol: 'tcp' as const },
  ];
  const bonjour = new Bonjour();
  const devices: DiscoveredDeviceInput[] = [];
  try {
    const browsers = serviceTypes.map((svc) =>
      bonjour.find({ type: svc.type, protocol: svc.protocol }, (service) => {
        const ip =
          (service.addresses || []).find((a) => net.isIPv4(a)) ||
          service.referer?.address ||
          service.host;
        if (!ip) return;
        devices.push({
          ip_address: ip,
          device_type: classifyMdnsService(svc.type),
          manufacturer: null,
          model: service.name || service.fqdn || null,
          connection_params: {
            mdns_service: `_${svc.type}._${svc.protocol}`,
            port: service.port,
            host: service.host,
          },
        });
      }),
    );
    await new Promise((r) => setTimeout(r, timeoutMs));
    browsers.forEach((b) => b.stop());
    return { protocol, devices };
  } catch (e) {
    return {
      protocol,
      devices,
      error: { protocol, message: (e as Error).message },
    };
  } finally {
    bonjour.destroy();
  }
}

async function scanSsdp(timeoutMs: number): Promise<ProtocolResult> {
  const protocol = 'ssdp';
  const devices: DiscoveredDeviceInput[] = [];
  const client = new SsdpClient();
  return new Promise<ProtocolResult>((resolve) => {
    client.on('response', (headers, _code, rinfo) => {
      const ip = rinfo?.address;
      if (!ip) return;
      const h = headers as Record<string, unknown>;
      const location =
        (h.LOCATION as string | undefined) || (h.Location as string | undefined);
      const server =
        (h.SERVER as string | undefined) || (h.Server as string | undefined) || null;
      // NVRs/routers advertised via SSDP -> classify as router by default.
      devices.push({
        ip_address: ip,
        device_type: 'router',
        manufacturer: server,
        model: null,
        connection_params: location ? { ssdp_location: location } : {},
      });
    });
    try {
      client.search('ssdp:all');
    } catch (e) {
      client.stop();
      resolve({
        protocol,
        devices,
        error: { protocol, message: (e as Error).message },
      });
      return;
    }
    setTimeout(() => {
      client.stop();
      resolve({ protocol, devices });
    }, timeoutMs);
  });
}

async function scanTcpSubnet(
  subnet: string,
  timeoutMs: number,
): Promise<ProtocolResult> {
  const protocol = 'tcp';
  try {
    const hosts = hostsInSubnet(subnet);
    if (hosts.length === 0) {
      return {
        protocol,
        devices: [],
        error: { protocol, message: `unsupported subnet: ${subnet}` },
      };
    }
    const devices: DiscoveredDeviceInput[] = [];
    await mapWithConcurrency(hosts, 64, async (ip) => {
      const openPorts: number[] = [];
      for (const port of PROBE_PORTS) {
        // eslint-disable-next-line no-await-in-loop
        if (await probePort(ip, port, timeoutMs)) openPorts.push(port);
      }
      const type = classifyByPorts(openPorts);
      if (type) {
        const cp: Record<string, unknown> = { open_ports: openPorts };
        if (type === 'camera') cp.rtsp_url = `rtsp://${ip}:554/`;
        devices.push({
          ip_address: ip,
          device_type: type,
          manufacturer: null,
          model: null,
          connection_params: cp,
        });
      }
    });
    return { protocol, devices };
  } catch (e) {
    return {
      protocol,
      devices: [],
      error: { protocol, message: (e as Error).message },
    };
  }
}

/** De-duplicate discovered devices by ip_address (first wins, merges params). */
export function dedupeByIp(
  devices: DiscoveredDeviceInput[],
): DiscoveredDeviceInput[] {
  const byIp = new Map<string, DiscoveredDeviceInput>();
  for (const device of devices) {
    const existing = byIp.get(device.ip_address);
    if (!existing) {
      byIp.set(device.ip_address, device);
      continue;
    }
    // Prefer a more specific type (camera > iot_controller > router) and merge params.
    const rank: Record<DeviceType, number> = {
      camera: 3,
      iot_controller: 2,
      router: 1,
    };
    const merged: DiscoveredDeviceInput = {
      ...existing,
      device_type:
        rank[device.device_type] > rank[existing.device_type]
          ? device.device_type
          : existing.device_type,
      manufacturer: existing.manufacturer ?? device.manufacturer,
      model: existing.model ?? device.model,
      connection_params: {
        ...(existing.connection_params || {}),
        ...(device.connection_params || {}),
      },
    };
    byIp.set(device.ip_address, merged);
  }
  return [...byIp.values()];
}

/** Two or three synthetic devices for AIRE_SIMULATE mode. */
export function simulatedDevices(): DiscoveredDeviceInput[] {
  return [
    {
      ip_address: '127.0.0.1',
      device_type: 'camera',
      manufacturer: 'AireSim',
      model: 'Virtual Camera',
      // `test:` prefix signals the streamer to use the ffmpeg lavfi source.
      connection_params: { rtsp_url: 'test:sim-cam-1', onvif_xaddr: null },
    },
    {
      ip_address: '127.0.0.2',
      device_type: 'iot_controller',
      manufacturer: 'AireSim',
      model: 'Virtual Bay Controller',
      connection_params: { mqtt_topic: 'aire/+/+/bay/+/sensor' },
    },
    {
      ip_address: '127.0.0.3',
      device_type: 'router',
      manufacturer: 'AireSim',
      model: 'Virtual Router',
      connection_params: {},
    },
  ];
}

export interface ScanOutcome {
  devices: DiscoveredDeviceInput[];
  errors: ScanError[];
}

export interface ScanOptions {
  simulate: boolean;
  subnet?: string;
  protocols?: string[];
  /** Per-protocol discovery window; kept short so the wizard feels responsive. */
  timeoutMs?: number;
}

/**
 * Run a full LAN scan. Each protocol runs independently (Promise.allSettled)
 * so one failure never aborts the others. Returns de-duped devices + errors.
 * `onDevice` is invoked for each unique device as it becomes known.
 */
export async function runScan(
  options: ScanOptions,
  onDevice?: (device: DiscoveredDeviceInput) => void,
): Promise<ScanOutcome> {
  if (options.simulate) {
    const devices = simulatedDevices();
    devices.forEach((d) => onDevice?.(d));
    return { devices, errors: [] };
  }

  const timeoutMs = options.timeoutMs ?? 4000;
  const wanted = options.protocols;
  const want = (p: string) => !wanted || wanted.length === 0 || wanted.includes(p);

  // An explicit SCAN_SUBNET wins; otherwise scan EVERY private /24 the host is
  // on (physical adapters first) so WSL/Docker/VPN adapters can't hide the real LAN.
  const subnets = options.subnet ? [options.subnet] : deriveLocalSubnets();

  const tasks: Promise<ProtocolResult>[] = [];
  if (want('onvif')) tasks.push(scanOnvif(timeoutMs));
  if (want('mdns')) tasks.push(scanMdns(timeoutMs));
  if (want('ssdp')) tasks.push(scanSsdp(timeoutMs));
  if (want('tcp')) {
    if (subnets.length > 0) {
      for (const subnet of subnets) tasks.push(scanTcpSubnet(subnet, 800));
    } else {
      tasks.push(
        Promise.resolve<ProtocolResult>({
          protocol: 'tcp',
          devices: [],
          error: {
            protocol: 'tcp',
            message: 'could not derive a local /24 subnet',
          },
        }),
      );
    }
  }

  const settled = await Promise.allSettled(tasks);
  const allDevices: DiscoveredDeviceInput[] = [];
  const errors: ScanError[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      allDevices.push(...result.value.devices);
      if (result.value.error) errors.push(result.value.error);
    } else {
      errors.push({ protocol: 'unknown', message: String(result.reason) });
    }
  }

  const deduped = dedupeByIp(allDevices);
  deduped.forEach((d) => onDevice?.(d));
  return { devices: deduped, errors };
}
