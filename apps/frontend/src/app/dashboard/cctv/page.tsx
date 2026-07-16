'use client';

/**
 * CCTV console — Live camera grid + recording History.
 * Live streams are HLS pulled from the cloud relay (fed by the branch bridge):
 *   GET  /api/cctv/cameras?outletId=
 *   GET  /api/cctv/cameras/:id/live.m3u8        (played via <HlsPlayer>)
 *   POST /api/cctv/cameras/:id/record            (start recording)
 *   DELETE /api/cctv/recordings/:id              (stop recording)
 *   GET  /api/cctv/recordings?outletId=&cameraId=
 *   GET  /api/cctv/recordings/:id/index.m3u8     (VOD playback)
 */
import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Circle, Play, Video } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Modal, ErrorBanner, TableWrap, EmptyRow, thCls, tdCls, Tabs } from '@/components/dashboard/ui';
import { HlsPlayer } from '@/components/HlsPlayer';
import { type CctvCamera, type CctvRecording } from '@/lib/cctv';
import type { OutletOption } from '../settings/DeviceDiscoverySection';

type TabId = 'live' | 'history';

export default function CctvPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabId>('live');
  const [outlets, setOutlets] = useState<OutletOption[]>([]);
  const [outletId, setOutletId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<OutletOption[]>('/outlets')
      .then((o) => { setOutlets(o); if (o[0]) setOutletId(o[0].id); })
      .catch(() => setOutlets([]));
  }, []);

  return (
    <div className="max-w-6xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary flex items-center gap-2">
            <Video className="h-6 w-6" strokeWidth={1.75} />{t('dash.cctv.title', 'CCTV')}
          </h1>
          <p className="text-sm text-text-secondary">{t('dash.cctv.subtitle', 'Live branch cameras and recording history.')}</p>
        </div>
        <select className="input-field w-auto" value={outletId} onChange={(e) => setOutletId(e.target.value)} data-testid="cctv-outlet-select">
          {outlets.length === 0 && <option value="">{t('dash.cctv.noOutlets', 'No branches')}</option>}
          {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>

      {error && <div className="mb-4"><ErrorBanner message={error} onDismiss={() => setError('')} /></div>}

      <div className="mb-6">
        <Tabs<TabId>
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'live', label: t('dash.cctv.live', 'Live') },
            { id: 'history', label: t('dash.cctv.history', 'History') },
          ]}
        />
      </div>

      {tab === 'live'
        ? <LiveTab outletId={outletId} onError={setError} />
        : <HistoryTab outletId={outletId} onError={setError} />}
    </div>
  );
}

/* ── Live ───────────────────────────────────────────────────────────────── */

function LiveTab({ outletId, onError }: { outletId: string; onError: (m: string) => void }) {
  const { t } = useI18n();
  const [cameras, setCameras] = useState<CctvCamera[] | null>(null);
  // cameraId -> id of its in-progress recording (backend has no field on the camera).
  const [activeRec, setActiveRec] = useState<Record<string, string>>({});
  // "see one": id of the camera opened in the focused single-camera view.
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!outletId) { setCameras([]); setActiveRec({}); return; }
    try {
      const [cams, recs] = await Promise.all([
        api.get<CctvCamera[]>(`/cctv/cameras?outletId=${encodeURIComponent(outletId)}`),
        api.get<CctvRecording[]>(`/cctv/recordings?outletId=${encodeURIComponent(outletId)}`),
      ]);
      const map: Record<string, string> = {};
      for (const r of recs) if (r.status === 'recording') map[r.cameraId] = r.id;
      setCameras(cams);
      setActiveRec(map);
    } catch (err) {
      setCameras([]);
      onError(err instanceof Error ? err.message : 'Failed to load cameras');
    }
  }, [outletId, onError]);

  useEffect(() => { load(); }, [load]);

  const toggleRecord = useCallback(async (cam: CctvCamera) => {
    try {
      const recId = activeRec[cam.id];
      if (recId) {
        await api.delete(`/cctv/recordings/${recId}`);
      } else {
        await api.post(`/cctv/cameras/${cam.id}/record`, {});
      }
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to toggle recording');
    }
  }, [activeRec, load, onError]);

  if (cameras === null) return <div className="card text-sm text-text-muted">{t('dash.cctv.loading', 'Loading…')}</div>;
  if (cameras.length === 0) return <div className="card text-sm text-text-muted">{t('dash.cctv.noCameras', 'No cameras for this branch yet. Add them from Settings → Devices.')}</div>;

  // "see one": focused single-camera view (re-derive from the fresh list so status stays live).
  const focused = focusedId ? cameras.find((c) => c.id === focusedId) : undefined;
  if (focused) {
    return (
      <SingleCameraView
        camera={focused}
        outletId={outletId}
        recId={activeRec[focused.id]}
        onToggleRecord={() => toggleRecord(focused)}
        onBack={() => setFocusedId(null)}
        onError={onError}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="cctv-live-grid">
      {cameras.map((cam) => {
        const online = cam.isStreaming;
        const recId = activeRec[cam.id];
        return (
          <div
            key={cam.id}
            className="card p-0 overflow-hidden cursor-pointer transition hover:ring-2 hover:ring-primary-500/40"
            data-testid={`cctv-camera-${cam.id}`}
            onClick={() => setFocusedId(cam.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') setFocusedId(cam.id); }}
          >
            <div className="aspect-video">
              {online
                ? <HlsPlayer src={`/cctv/cameras/${cam.id}/live.m3u8`} className="h-full w-full" muted autoPlay controls={false} />
                : <div className="flex h-full items-center justify-center bg-black text-xs text-white/70">{t('dash.cctv.offline', 'Offline')}</div>}
            </div>
            <div className="flex items-center justify-between gap-2 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-text-primary">{cam.name}</p>
                <p className="truncate text-xs text-text-muted">{cam.location || '—'}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`badge ${online ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                  {online ? t('dash.cctv.live', 'Live') : t('dash.cctv.offline', 'Offline')}
                </span>
                <button
                  className={`btn-ghost text-xs inline-flex items-center gap-1 ${recId ? 'text-rose-600' : ''}`}
                  onClick={(e) => { e.stopPropagation(); toggleRecord(cam); }}
                  disabled={!online && !recId}
                  data-testid={`cctv-record-${cam.id}`}
                >
                  <Circle className={`h-3 w-3 ${recId ? 'fill-rose-600 text-rose-600' : ''}`} />
                  {recId ? t('dash.cctv.stopRec', 'Stop') : t('dash.cctv.record', 'Record')}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Single camera ("see one") ────────────────────────────────────────────── */

function SingleCameraView({
  camera, outletId, recId, onToggleRecord, onBack, onError,
}: {
  camera: CctvCamera;
  outletId: string;
  recId?: string;
  onToggleRecord: () => void;
  onBack: () => void;
  onError: (m: string) => void;
}) {
  const { t } = useI18n();
  const online = camera.isStreaming;
  const [recordings, setRecordings] = useState<CctvRecording[] | null>(null);
  const [playing, setPlaying] = useState<CctvRecording | null>(null);

  const loadRecs = useCallback(async () => {
    try {
      const recs = await api.get<CctvRecording[]>(
        `/cctv/recordings?outletId=${encodeURIComponent(outletId)}&cameraId=${encodeURIComponent(camera.id)}`,
      );
      setRecordings(recs);
    } catch (err) {
      setRecordings([]);
      onError(err instanceof Error ? err.message : 'Failed to load recordings');
    }
  }, [outletId, camera.id, onError]);

  // Reload the camera's recordings on open and whenever its recording state flips
  // (so a just-stopped clip appears in the list).
  useEffect(() => { loadRecs(); }, [loadRecs, recId]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button className="btn-ghost text-sm inline-flex items-center gap-1.5" onClick={onBack} data-testid="cctv-single-back">
          <ArrowLeft className="h-4 w-4" />{t('dash.cctv.backToGrid', 'All cameras')}
        </button>
        <div className="flex items-center gap-2">
          <span className={`badge ${online ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
            {online ? t('dash.cctv.live', 'Live') : t('dash.cctv.offline', 'Offline')}
          </span>
          <button
            className={`btn-secondary text-sm inline-flex items-center gap-1.5 ${recId ? 'text-rose-600' : ''}`}
            onClick={onToggleRecord}
            disabled={!online && !recId}
            data-testid={`cctv-single-record-${camera.id}`}
          >
            <Circle className={`h-3.5 w-3.5 ${recId ? 'fill-rose-600 text-rose-600' : ''}`} />
            {recId ? t('dash.cctv.stopRec', 'Stop') : t('dash.cctv.record', 'Record')}
          </button>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-text-primary">{camera.name}</h2>
        <p className="text-sm text-text-muted">{camera.location || '—'}</p>
      </div>

      <div className="aspect-video overflow-hidden rounded-lg bg-black" data-testid="cctv-single-player">
        {online
          ? <HlsPlayer src={`/cctv/cameras/${camera.id}/live.m3u8`} className="h-full w-full" muted autoPlay controls />
          : <div className="flex h-full items-center justify-center text-sm text-white/70">{t('dash.cctv.offline', 'Offline')}</div>}
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="border-b border-border px-5 py-3">
          <h3 className="text-sm font-semibold text-text-primary">{t('dash.cctv.cameraRecordings', 'Recordings')}</h3>
        </div>
        <TableWrap>
          <thead className="border-b border-border bg-surface-sunken/40">
            <tr>
              <th className={`${thCls} text-left`}>{t('dash.cctv.started', 'Started')}</th>
              <th className={`${thCls} text-left`}>{t('dash.cctv.duration', 'Duration')}</th>
              <th className={`${thCls} text-left`}>{t('dash.cctv.status', 'Status')}</th>
              <th className={`${thCls} text-right`}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {recordings === null ? (
              <EmptyRow colSpan={4}>{t('dash.cctv.loading', 'Loading…')}</EmptyRow>
            ) : recordings.length === 0 ? (
              <EmptyRow colSpan={4}>{t('dash.cctv.noCameraRecordings', 'No recordings for this camera yet.')}</EmptyRow>
            ) : recordings.map((r) => (
              <tr
                key={r.id}
                className={`${r.status === 'completed' ? 'cursor-pointer hover:bg-surface-sunken/40' : ''}`}
                onClick={() => r.status === 'completed' && setPlaying(r)}
                data-testid={`cctv-single-recording-${r.id}`}
              >
                <td className={tdCls}>{new Date(r.startedAt).toLocaleString()}</td>
                <td className={tdCls}>{fmtDuration(r.durationSeconds)}</td>
                <td className={`${tdCls} capitalize`}>{r.status}</td>
                <td className={`${tdCls} text-right`}>
                  {r.status === 'completed' && (
                    <span className="inline-flex items-center gap-1 text-xs text-primary-600"><Play className="h-3 w-3" />{t('dash.cctv.play', 'Play')}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </div>

      {playing && (
        <Modal title={camera.name} onClose={() => setPlaying(null)} maxWidth="max-w-3xl">
          <div className="aspect-video">
            <HlsPlayer src={`/cctv/recordings/${playing.id}/index.m3u8`} streamable={false} className="h-full w-full" muted={false} controls autoPlay />
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ── History ────────────────────────────────────────────────────────────── */

function fmtDuration(sec: number | null | undefined): string {
  if (!sec && sec !== 0) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function HistoryTab({ outletId, onError }: { outletId: string; onError: (m: string) => void }) {
  const { t } = useI18n();
  const [recordings, setRecordings] = useState<CctvRecording[] | null>(null);
  // cameraId -> name (RecordingDTO has no cameraName; join to the cameras list).
  const [cameraNames, setCameraNames] = useState<Record<string, string>>({});
  const [cameras, setCameras] = useState<CctvCamera[]>([]);
  const [playing, setPlaying] = useState<CctvRecording | null>(null);

  useEffect(() => {
    if (!outletId) { setRecordings([]); setCameraNames({}); setCameras([]); return; }
    Promise.all([
      api.get<CctvRecording[]>(`/cctv/recordings?outletId=${encodeURIComponent(outletId)}`),
      api.get<CctvCamera[]>(`/cctv/cameras?outletId=${encodeURIComponent(outletId)}`).catch(() => [] as CctvCamera[]),
    ])
      .then(([recs, cams]) => {
        setRecordings(recs);
        setCameras(cams);
        setCameraNames(Object.fromEntries(cams.map((c) => [c.id, c.name])));
      })
      .catch((err) => { setRecordings([]); onError(err instanceof Error ? err.message : 'Failed to load recordings'); });
  }, [outletId, onError]);

  const nvrCams = cameras.filter((c) => c.playbackMeta?.vendor);

  return (
    <div className="space-y-4">
    {nvrCams.length > 0 && <NvrArchivePanel cameras={nvrCams} onError={onError} />}
    <div className="card p-0 overflow-hidden">
      <TableWrap>
        <thead className="border-b border-border bg-surface-sunken/40">
          <tr>
            <th className={`${thCls} text-left`}>{t('dash.cctv.camera', 'Camera')}</th>
            <th className={`${thCls} text-left`}>{t('dash.cctv.order', 'Order')}</th>
            <th className={`${thCls} text-left`}>{t('dash.cctv.started', 'Started')}</th>
            <th className={`${thCls} text-left`}>{t('dash.cctv.duration', 'Duration')}</th>
            <th className={`${thCls} text-left`}>{t('dash.cctv.status', 'Status')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {recordings === null ? (
            <EmptyRow colSpan={5}>{t('dash.cctv.loading', 'Loading…')}</EmptyRow>
          ) : recordings.length === 0 ? (
            <EmptyRow colSpan={5}>{t('dash.cctv.noRecordings', 'No recordings for this branch.')}</EmptyRow>
          ) : recordings.map((r) => (
            <tr
              key={r.id}
              className="cursor-pointer hover:bg-surface-sunken/40"
              onClick={() => r.status === 'completed' && setPlaying(r)}
              data-testid={`cctv-recording-${r.id}`}
            >
              <td className={tdCls}>{cameraNames[r.cameraId] || r.cameraId}</td>
              <td className={tdCls}>{r.orderId ? <span className="text-primary-600">#{r.orderId.slice(0, 8)}</span> : '—'}</td>
              <td className={tdCls}>{new Date(r.startedAt).toLocaleString()}</td>
              <td className={tdCls}>{fmtDuration(r.durationSeconds)}</td>
              <td className={`${tdCls} capitalize`}>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {playing && (
        <Modal title={cameraNames[playing.cameraId] || t('dash.cctv.playback', 'Playback')} onClose={() => setPlaying(null)} maxWidth="max-w-3xl">
          <div className="aspect-video">
            <HlsPlayer src={`/cctv/recordings/${playing.id}/index.m3u8`} streamable={false} className="h-full w-full" muted={false} controls autoPlay />
          </div>
        </Modal>
      )}
    </div>
    </div>
  );
}

/* ── NVR archive scrubber (pull the NVR's own recorded footage on demand) ───── */

function NvrArchivePanel({
  cameras, onError,
}: {
  cameras: CctvCamera[];
  onError: (m: string) => void;
}) {
  const { t } = useI18n();
  const [cameraId, setCameraId] = useState(cameras[0]?.id ?? '');
  const toLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const now = new Date();
  const [start, setStart] = useState(toLocal(new Date(now.getTime() - 3600_000)));
  const [end, setEnd] = useState(toLocal(now));
  const [session, setSession] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const play = async () => {
    if (!cameraId) return;
    setBusy(true);
    try {
      const { sessionId } = await api.post<{ sessionId: string }>(
        `/cctv/cameras/${cameraId}/playback`,
        { start: new Date(start).toISOString(), end: new Date(end).toISOString() },
      );
      const name = cameras.find((c) => c.id === cameraId)?.name ?? 'Playback';
      setSession({ id: sessionId, name });
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to start NVR playback');
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (session) api.delete(`/cctv/playback/${session.id}`).catch(() => undefined);
    setSession(null);
  };

  return (
    <div className="card space-y-3">
      <div>
        <h3 className="section-title">{t('dash.cctv.nvrArchive', 'NVR archive')}</h3>
        <p className="section-description">
          {t('dash.cctv.nvrArchiveHint', "Play footage recorded on the NVR's own disk for a time window.")}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="block text-text-muted mb-1">{t('dash.cctv.camera', 'Camera')}</span>
          <select className="input-field w-56 py-1.5 text-sm" value={cameraId} onChange={(e) => setCameraId(e.target.value)}>
            {cameras.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-text-muted mb-1">{t('dash.cctv.from', 'From')}</span>
          <input type="datetime-local" className="input-field py-1.5 text-sm" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="block text-text-muted mb-1">{t('dash.cctv.to', 'To')}</span>
          <input type="datetime-local" className="input-field py-1.5 text-sm" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <button className="btn-primary text-sm" onClick={play} disabled={busy || !cameraId}>
          {busy ? t('dash.cctv.starting', 'Starting…') : t('dash.cctv.playArchive', 'Play archive')}
        </button>
      </div>

      {session && (
        <Modal title={`${session.name} — ${t('dash.cctv.archive', 'archive')}`} onClose={close} maxWidth="max-w-3xl">
          <div className="aspect-video">
            <HlsPlayer src={`/cctv/playback/${session.id}/index.m3u8`} className="h-full w-full" muted={false} controls autoPlay />
          </div>
        </Modal>
      )}
    </div>
  );
}
