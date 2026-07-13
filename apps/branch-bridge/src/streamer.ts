import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { HlsPlaylistEvent, HlsSegmentEvent } from './types';

/** Segment target duration in seconds (matches ffmpeg -hls_time). */
export const HLS_SEGMENT_SECONDS = 2;
const PLAYLIST_NAME = 'index.m3u8';

/**
 * Decide whether a given rtsp_url should use the synthetic ffmpeg source.
 * True when the global simulate flag is set OR the url uses the `test:` scheme.
 */
export function isSimulatedSource(rtspUrl: string, simulate: boolean): boolean {
  return simulate || rtspUrl.startsWith('test:');
}

/**
 * Build ffmpeg args for a REAL RTSP->HLS relay (video copied, audio to aac).
 */
export function buildRealFfmpegArgs(rtspUrl: string, outDir: string): string[] {
  return [
    '-rtsp_transport', 'tcp',
    '-i', rtspUrl,
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-f', 'hls',
    '-hls_time', String(HLS_SEGMENT_SECONDS),
    '-hls_list_size', '6',
    '-hls_flags', 'delete_segments+append_list',
    '-hls_segment_filename', path.join(outDir, 'seg_%d.ts'),
    path.join(outDir, PLAYLIST_NAME),
  ];
}

/**
 * Build ffmpeg args for a SYNTHETIC source (lavfi testsrc + sine tone),
 * so streaming works with no camera present.
 */
export function buildSimulatedFfmpegArgs(outDir: string): string[] {
  return [
    '-re',
    '-f', 'lavfi',
    '-i', 'testsrc=size=640x480:rate=15',
    '-f', 'lavfi',
    '-i', 'sine=frequency=440:sample_rate=44100',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-pix_fmt', 'yuv420p',
    '-g', '30',
    '-c:a', 'aac',
    '-f', 'hls',
    '-hls_time', String(HLS_SEGMENT_SECONDS),
    '-hls_list_size', '6',
    '-hls_flags', 'delete_segments+append_list',
    '-hls_segment_filename', path.join(outDir, 'seg_%d.ts'),
    path.join(outDir, PLAYLIST_NAME),
  ];
}

/**
 * True when an rtsp_url points at the bridge host's own webcam (scheme `webcam:`),
 * e.g. `webcam:` (auto device) or `webcam:Integrated Camera`. Lets a demo laptop
 * be a "branch camera" with no IP camera / RTSP server present.
 */
export function isWebcamSource(url: string): boolean {
  return url.startsWith('webcam:');
}

/** The device part of a `webcam:<device>` url ('' when none given). */
export function webcamDevice(url: string): string {
  return isWebcamSource(url) ? url.slice('webcam:'.length).trim() : '';
}

/**
 * Build ffmpeg args to capture the host's LOCAL webcam and relay it to HLS.
 * Picks the OS capture backend (dshow / avfoundation / v4l2). `device` may be
 * empty → sensible per-OS default. Re-encodes to H.264 (webcams aren't H.264).
 */
export function buildWebcamFfmpegArgs(
  device: string,
  outDir: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  let input: string[];
  switch (platform) {
    case 'win32':
      // dshow needs a device NAME; caller should resolve one when empty.
      input = ['-f', 'dshow', '-rtbufsize', '100M', '-video_size', '640x480', '-framerate', '15', '-i', `video=${device}`];
      break;
    case 'darwin':
      input = ['-f', 'avfoundation', '-framerate', '15', '-video_size', '640x480', '-i', device || '0'];
      break;
    default:
      input = ['-f', 'v4l2', '-framerate', '15', '-video_size', '640x480', '-i', device || '/dev/video0'];
  }
  return [
    ...input,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-pix_fmt', 'yuv420p',
    '-g', '30',
    '-an',
    '-f', 'hls',
    '-hls_time', String(HLS_SEGMENT_SECONDS),
    '-hls_list_size', '6',
    '-hls_flags', 'delete_segments+append_list',
    '-hls_segment_filename', path.join(outDir, 'seg_%d.ts'),
    path.join(outDir, PLAYLIST_NAME),
  ];
}

/** Parse the segment sequence number from a filename like `seg_12.ts`. */
export function parseSegmentSeq(name: string): number | null {
  const m = /^seg_(\d+)\.ts$/.exec(name);
  return m ? parseInt(m[1], 10) : null;
}

/** First DirectShow *video* device name from `ffmpeg -list_devices` output. */
export function parseFirstDshowVideo(ffmpegListOutput: string): string | null {
  for (const line of ffmpegListOutput.split(/\r?\n/)) {
    if (!/\(video\)/i.test(line)) continue;
    const m = /"([^"]+)"/.exec(line);
    if (m) return m[1];
  }
  return null;
}

interface ActiveStream {
  cameraId: string;
  dir: string;
  child: ChildProcessWithoutNullStreams;
  watcher: fs.FSWatcher | null;
  poll: NodeJS.Timeout | null;
  sentSegments: Set<string>;
  lastPlaylist: string | null;
}

export interface StreamerCallbacks {
  onPlaylist: (event: HlsPlaylistEvent) => void;
  onSegment: (event: HlsSegmentEvent) => void;
}

/**
 * Manages one ffmpeg RTSP->HLS child per camera and relays playlist/segment
 * updates to the cloud via the provided callbacks.
 */
export class Streamer {
  private streams = new Map<string, ActiveStream>();

  constructor(
    private ffmpegPath: string,
    private baseDir: string,
    private simulate: boolean,
    private callbacks: StreamerCallbacks,
  ) {}

  /**
   * Resolve the webcam device for a `webcam:` source: explicit `webcam:<device>`
   * wins, then $AIRE_WEBCAM_DEVICE, then on Windows auto-detect the first dshow
   * video device (linux/mac fall back to the builder's /dev/video0 / index 0).
   */
  private resolveWebcamDevice(spec: string): string {
    if (spec) return spec;
    if (process.env.AIRE_WEBCAM_DEVICE) return process.env.AIRE_WEBCAM_DEVICE;
    if (process.platform === 'win32') {
      // `-list_devices` prints the list to stderr; spawnSync captures both
      // streams regardless of exit code (execFileSync would drop stderr).
      const r = spawnSync(
        this.ffmpegPath,
        ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'],
        { encoding: 'utf8' },
      );
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
      const dev = parseFirstDshowVideo(out);
      if (dev) return dev;
      console.error('[Streamer] no dshow webcam auto-detected; set AIRE_WEBCAM_DEVICE or use webcam:<device>');
    }
    return '';
  }

  private dirFor(cameraId: string): string {
    // Sanitise cameraId so it is safe as a directory name.
    const safe = cameraId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.baseDir, safe);
  }

  /** Start (or restart) a stream for a camera. */
  async startStream(cameraId: string, rtspUrl: string): Promise<void> {
    if (this.streams.has(cameraId)) {
      await this.stopStream(cameraId);
    }

    const dir = this.dirFor(cameraId);
    await fsp.mkdir(dir, { recursive: true });

    let args: string[];
    if (isSimulatedSource(rtspUrl, this.simulate)) {
      args = buildSimulatedFfmpegArgs(dir);
    } else if (isWebcamSource(rtspUrl)) {
      args = buildWebcamFfmpegArgs(this.resolveWebcamDevice(webcamDevice(rtspUrl)), dir);
    } else {
      args = buildRealFfmpegArgs(rtspUrl, dir);
    }

    const child = spawn(this.ffmpegPath, args, { windowsHide: true });
    child.stderr.on('data', () => {
      /* ffmpeg logs verbosely to stderr; swallow to avoid log spam. */
    });
    child.on('error', (err) => {
      console.error(`[Streamer] ffmpeg error for ${cameraId}:`, err.message);
    });
    child.on('exit', (code) => {
      console.log(`[Streamer] ffmpeg for ${cameraId} exited (code=${code})`);
    });

    const stream: ActiveStream = {
      cameraId,
      dir,
      child,
      watcher: null,
      poll: null,
      sentSegments: new Set(),
      lastPlaylist: null,
    };
    this.streams.set(cameraId, stream);

    // Poll the output dir ~1s for new playlist + segments. Polling (rather than
    // fs.watch alone) is portable across platforms/filesystems.
    stream.poll = setInterval(() => {
      this.pumpOutput(stream).catch(() => undefined);
    }, 1000);

    console.log(`[Streamer] started stream for ${cameraId} -> ${dir}`);
  }

  /** Read new playlist/segments from disk and emit them exactly once. */
  private async pumpOutput(stream: ActiveStream): Promise<void> {
    let entries: string[];
    try {
      entries = await fsp.readdir(stream.dir);
    } catch {
      return;
    }

    // Playlist: emit when its contents change.
    if (entries.includes(PLAYLIST_NAME)) {
      try {
        const m3u8 = await fsp.readFile(
          path.join(stream.dir, PLAYLIST_NAME),
          'utf8',
        );
        if (m3u8 !== stream.lastPlaylist) {
          stream.lastPlaylist = m3u8;
          this.callbacks.onPlaylist({ cameraId: stream.cameraId, m3u8 });
        }
      } catch {
        /* playlist mid-write; try again next tick. */
      }
    }

    // Segments: emit each new seg_*.ts exactly once, in sequence order.
    const segNames = entries
      .filter((n) => parseSegmentSeq(n) !== null)
      .sort((a, b) => (parseSegmentSeq(a) as number) - (parseSegmentSeq(b) as number));

    for (const name of segNames) {
      if (stream.sentSegments.has(name)) continue;
      const seq = parseSegmentSeq(name) as number;
      try {
        // eslint-disable-next-line no-await-in-loop
        const buf = await fsp.readFile(path.join(stream.dir, name));
        stream.sentSegments.add(name);
        this.callbacks.onSegment({
          cameraId: stream.cameraId,
          name,
          dataB64: buf.toString('base64'),
          durationSec: HLS_SEGMENT_SECONDS,
          seq,
        });
      } catch {
        /* segment mid-write; will be picked up next tick. */
      }
    }
  }

  /** Stop a camera's stream: kill ffmpeg, stop watchers, remove its dir. */
  async stopStream(cameraId: string): Promise<void> {
    const stream = this.streams.get(cameraId);
    if (!stream) return;
    this.streams.delete(cameraId);

    if (stream.poll) clearInterval(stream.poll);
    if (stream.watcher) stream.watcher.close();
    if (!stream.child.killed) {
      stream.child.kill('SIGKILL');
    }
    try {
      await fsp.rm(stream.dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup. */
    }
    console.log(`[Streamer] stopped stream for ${cameraId}`);
  }

  /** Currently active camera ids (used for heartbeat). */
  activeCameras(): string[] {
    return [...this.streams.keys()];
  }

  /** Stop all streams (graceful shutdown). */
  async stopAll(): Promise<void> {
    await Promise.all([...this.streams.keys()].map((id) => this.stopStream(id)));
  }
}
