import net from 'node:net';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Bonjour } from 'bonjour-service';

const execFileAsync = promisify(execFile);
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
/** NVR/DVR service ports (Hikvision 8000, Dahua 37777/37778, XMeye 34567). */
export const NVR_PORTS = [8000, 37777, 37778, 34567];
/** Network-printer ports (JetDirect/raw 9100, LPD 515, IPP 631). */
export const PRINTER_PORTS = [9100, 515, 631];
/**
 * Generic web-admin ports that alone imply "a web-managed device" (router /
 * appliance / camera-or-NVR web UI). HTTPS (443/8443) is deliberately NOT here:
 * TLS alone is too ambiguous to classify (it's probed for info only).
 */
export const WEB_PORTS = [PORT_HTTP, 8080];

/**
 * Every port we TCP-probe on the LAN. Order is not significant; classification
 * is priority-based in classifyByPorts. Kept modest so a /24 sweep stays fast.
 */
export const PROBE_PORTS = [
  PORT_CAMERA_RTSP,
  PORT_MQTT,
  ...NVR_PORTS,
  ...PRINTER_PORTS,
  ...WEB_PORTS,
  443,
  8443,
];

/**
 * Classify a device by which of the probed ports are open, most-specific first:
 * RTSP -> camera, NVR ports -> nvr, printer ports -> printer, MQTT ->
 * iot_controller, any web port -> router (generic web-admin fallback; the real
 * default gateway is re-tagged 'router' explicitly in runScan). null = nothing
 * meaningful open. NOTE: the existing camera/mqtt/http(=80) contract is
 * preserved for backward compatibility (see scanner.test.ts).
 */
export function classifyByPorts(openPorts: number[]): DeviceType | null {
  const has = (ports: number[]) => ports.some((p) => openPorts.includes(p));
  if (openPorts.includes(PORT_CAMERA_RTSP)) return 'camera';
  if (has(NVR_PORTS)) return 'nvr';
  if (has(PRINTER_PORTS)) return 'printer';
  if (openPorts.includes(PORT_MQTT)) return 'iot_controller';
  if (has(WEB_PORTS)) return 'router';
  return null;
}

/**
 * Map an mDNS service type to a device type. Covers cameras, printers/scanners,
 * casting-capable tablets/displays, IoT controllers, and a web-UI fallback.
 */
export function classifyMdnsService(serviceType: string): DeviceType {
  const s = serviceType.toLowerCase();
  if (s.includes('rtsp') || s.includes('onvif')) return 'camera';
  if (
    s.includes('ipp') ||
    s.includes('printer') ||
    s.includes('pdl-datastream') ||
    s.includes('scanner') ||
    s.includes('uscan')
  ) {
    return 'printer';
  }
  if (
    s.includes('airplay') ||
    s.includes('raop') ||
    s.includes('googlecast') ||
    s.includes('spotify-connect') ||
    s.includes('androidtvremote')
  ) {
    return 'tablet';
  }
  if (s.includes('mqtt')) return 'iot_controller';
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

/**
 * Read the OS ARP cache into an ip -> MAC map. A TCP connect (our port probe)
 * populates the cache, so this is called AFTER the sweep. Best-effort: parses
 * both Windows (`arp -a`, dashes) and Linux/mac (`ip neigh` / `arp -an`, colons).
 */
export async function readArpTable(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const parse = (text: string) => {
    // Match "192.168.1.5 ... aa-bb-cc-dd-ee-ff" or "... aa:bb:cc:dd:ee:ff"
    const re =
      /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})[^\n]*?([0-9a-fA-F]{2}([:-])[0-9a-fA-F]{2}(\3[0-9a-fA-F]{2}){4})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const ip = m[1]!;
      const mac = m[2]!.replace(/-/g, ':').toLowerCase();
      if (mac !== 'ff:ff:ff:ff:ff:ff' && mac !== '00:00:00:00:00:00') {
        map.set(ip, mac);
      }
    }
  };
  const cmds: [string, string[]][] =
    process.platform === 'win32'
      ? [['arp', ['-a']]]
      : [
          ['ip', ['neigh']],
          ['arp', ['-an']],
        ];
  for (const [cmd, args] of cmds) {
    try {
      const { stdout } = await execFileAsync(cmd, args, { timeout: 4000 });
      parse(stdout);
      if (map.size > 0) break;
    } catch {
      /* try next command */
    }
  }
  return map;
}

/**
 * Tiny built-in OUI (first 3 MAC octets) -> vendor + likely device-type map for
 * the hardware a car-wash branch actually runs. Not exhaustive; a null vendor
 * just means "unknown", never an error.
 */
const OUI_VENDORS: Record<string, { vendor: string; hint?: DeviceType }> = {
  // Cameras / NVRs
  '44:19:b6': { vendor: 'Hikvision', hint: 'camera' },
  'c0:56:e3': { vendor: 'Hikvision', hint: 'camera' },
  '4c:bd:8f': { vendor: 'Hikvision', hint: 'camera' },
  '3c:ef:8c': { vendor: 'Dahua', hint: 'camera' },
  '90:02:a9': { vendor: 'Dahua', hint: 'camera' },
  '00:40:8c': { vendor: 'Axis', hint: 'camera' },
  'ac:cc:8e': { vendor: 'Axis', hint: 'camera' },
  // Printers
  '00:00:48': { vendor: 'Epson', hint: 'printer' },
  '64:eb:8c': { vendor: 'Seiko Epson', hint: 'printer' },
  '00:01:90': { vendor: 'Star Micronics', hint: 'printer' },
  '00:07:4d': { vendor: 'Zebra', hint: 'printer' },
  '00:80:77': { vendor: 'Brother', hint: 'printer' },
  '3c:2a:f4': { vendor: 'Brother', hint: 'printer' },
  '00:1b:a9': { vendor: 'Brother', hint: 'printer' },
  '9c:93:4e': { vendor: 'Xerox', hint: 'printer' },
  '00:15:99': { vendor: 'Samsung', hint: 'tablet' },
  // IoT controllers (ESP32/ESP8266)
  '24:0a:c4': { vendor: 'Espressif', hint: 'iot_controller' },
  '30:ae:a4': { vendor: 'Espressif', hint: 'iot_controller' },
  '7c:9e:bd': { vendor: 'Espressif', hint: 'iot_controller' },
  'b4:e6:2d': { vendor: 'Espressif', hint: 'iot_controller' },
  // Tablets / SBCs used as kiosks
  'b8:27:eb': { vendor: 'Raspberry Pi', hint: 'kiosk' },
  'dc:a6:32': { vendor: 'Raspberry Pi', hint: 'kiosk' },
  'e4:5f:01': { vendor: 'Raspberry Pi', hint: 'kiosk' },
  '3c:5a:b4': { vendor: 'Google', hint: 'tablet' },
  '68:3e:34': { vendor: 'Apple', hint: 'tablet' },
  '00:1c:b3': { vendor: 'Apple', hint: 'tablet' },
  'f0:18:98': { vendor: 'Apple', hint: 'tablet' },
  // Routers / networking
  'b0:be:76': { vendor: 'TP-Link', hint: 'router' },
  '50:c7:bf': { vendor: 'TP-Link', hint: 'router' },
  '00:0e:8f': { vendor: 'ZTE', hint: 'router' },
  'f4:6d:2f': { vendor: 'Ubiquiti', hint: 'router' },
};

/** Look up a MAC's vendor + device-type hint from the built-in OUI table. */
export function vendorFromMac(
  mac: string | null | undefined,
): { vendor: string; hint?: DeviceType } | null {
  if (!mac) return null;
  const oui = mac.toLowerCase().split(':').slice(0, 3).join(':');
  return OUI_VENDORS[oui] ?? null;
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
        if (type === 'camera' || type === 'nvr') cp.rtsp_url = `rtsp://${ip}:554/`;
        devices.push({
          ip_address: ip,
          device_type: type,
          manufacturer: null,
          model: null,
          connection_params: cp,
        });
      }
    });
    // Enrich with MAC + vendor from the ARP cache (populated by the probes above).
    // A vendor OUI can also REFINE the type — e.g. a host with only a web port
    // but an Espressif MAC is a controller, a Hikvision MAC a camera, etc.
    const arp = await readArpTable();
    for (const d of devices) {
      const mac = arp.get(d.ip_address);
      if (!mac) continue;
      const cp = (d.connection_params ??= {} as Record<string, unknown>);
      cp.mac = mac;
      const v = vendorFromMac(mac);
      if (v) {
        d.manufacturer = d.manufacturer ?? v.vendor;
        cp.vendor = v.vendor;
        // Only let the vendor hint override a weak (web-fallback) classification.
        if (v.hint && d.device_type === 'router' && v.hint !== 'router') {
          d.device_type = v.hint;
          if ((v.hint === 'camera' || v.hint === 'nvr') && !cp.rtsp_url) {
            cp.rtsp_url = `rtsp://${d.ip_address}:554/`;
          }
        }
      }
    }
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
    // Prefer a more specific type when the same IP is seen by multiple protocols.
    // Higher rank = more specific/trustworthy; 'router'/'unknown' are weak fallbacks.
    const rank: Record<DeviceType, number> = {
      camera: 9,
      nvr: 9,
      printer: 8,
      iot_controller: 7,
      pos_terminal: 6,
      kiosk: 6,
      tablet: 5,
      router: 2,
      unknown: 1,
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
