import {
  Injectable,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as http from 'http';

/**
 * Reads container status and logs from the Docker Engine API over its unix
 * socket. The socket is mounted read-only into the backend container (see
 * docker-compose backend `volumes`). When the socket is absent (e.g. local runs
 * without the mount, or a hardened prod host), every method degrades gracefully:
 * `available()` returns false and the System Health page simply hides the panel.
 *
 * Super-admin only — gated at the controller.
 */
@Injectable()
export class DockerService {
  private readonly socketPath = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
  private readonly apiVersion = 'v1.41';

  private request(path: string): Promise<{ status: number; body: Buffer }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { socketPath: this.socketPath, path: `/${this.apiVersion}${path}`, method: 'GET', timeout: 5000 },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
        },
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('docker socket timeout')));
      req.end();
    });
  }

  /** True if the Docker socket is reachable. */
  async available(): Promise<boolean> {
    try {
      const r = await this.request('/version');
      return r.status === 200;
    } catch {
      return false;
    }
  }

  /** All containers (running and stopped), lightly normalized for the UI. */
  async listContainers(): Promise<ContainerInfo[]> {
    let r: { status: number; body: Buffer };
    try {
      r = await this.request('/containers/json?all=1');
    } catch {
      throw new ServiceUnavailableException('Docker socket unavailable');
    }
    if (r.status !== 200) throw new ServiceUnavailableException(`Docker API returned ${r.status}`);
    const arr = JSON.parse(r.body.toString('utf8')) as DockerContainerJson[];
    return arr
      .map((c): ContainerInfo => ({
        id: c.Id,
        name: c.Names?.[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12),
        image: c.Image,
        state: c.State, // running | exited | created | paused | ...
        status: c.Status, // "Up 2 hours (healthy)"
        health: /\(healthy\)/.test(c.Status)
          ? 'healthy'
          : /\(unhealthy\)/.test(c.Status)
            ? 'unhealthy'
            : /\(health: starting\)/.test(c.Status)
              ? 'starting'
              : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Tail of a container's combined stdout/stderr logs. */
  async containerLogs(idOrName: string, tail = 200): Promise<string> {
    if (!/^[a-zA-Z0-9_.-]+$/.test(idOrName)) throw new BadRequestException('Invalid container id');
    const n = Math.min(Math.max(tail, 1), 1000);
    let r: { status: number; body: Buffer };
    try {
      r = await this.request(`/containers/${idOrName}/logs?stdout=1&stderr=1&tail=${n}`);
    } catch {
      throw new ServiceUnavailableException('Docker socket unavailable');
    }
    if (r.status === 404) throw new BadRequestException('Container not found');
    if (r.status !== 200) throw new ServiceUnavailableException(`Docker API returned ${r.status}`);
    return this.demux(r.body);
  }

  /**
   * Docker multiplexes stdout/stderr into 8-byte-framed chunks when the
   * container has no TTY: [stream(1), 0,0,0, size(uint32 BE)] + payload. Strip
   * the frame headers; fall back to raw text for TTY containers.
   */
  private demux(buf: Buffer): string {
    const looksMux =
      buf.length >= 8 && buf[0]! <= 2 && buf[1] === 0 && buf[2] === 0 && buf[3] === 0;
    if (!looksMux) return buf.toString('utf8');
    const out: Buffer[] = [];
    let o = 0;
    while (o + 8 <= buf.length) {
      const size = buf.readUInt32BE(o + 4);
      const start = o + 8;
      const end = start + size;
      if (end > buf.length) break;
      out.push(buf.subarray(start, end));
      o = end;
    }
    return Buffer.concat(out).toString('utf8');
  }
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  health: 'healthy' | 'unhealthy' | 'starting' | null;
}

interface DockerContainerJson {
  Id: string;
  Names?: string[];
  Image: string;
  State: string;
  Status: string;
}
