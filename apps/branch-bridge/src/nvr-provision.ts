import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { enumerateNvrChannels, type NvrChannel, type NvrVendor } from './scanner';

/**
 * NVR onboarding for the "installer set it and left" reality: the client rarely
 * knows the password, and RTSP/ONVIF are often disabled. This module (1) tries
 * the common vendor default logins, and (2) best-effort ENABLES RTSP + ONVIF
 * over the vendor HTTP API (Hikvision ISAPI / Dahua CGI, HTTP digest auth) so a
 * locked-down NVR becomes usable, then re-enumerates.
 *
 * NOTE: the enable calls are firmware-dependent and can only be fully validated
 * against real hardware; every call is wrapped so a failure degrades gracefully
 * (the NVR still registers, just without channels).
 */

/** Credential (username,password) pairs to try, most-likely first. */
export function candidateCreds(
  vendor: NvrVendor,
  provided?: { username?: string; password?: string },
): Array<{ username: string; password: string }> {
  const list: Array<{ username: string; password: string }> = [];
  if (provided?.username) list.push({ username: provided.username, password: provided.password ?? '' });
  // Common factory defaults (Hikvision commonly admin/12345 pre-activation;
  // Dahua admin/admin; many kits ship admin with a blank or trivial password).
  const defaults =
    vendor === 'dahua'
      ? [['admin', 'admin'], ['admin', ''], ['admin', 'admin123']]
      : [['admin', '12345'], ['admin', ''], ['admin', 'admin'], ['admin', 'admin12345']];
  for (const [u, p] of defaults) {
    if (!list.some((c) => c.username === u && c.password === p)) list.push({ username: u, password: p });
  }
  return list;
}

interface DigestResponse {
  status: number;
  body: string;
}

/** Minimal HTTP request with Digest auth (one 401 challenge round-trip). */
function httpDigest(
  method: string,
  host: string,
  port: number,
  path: string,
  username: string,
  password: string,
  body?: string,
  contentType = 'application/xml',
  timeoutMs = 6000,
): Promise<DigestResponse> {
  const doRequest = (authHeader?: string): Promise<DigestResponse & { headers: http.IncomingHttpHeaders }> =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { host, port, path, method, timeout: timeoutMs, headers: { ...(authHeader ? { Authorization: authHeader } : {}), ...(body ? { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) } : {}) } },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers }));
        },
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(new Error('timeout')); });
      if (body) req.write(body);
      req.end();
    });

  return doRequest().then((first) => {
    if (first.status !== 401) return { status: first.status, body: first.body };
    const wa = String(first.headers['www-authenticate'] ?? '');
    if (!/digest/i.test(wa)) return { status: first.status, body: first.body };
    const get = (k: string) => new RegExp(`${k}="?([^",]+)"?`).exec(wa)?.[1] ?? '';
    const realm = get('realm'), nonce = get('nonce'), qop = get('qop') || 'auth', opaque = get('opaque');
    const md5 = (s: string) => createHash('md5').update(s).digest('hex');
    const ha1 = md5(`${username}:${realm}:${password}`);
    const ha2 = md5(`${method}:${path}`);
    const cnonce = randomBytes(8).toString('hex');
    const nc = '00000001';
    const response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
    let auth = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${path}", qop=${qop}, nc=${nc}, cnonce="${cnonce}", response="${response}"`;
    if (opaque) auth += `, opaque="${opaque}"`;
    return doRequest(auth).then((r) => ({ status: r.status, body: r.body }));
  }).catch(() => ({ status: -1, body: '' }));
}

/** Best-effort enable RTSP + ONVIF on a Hikvision NVR via ISAPI. */
async function enableHikvision(host: string, port: number, u: string, p: string): Promise<boolean> {
  // Enable the ONVIF/open-network integration.
  const onvifBody =
    '<Integrate xmlns="http://www.hikvision.com/ver20/XMLSchema"><ONVIF><enable>true</enable></ONVIF></Integrate>';
  const r1 = await httpDigest('PUT', host, port, '/ISAPI/System/Network/Integrate', u, p, onvifBody);
  // Ensure an ONVIF user exists (admin-mapped). Ignore "already exists".
  const userBody =
    `<UserList xmlns="http://www.hikvision.com/ver20/XMLSchema"><User><userName>${u}</userName><password>${p}</password><userType>admin</userType></User></UserList>`;
  await httpDigest('POST', host, port, '/ISAPI/Security/ONVIF/users', u, p, userBody);
  return r1.status >= 200 && r1.status < 300;
}

/** Best-effort enable RTSP + ONVIF on a Dahua NVR via CGI. */
async function enableDahua(host: string, port: number, u: string, p: string): Promise<boolean> {
  const r1 = await httpDigest(
    'GET', host, port,
    '/cgi-bin/configManager.cgi?action=setConfig&RTSP.Enable=true&UPnP.Enable=true',
    u, p,
  );
  // Dahua exposes ONVIF as a toggle on most firmware.
  await httpDigest('GET', host, port, '/cgi-bin/configManager.cgi?action=setConfig&ONVIF.Enable=true', u, p);
  return r1.status >= 200 && r1.status < 300;
}

async function enableNvrServices(vendor: NvrVendor, host: string, u: string, p: string): Promise<boolean> {
  try {
    if (vendor === 'dahua') return await enableDahua(host, 80, u, p);
    return await enableHikvision(host, 80, u, p);
  } catch {
    return false;
  }
}

export interface NvrResolveResult {
  channels: NvrChannel[];
  username: string;
  password: string;
  /** true if we had to enable services to get channels (diagnostic). */
  autoEnabled: boolean;
}

/**
 * Resolve an NVR's channels end-to-end: try each candidate credential; if none
 * yield channels, try to enable RTSP/ONVIF with each candidate and re-enumerate.
 * Returns the WORKING credential (so the cloud stores the right one) or the
 * first candidate when nothing worked (channels: []).
 */
export async function resolveNvrChannels(opts: {
  host: string;
  port?: number;
  rtspPort?: number;
  vendor: NvrVendor;
  provided?: { username?: string; password?: string };
  ffprobePath?: string;
  timeoutMs?: number;
}): Promise<NvrResolveResult> {
  const creds = candidateCreds(opts.vendor, opts.provided);
  const enumerate = (c: { username: string; password: string }) =>
    enumerateNvrChannels({
      host: opts.host,
      port: opts.port,
      rtspPort: opts.rtspPort,
      username: c.username,
      password: c.password,
      vendor: opts.vendor,
      ffprobePath: opts.ffprobePath,
      timeoutMs: opts.timeoutMs,
    });

  for (const c of creds) {
    const channels = await enumerate(c);
    if (channels.length > 0) return { channels, username: c.username, password: c.password, autoEnabled: false };
  }
  // Nothing streamed — the NVR likely has RTSP/ONVIF disabled. Try to enable.
  for (const c of creds) {
    const ok = await enableNvrServices(opts.vendor, opts.host, c.username, c.password);
    if (!ok) continue;
    const channels = await enumerate(c);
    if (channels.length > 0) return { channels, username: c.username, password: c.password, autoEnabled: true };
  }
  const first = creds[0] ?? { username: '', password: '' };
  return { channels: [], username: first.username, password: first.password, autoEnabled: false };
}
