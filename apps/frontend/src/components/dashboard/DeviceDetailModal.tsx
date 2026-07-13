'use client';

/**
 * Shared device detail modal. Opened from both the Topology page and the
 * Devices registry. Fetches the full record from GET /api/devices/:id.
 *
 * When category === 'camera' it embeds the live HLS player and a recordings
 * (history) list, reusing the exact /api/cctv/... calls + <HlsPlayer> patterns
 * from dashboard/cctv/page.tsx — the "see one + history" requirement.
 */

import { useCallback, useEffect, useState } from 'react';
import { Circle } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Modal, Spinner } from '@/components/dashboard/ui';
import { HlsPlayer } from '@/components/HlsPlayer';
import { type CctvRecording } from '@/lib/cctv';
import {
  type RegistryDevice, categoryMeta, statusToken, normalizeStatus,
} from '@/lib/topology';

export interface DeviceDetailModalProps {
  /** Device id to fetch, OR a partial device object (its id is used to fetch full detail). */
  device: string | { id: string; name?: string; category?: string };
  onClose: () => void;
}

function fmtDateTime(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? String(s) : d.toLocaleString();
}

function fmtDuration(sec: number | null | undefined): string {
  if (!sec && sec !== 0) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function DeviceDetailModal({ device, onClose }: DeviceDetailModalProps) {
  const { t } = useI18n();
  const deviceId = typeof device === 'string' ? device : device.id;
  const fallbackName = typeof device === 'string' ? '' : device.name ?? '';

  const [detail, setDetail] = useState<RegistryDevice | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setError('');
    api.get<RegistryDevice>(`/devices/${encodeURIComponent(deviceId)}`)
      .then((d) => { if (alive) setDetail(d); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Failed to load device'); });
    return () => { alive = false; };
  }, [deviceId]);

  const title = detail?.name || fallbackName || t('dash.devices.detail', 'Device');
  const isCamera = detail?.category === 'camera';
  // The stream id is the dedicated cameraId if the backend sends one, else refId.
  const cameraId = detail ? (detail.cameraId || detail.refId) : null;

  return (
    <Modal title={title} onClose={onClose} maxWidth={isCamera ? 'max-w-4xl' : 'max-w-lg'}>
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {!detail && !error && (
        <div className="flex items-center gap-2 py-10 text-sm text-text-muted">
          <Spinner /> {t('common.loading', 'Loading…')}
        </div>
      )}

      {detail && (
        <div className="space-y-5">
          <DeviceHeader device={detail} />
          <DeviceFacts device={detail} />
          {Object.keys(detail.connectionParams ?? {}).length > 0 && (
            <ConnectionParams params={detail.connectionParams} />
          )}
          {isCamera && cameraId && <CameraSection cameraId={cameraId} live={detail.status === 'online'} />}
          {isCamera && !cameraId && (
            <p className="rounded-lg border border-border bg-surface-sunken/40 p-3 text-xs text-text-muted">
              {t('dash.devices.noCameraRef', 'This camera has no stream reference yet.')}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ── Generic detail ─────────────────────────────────────────────────── */

function DeviceHeader({ device }: { device: RegistryDevice }) {
  const meta = categoryMeta(device.category);
  const st = statusToken(normalizeStatus(device.status));
  const Icon = meta.icon;
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-text-secondary">
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-text-primary">{device.name}</p>
        <p className="text-xs capitalize text-text-muted">{device.category.replace(/_/g, ' ')}</p>
      </div>
      <span className={`badge inline-flex items-center gap-1.5 ${st.badge}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} /> {st.label}
      </span>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className={`mt-0.5 truncate text-sm text-text-primary ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

function DeviceFacts({ device }: { device: RegistryDevice }) {
  const { t } = useI18n();
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-border bg-surface-sunken/30 p-4">
      <Fact label={t('dash.devices.ip', 'IP address')} value={device.ipAddress || '—'} mono />
      <Fact label={t('dash.devices.mac', 'MAC')} value={device.macAddress || '—'} mono />
      <Fact label={t('dash.devices.vendor', 'Vendor')} value={device.vendor || '—'} />
      <Fact label={t('dash.devices.model', 'Model')} value={device.model || '—'} />
      <Fact label={t('dash.devices.branch', 'Branch')} value={device.outletName || device.outletId || '—'} />
      <Fact label={t('dash.devices.lastSeen', 'Last seen')} value={fmtDateTime(device.lastSeenAt)} />
    </dl>
  );
}

function ConnectionParams({ params }: { params: Record<string, unknown> }) {
  const { t } = useI18n();
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
        {t('dash.devices.connectionParams', 'Connection parameters')}
      </p>
      <dl className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {Object.entries(params).map(([k, v]) => (
          <div key={k} className="flex items-start justify-between gap-4 px-3 py-2">
            <dt className="text-xs text-text-secondary">{k}</dt>
            <dd className="max-w-[60%] break-all text-right font-mono text-xs text-text-primary">
              {typeof v === 'object' ? JSON.stringify(v) : String(v)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ── Camera: live + history ─────────────────────────────────────────── */

function CameraSection({ cameraId, live }: { cameraId: string; live: boolean }) {
  const { t } = useI18n();
  const [recordings, setRecordings] = useState<CctvRecording[] | null>(null);
  const [playing, setPlaying] = useState<CctvRecording | null>(null);

  const load = useCallback(() => {
    api.get<CctvRecording[]>(`/cctv/recordings?cameraId=${encodeURIComponent(cameraId)}`)
      .then(setRecordings)
      .catch(() => setRecordings([]));
  }, [cameraId]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="aspect-video overflow-hidden rounded-lg">
        {playing ? (
          <HlsPlayer
            key={playing.id}
            src={`/cctv/recordings/${playing.id}/index.m3u8`}
            streamable={false}
            muted={false}
            controls
            autoPlay
            className="h-full w-full"
          />
        ) : live ? (
          <HlsPlayer src={`/cctv/cameras/${cameraId}/live.m3u8`} muted autoPlay controls className="h-full w-full" />
        ) : (
          <div className="flex h-full items-center justify-center bg-black text-xs text-white/70">
            {t('dash.cctv.offline', 'Offline')}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
          {t('dash.devices.recordings', 'Recordings')}
        </p>
        {playing && (
          <button className="btn-ghost text-xs" onClick={() => setPlaying(null)}>
            {t('dash.devices.backToLive', 'Back to live')}
          </button>
        )}
      </div>

      <div className="max-h-52 space-y-1.5 overflow-y-auto">
        {recordings === null ? (
          <p className="py-4 text-center text-xs text-text-muted">{t('common.loading', 'Loading…')}</p>
        ) : recordings.length === 0 ? (
          <p className="py-4 text-center text-xs text-text-muted">{t('dash.devices.noRecordings', 'No recordings for this camera.')}</p>
        ) : recordings.map((r) => {
          const playable = r.status === 'completed';
          const isPlaying = playing?.id === r.id;
          return (
            <button
              key={r.id}
              type="button"
              disabled={!playable}
              onClick={() => playable && setPlaying(r)}
              className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                isPlaying
                  ? 'border-primary-300 bg-primary-50'
                  : playable
                    ? 'border-border hover:bg-surface-sunken/50'
                    : 'border-border opacity-60'
              }`}
            >
              <span className="inline-flex items-center gap-2 text-text-primary">
                <Circle className={`h-2.5 w-2.5 ${r.status === 'recording' ? 'animate-pulse fill-rose-600 text-rose-600' : 'text-text-muted'}`} />
                {new Date(r.startedAt).toLocaleString()}
              </span>
              <span className="flex items-center gap-3 text-text-muted">
                <span>{fmtDuration(r.durationSeconds)}</span>
                <span className="capitalize">{r.status}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default DeviceDetailModal;
