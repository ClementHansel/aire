'use client';

/**
 * HLS video player for CCTV live streams + recording playback.
 *
 * - Uses hls.js when `Hls.isSupported()` (attaches to a <video>), and configures
 *   `xhrSetup` to add `Authorization: Bearer <jwt>` to every playlist/segment
 *   request (the backend guards these with the same JWT as the api client).
 * - Falls back to native HLS (`video.src`) on Safari, appending
 *   `?access_token=<jwt>` since XHR headers can't be set for native playback.
 * - hls.js is loaded dynamically to keep it out of the SSR/first-load bundle.
 */
import { useEffect, useRef, useState } from 'react';
import { getAccessToken } from '@/lib/auth';
import { streamUrl } from '@/lib/api';

export interface HlsPlayerProps {
  /** Path to the playlist, e.g. "/cctv/cameras/:id/live.m3u8" (relative to the API base). */
  src: string;
  streamable?: boolean;
  muted?: boolean;
  autoPlay?: boolean;
  controls?: boolean;
  className?: string;
  poster?: string;
}

export function HlsPlayer({
  src,
  streamable = true,
  muted = true,
  autoPlay = true,
  controls = true,
  className,
  poster,
}: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamable || !src) {
      setLoading(false);
      return;
    }

    let destroyed = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let hls: any = null;
    const absolute = streamUrl(src); // header-based auth path (hls.js)

    setLoading(true);
    setError(null);

    (async () => {
      const canNative = video.canPlayType('application/vnd.apple.mpegurl');
      // Prefer hls.js (header auth); fall back to native HLS with ?access_token.
      const mod = await import('hls.js').catch(() => null);
      const Hls = mod?.default;

      if (destroyed) return;

      if (Hls && Hls.isSupported()) {
        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: streamable,
          xhrSetup: (xhr: XMLHttpRequest) => {
            const token = getAccessToken();
            if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          },
        });
        hls.loadSource(absolute);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setLoading(false);
          if (autoPlay) video.play().catch(() => { /* autoplay may be blocked */ });
        });
        hls.on(Hls.Events.ERROR, (_evt: unknown, data: { fatal?: boolean; type?: string }) => {
          if (!data?.fatal) return;
          // Try to recover network/media errors before giving up.
          if (data.type === 'networkError') { hls.startLoad(); return; }
          if (data.type === 'mediaError') { hls.recoverMediaError(); return; }
          setError('Stream unavailable');
          setLoading(false);
        });
      } else if (canNative) {
        video.src = streamUrl(src, true); // ?access_token fallback for Safari
        video.addEventListener('loadedmetadata', () => {
          setLoading(false);
          if (autoPlay) video.play().catch(() => {});
        }, { once: true });
        video.addEventListener('error', () => { setError('Stream unavailable'); setLoading(false); }, { once: true });
      } else {
        setError('HLS is not supported in this browser');
        setLoading(false);
      }
    })();

    return () => {
      destroyed = true;
      if (hls) { try { hls.destroy(); } catch { /* noop */ } }
      video.removeAttribute('src');
      try { video.load(); } catch { /* noop */ }
    };
  }, [src, streamable, autoPlay]);

  return (
    <div className={`relative overflow-hidden rounded-lg bg-black ${className ?? ''}`} data-testid="hls-player">
      <video
        ref={videoRef}
        muted={muted}
        controls={controls}
        playsInline
        poster={poster}
        className="h-full w-full object-contain"
      />
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs text-white">
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" role="status" aria-label="Loading" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 px-3 text-center text-xs text-white">
          {error}
        </div>
      )}
    </div>
  );
}

export default HlsPlayer;
