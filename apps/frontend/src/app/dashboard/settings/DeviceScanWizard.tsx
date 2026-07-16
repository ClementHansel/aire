'use client';

/**
 * Device Scan Wizard — a 5-step modal that walks a Tenant_Owner through
 * discovering + configuring branch devices via the on-prem Branch Bridge.
 * Steps (see docs/tech/07-branch-bridge-protocol.md):
 *   1. Branch & bridge   — pick outlet, show/create bridge (+ pairing token)
 *   2. Scanning          — POST scan, poll for live devices
 *   3. Review            — list discovered devices
 *   4. Configure         — assign outlet/bay + confirm per device
 *   5. Done              — summary + link to live CCTV
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Camera, Cpu, Router, Check, X, Loader2, Copy, RefreshCw, Video, Printer, ScanLine, Smartphone, Monitor, Tablet, HardDrive } from 'lucide-react';
import { api } from '@/lib/api';
import type { DiscoveredDevice } from '@/lib/settings';
import { Modal, ErrorBanner } from '@/components/dashboard/ui';
import {
  type BranchBridge, type BridgePairing, type ScanSession,
  isBridgeOnline,
} from '@/lib/cctv';
import type { OutletOption } from './DeviceDiscoverySection';

type StepId = 1 | 2 | 3 | 4 | 5;

interface Props {
  tenantId: string;
  outlets: OutletOption[];
  initialOutletId?: string;
  onClose: () => void;
  /** Called when the wizard finishes so the parent can refresh its device lists. */
  onComplete?: () => void;
}

const DEVICE_ICON: Record<DiscoveredDevice['device_type'], typeof Camera> = {
  camera: Camera,
  nvr: Video,
  printer: Printer,
  barcode_scanner: ScanLine,
  iot_controller: Cpu,
  router: Router,
  pos_terminal: Smartphone,
  kiosk: Monitor,
  tablet: Tablet,
  unknown: HardDrive,
};

function DeviceTypeIcon({ type }: { type: DiscoveredDevice['device_type'] }) {
  const Icon = DEVICE_ICON[type] ?? Router;
  return <Icon className="h-4 w-4 shrink-0 text-text-secondary" strokeWidth={1.75} />;
}

export function DeviceScanWizard({ tenantId, outlets, initialOutletId, onClose, onComplete }: Props) {
  const [step, setStep] = useState<StepId>(1);
  const [error, setError] = useState('');

  // Step 1 — branch & bridge
  const [outletId, setOutletId] = useState(initialOutletId || outlets[0]?.id || '');
  const [bridges, setBridges] = useState<BranchBridge[] | null>(null);
  const [addingBridge, setAddingBridge] = useState(false);
  // Pairing envelope from create — carries the one-time token + install command.
  const [pairing, setPairing] = useState<BridgePairing | null>(null);
  const [copied, setCopied] = useState(false);

  // Step 2 — scanning
  const [scanStatus, setScanStatus] = useState<ScanSession['status']>('scanning');
  const [scanned, setScanned] = useState<DiscoveredDevice[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Step 4 — configure
  const [assign, setAssign] = useState<Record<string, { outletId: string; bayId: string }>>({});
  // Per-NVR ONVIF credentials (used only to enumerate channels at confirm time).
  const [creds, setCreds] = useState<Record<string, { username: string; password: string }>>({});
  const [results, setResults] = useState<Record<string, 'ok' | 'error' | 'pending'>>({});

  const bridge = bridges?.find((b) => b.outletId === outletId) ?? null;
  const activePairing = pairing && pairing.bridge.outletId === outletId ? pairing : null;
  const activeBridge = activePairing?.bridge ?? bridge;

  const loadBridges = useCallback(async () => {
    try {
      const data = await api.get<BranchBridge[]>('/bridges');
      setBridges(data);
    } catch (err) {
      setBridges([]);
      setError(err instanceof Error ? err.message : 'Failed to load bridges');
    }
  }, []);

  useEffect(() => { loadBridges(); }, [loadBridges]);

  // ── Step 1: create bridge ────────────────────────────────────────────────
  const handleAddBridge = useCallback(async () => {
    const outlet = outlets.find((o) => o.id === outletId);
    setAddingBridge(true);
    setError('');
    try {
      const created = await api.post<BridgePairing>('/bridges', {
        outletId,
        name: `${outlet?.name ?? 'Branch'} Bridge`,
      });
      setPairing(created);
      await loadBridges();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create bridge');
    } finally {
      setAddingBridge(false);
    }
  }, [outletId, outlets, loadBridges]);

  const pairingToken = activePairing?.pairingToken ?? '';
  const installCmd = activePairing?.installCommand ?? '';

  const copyInstall = useCallback(async () => {
    if (!installCmd) return;
    try {
      await navigator.clipboard.writeText(installCmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked */ }
  }, [installCmd]);

  // ── Step 2: scan + poll ──────────────────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const startScan = useCallback(async () => {
    setError('');
    setScanned([]);
    setScanStatus('scanning');
    setStep(2);
    try {
      const { scanId: id } = await api.post<{ scanId: string }>(`/discovery/${tenantId}/scan`, { outletId });
      pollRef.current = setInterval(async () => {
        try {
          // A just-created scanId can return null briefly — treat as still scanning.
          const res = await api.get<ScanSession | null>(`/discovery/${tenantId}/scan/${id}`);
          if (!res) return;
          setScanned(res.devices ?? []);
          setScanStatus(res.status);
          if (res.status === 'done') stopPolling();
        } catch {
          // transient poll error — keep trying until user stops
        }
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start scan');
    }
  }, [tenantId, outletId, stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const goReview = useCallback(() => {
    stopPolling();
    // Seed per-device assignment defaults (scanned outlet).
    setAssign((prev) => {
      const next = { ...prev };
      for (const d of scanned) {
        if (!next[d.device_id]) next[d.device_id] = { outletId, bayId: '' };
      }
      return next;
    });
    setStep(3);
  }, [scanned, outletId, stopPolling]);

  // ── Step 4: configure ─────────────────────────────────────────────────────
  const configureOne = useCallback(async (device: DiscoveredDevice) => {
    const a = assign[device.device_id] ?? { outletId, bayId: '' };
    const c = creds[device.device_id];
    setResults((r) => ({ ...r, [device.device_id]: 'pending' }));
    try {
      await api.post(`/discovery/${tenantId}/devices/${device.device_id}/confirm`, {
        assigned_outlet_id: a.outletId,
        ...(a.bayId ? { assigned_bay_id: a.bayId } : {}),
        // NVR channels / authenticated IP cameras use these credentials.
        ...((device.device_type === 'nvr' || device.device_type === 'camera') && c?.username
          ? { credentials: c }
          : {}),
      });
      setResults((r) => ({ ...r, [device.device_id]: 'ok' }));
    } catch (err) {
      setResults((r) => ({ ...r, [device.device_id]: 'error' }));
      setError(err instanceof Error ? err.message : `Failed to configure ${device.suggested_label}`);
    }
  }, [assign, creds, outletId, tenantId]);

  const configureAll = useCallback(async () => {
    for (const d of scanned) {
      if (results[d.device_id] !== 'ok') await configureOne(d);
    }
  }, [scanned, results, configureOne]);

  const finish = useCallback(() => {
    onComplete?.();
    setStep(5);
  }, [onComplete]);

  const cameraCount = scanned.filter((d) => d.device_type === 'camera' && results[d.device_id] === 'ok').length;
  const controllerCount = scanned.filter((d) => d.device_type === 'iot_controller' && results[d.device_id] === 'ok').length;

  const online = activeBridge ? isBridgeOnline(activeBridge) : false;

  return (
    <Modal title="Search devices" onClose={onClose} maxWidth="max-w-2xl">
      {/* Step indicator */}
      <ol className="mb-5 flex items-center gap-2 text-xs" data-testid="wizard-steps">
        {(['Branch', 'Scan', 'Review', 'Configure', 'Done'] as const).map((label, i) => {
          const n = (i + 1) as StepId;
          return (
            <li key={label} className="flex items-center gap-2">
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                step === n ? 'bg-primary-500 text-white' : step > n ? 'bg-green-100 text-green-700' : 'bg-surface-sunken text-text-muted'
              }`}>{step > n ? '✓' : n}</span>
              <span className={step === n ? 'font-medium text-text-primary' : 'text-text-muted'}>{label}</span>
              {n < 5 && <span className="text-text-muted">·</span>}
            </li>
          );
        })}
      </ol>

      {error && <div className="mb-4"><ErrorBanner message={error} onDismiss={() => setError('')} /></div>}

      {/* ── Step 1 ── */}
      {step === 1 && (
        <div className="space-y-4" data-testid="wizard-step-1">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-text-primary">Branch (outlet)</span>
            <select
              className="input-field"
              value={outletId}
              onChange={(e) => { setOutletId(e.target.value); setPairing(null); }}
              data-testid="wizard-outlet-select"
            >
              {outlets.length === 0 && <option value="">No outlets</option>}
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>

          {bridges === null ? (
            <p className="text-sm text-text-muted">Loading bridge status…</p>
          ) : activeBridge ? (
            <div className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${online ? 'bg-green-500' : 'bg-gray-400'}`} />
                <span className="text-sm font-medium text-text-primary">{activeBridge.name ?? 'Branch Bridge'}</span>
                <span className="text-xs text-text-muted">{online ? 'Online' : 'Offline'}</span>
              </div>
              {pairingToken && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-text-secondary">
                    Run this on a PC at the branch, then it will show <strong>Online</strong>:
                  </p>
                  <div className="flex items-start gap-2">
                    <code className="flex-1 break-all rounded bg-surface-sunken p-2 font-mono text-[11px] text-text-primary">{installCmd}</code>
                    <button className="btn-secondary text-xs" onClick={copyInstall}>
                      <Copy className="mr-1 inline h-3 w-3" />{copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-[11px] text-text-muted">Pairing token: <code className="font-mono">{pairingToken}</code></p>
                </div>
              )}
              {!online && !pairingToken && (
                <p className="mt-2 text-xs text-amber-600">Bridge is offline. You can still start a scan, but it will only run once the branch PC is online.</p>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-3">
              <p className="text-sm text-text-secondary">No bridge for this branch yet.</p>
              <button className="btn-primary mt-2 text-sm" onClick={handleAddBridge} disabled={addingBridge || !outletId} data-testid="wizard-add-bridge">
                {addingBridge ? 'Adding…' : '+ Add bridge'}
              </button>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button
              className="btn-primary"
              onClick={startScan}
              disabled={!activeBridge || !outletId}
              data-testid="wizard-start-scan"
            >
              Start scan
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2 ── */}
      {step === 2 && (
        <div className="space-y-4" data-testid="wizard-step-2">
          <div className="flex items-center gap-3">
            {scanStatus !== 'done' && <Loader2 className="h-5 w-5 animate-spin text-primary-500" />}
            <div>
              <p className="text-sm font-medium text-text-primary">
                {scanStatus === 'done' ? 'Scan complete' : 'Scanning the branch network…'}
              </p>
              <p className="text-xs text-text-muted" data-testid="wizard-scan-count">{scanned.length} device{scanned.length === 1 ? '' : 's'} found</p>
            </div>
          </div>

          <div className="max-h-64 space-y-2 overflow-y-auto">
            {scanned.map((d) => (
              <div key={d.device_id} className="flex items-center gap-2 rounded-lg border border-border p-2 text-sm">
                <DeviceTypeIcon type={d.device_type} />
                <span className="font-medium text-text-primary">{d.suggested_label}</span>
                <span className="ml-auto font-mono text-xs text-text-muted">{d.ip_address}</span>
              </div>
            ))}
            {scanned.length === 0 && scanStatus !== 'done' && (
              <p className="text-sm italic text-text-muted">Waiting for the bridge to report devices…</p>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => { stopPolling(); setStep(1); }}>Back</button>
            <button className="btn-primary" onClick={goReview} data-testid="wizard-scan-next">
              {scanStatus === 'done' ? 'Next' : 'Stop & continue'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3 ── */}
      {step === 3 && (
        <div className="space-y-4" data-testid="wizard-step-3">
          <p className="text-sm text-text-secondary">{scanned.length} device{scanned.length === 1 ? '' : 's'} discovered. Review before configuring.</p>
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {scanned.map((d) => (
              <div key={d.device_id} className="flex items-center gap-2 rounded-lg border border-border p-2.5 text-sm">
                <DeviceTypeIcon type={d.device_type} />
                <div className="min-w-0">
                  <p className="truncate font-medium text-text-primary">{d.suggested_label}</p>
                  <p className="text-xs text-text-muted"><span className="capitalize">{d.device_type.replace(/_/g, ' ')}</span> · <span className="font-mono">{d.ip_address}</span></p>
                </div>
              </div>
            ))}
            {scanned.length === 0 && <p className="text-sm italic text-text-muted">No devices discovered.</p>}
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setStep(2)}>Back</button>
            <button className="btn-primary" onClick={() => setStep(4)} disabled={scanned.length === 0}>Configure</button>
          </div>
        </div>
      )}

      {/* ── Step 4 ── */}
      {step === 4 && (
        <div className="space-y-4" data-testid="wizard-step-4">
          <p className="rounded-lg border border-border bg-surface-sunken/40 px-3 py-2 text-xs text-text-muted">
            Tip: an NVR loads all its cameras once you enter its login. Cloud-only cameras
            (Ring, Nest, Wyze) can&apos;t be added — they have no local stream to relay.
          </p>
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {scanned.map((d) => {
              const a = assign[d.device_id] ?? { outletId, bayId: '' };
              const res = results[d.device_id];
              return (
                <div key={d.device_id} className="rounded-lg border border-border p-2.5" data-testid={`wizard-device-${d.device_id}`}>
                  <div className="flex items-center gap-2">
                    <DeviceTypeIcon type={d.device_type} />
                    <span className="text-sm font-medium text-text-primary">{d.suggested_label}</span>
                    <span className="font-mono text-xs text-text-muted">{d.ip_address}</span>
                    <span className="ml-auto">
                      {res === 'ok' && <Check className="h-4 w-4 text-green-600" data-testid={`wizard-ok-${d.device_id}`} />}
                      {res === 'error' && <X className="h-4 w-4 text-rose-600" data-testid={`wizard-err-${d.device_id}`} />}
                      {res === 'pending' && <Loader2 className="h-4 w-4 animate-spin text-text-muted" />}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                      className="input-field w-auto py-1.5 text-xs"
                      value={a.outletId}
                      onChange={(e) => setAssign((s) => ({ ...s, [d.device_id]: { ...a, outletId: e.target.value } }))}
                    >
                      {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                    <input
                      className="input-field w-32 py-1.5 text-xs"
                      placeholder="Bay id (optional)"
                      value={a.bayId}
                      onChange={(e) => setAssign((s) => ({ ...s, [d.device_id]: { ...a, bayId: e.target.value } }))}
                    />
                    <button className="btn-secondary text-xs" onClick={() => configureOne(d)} disabled={res === 'pending' || res === 'ok'}>
                      {res === 'ok' ? 'Configured' : 'Configure'}
                    </button>
                  </div>
                  {(d.device_type === 'nvr' || d.device_type === 'camera') && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-text-muted">
                        {d.device_type === 'nvr' ? 'NVR login (to load its cameras):' : 'Camera login (if required):'}
                      </span>
                      <input
                        className="input-field w-28 py-1.5 text-xs"
                        placeholder="username"
                        autoComplete="off"
                        value={creds[d.device_id]?.username ?? ''}
                        onChange={(e) => setCreds((s) => ({ ...s, [d.device_id]: { username: e.target.value, password: s[d.device_id]?.password ?? '' } }))}
                      />
                      <input
                        className="input-field w-28 py-1.5 text-xs"
                        type="password"
                        placeholder="password"
                        autoComplete="new-password"
                        value={creds[d.device_id]?.password ?? ''}
                        onChange={(e) => setCreds((s) => ({ ...s, [d.device_id]: { username: s[d.device_id]?.username ?? '', password: e.target.value } }))}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-2">
            <button className="btn-secondary text-sm" onClick={configureAll} data-testid="wizard-configure-all">
              <RefreshCw className="mr-1 inline h-3 w-3" />Configure all
            </button>
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={() => setStep(3)}>Back</button>
              <button className="btn-primary" onClick={finish}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 5 ── */}
      {step === 5 && (
        <div className="space-y-4 text-center" data-testid="wizard-step-5">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
            <Check className="h-6 w-6 text-green-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-text-primary">Setup complete</p>
            <p className="text-sm text-text-secondary">
              {cameraCount} camera{cameraCount === 1 ? '' : 's'} and {controllerCount} controller{controllerCount === 1 ? '' : 's'} configured.
            </p>
          </div>
          <div className="flex justify-center gap-2">
            {cameraCount > 0 && (
              <Link href="/dashboard/cctv" className="btn-primary text-sm" onClick={onClose}>View live cameras</Link>
            )}
            <button className="btn-secondary" onClick={onClose}>Close</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default DeviceScanWizard;
