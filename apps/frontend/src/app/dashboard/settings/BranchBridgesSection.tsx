'use client';

/**
 * Branch Bridges — manage the on-prem agents that bridge each branch LAN to the
 * cloud (see docs/tech/07-branch-bridge-protocol.md). Lists bridges with an
 * online/offline dot; supports add (reveals a one-time pairing token + install
 * command), rotate token, and delete.
 *   GET    /api/bridges
 *   POST   /api/bridges { outletId, name }
 *   POST   /api/bridges/:id/rotate-token
 *   DELETE /api/bridges/:id
 */
import { useState, useEffect, useCallback } from 'react';
import { Copy, Download, RotateCw, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Modal, ErrorBanner, Panel, TableWrap, EmptyRow, thCls, tdCls } from '@/components/dashboard/ui';
import { type BranchBridge, type BridgePairing, isBridgeOnline } from '@/lib/cctv';
import { BridgeInstallWizard } from './BridgeInstallWizard';
import { BridgeSetupChooser } from './BridgeSetupChooser';
import type { OutletOption } from './DeviceDiscoverySection';

interface Props {
  outlets?: OutletOption[];
}

export function BranchBridgesSection({ outlets = [] }: Props) {
  const [bridges, setBridges] = useState<BranchBridge[] | null>(null);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [outletId, setOutletId] = useState('');
  const [name, setName] = useState('');
  // Demo convenience: also register the branch PC's built-in webcam as a camera
  // (rtsp_url `webcam:` → the agent captures its own webcam). No IP camera needed.
  const [withWebcam, setWithWebcam] = useState(false);
  const [busy, setBusy] = useState(false);
  // Pairing envelope whose one-time token we're revealing (from add or rotate).
  const [reveal, setReveal] = useState<BridgePairing | null>(null);
  const [copied, setCopied] = useState(false);
  // Bridge whose install wizard is open (+ its install command / alt commands, when known).
  type SetupCtx = { bridge: BranchBridge; installCommand?: string; altInstall?: { linux: string; docker: string }; pairingToken?: string };
  // A/B chooser shown right after a bridge is created (non-blocking).
  const [chooser, setChooser] = useState<SetupCtx | null>(null);
  const [installing, setInstalling] = useState<(SetupCtx & { fromChooser?: boolean }) | null>(null);

  const load = useCallback(async () => {
    try {
      setBridges(await api.get<BranchBridge[]>('/bridges'));
      setError('');
    } catch (err) {
      setBridges([]);
      setError(err instanceof Error ? err.message : 'Failed to load bridges');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const outletName = (id: string) => outlets.find((o) => o.id === id)?.name ?? id;

  const add = useCallback(async () => {
    if (!outletId) { setError('Choose a branch for this bridge.'); return; }
    setBusy(true); setError('');
    try {
      const created = await api.post<BridgePairing>('/bridges', {
        outletId,
        name: name.trim() || `${outletName(outletId)} Bridge`,
      });
      // Optionally register the branch PC's built-in webcam as a demo camera.
      if (withWebcam) {
        try {
          await api.post('/cctv/cameras', {
            outletId,
            name: 'Local Webcam',
            rtspUrl: 'webcam:',
            bridgeId: created.bridge.id,
            location: 'Branch PC webcam',
          });
        } catch { /* non-fatal: bridge is created; camera can be added later */ }
      }
      setShowAdd(false);
      setName('');
      setWithWebcam(false);
      // Offer the A/B setup chooser (demo-on-this-computer vs install-on-device).
      // Non-blocking: the user can cancel, and the install wizard can come back here.
      setChooser({
        bridge: created.bridge,
        installCommand: created.installCommand,
        altInstall: created.altInstall,
        pairingToken: created.pairingToken,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create bridge');
    } finally {
      setBusy(false);
    }
  }, [outletId, name, load]);

  const rotate = useCallback(async (b: BranchBridge) => {
    setError('');
    try {
      const res = await api.post<BridgePairing>(`/bridges/${b.id}/rotate-token`, {});
      setReveal(res);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rotate token');
    }
  }, [load]);

  const remove = useCallback(async (b: BranchBridge) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete bridge "${b.name ?? 'this bridge'}"? Its cameras and devices will stop streaming.`)) return;
    setError('');
    try {
      await api.delete(`/bridges/${b.id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete bridge');
    }
  }, [load]);

  const revealCmd = reveal?.installCommand ?? '';

  const copyCmd = useCallback(async () => {
    if (!revealCmd) return;
    try { await navigator.clipboard.writeText(revealCmd); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* blocked */ }
  }, [revealCmd]);

  return (
    <Panel
      title="Branch Bridges"
      description="On-prem agents that connect each branch's cameras and IoT devices to the cloud."
      actions={<button className="btn-primary text-sm" onClick={() => { setShowAdd(true); setOutletId(outlets[0]?.id ?? ''); }} data-testid="bridge-add-button">+ Add bridge</button>}
      bodyClassName="p-0"
    >
      {error && <div className="p-4"><ErrorBanner message={error} onDismiss={() => setError('')} /></div>}

      <TableWrap>
        <thead className="border-b border-border bg-surface-sunken/40">
          <tr>
            <th className={`${thCls} text-left`}>Branch</th>
            <th className={`${thCls} text-left`}>Bridge</th>
            <th className={`${thCls} text-left`}>Status</th>
            <th className={`${thCls} text-left`}>Created</th>
            <th className={`${thCls} text-right`}>Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {bridges === null ? (
            <EmptyRow colSpan={5}>Loading…</EmptyRow>
          ) : bridges.length === 0 ? (
            <EmptyRow colSpan={5}>No bridges yet. Add one to connect a branch.</EmptyRow>
          ) : bridges.map((b) => {
            const online = isBridgeOnline(b);
            return (
              <tr key={b.id} data-testid={`bridge-row-${b.id}`}>
                <td className={tdCls}>{outletName(b.outletId)}</td>
                <td className={tdCls}>{b.name ?? '—'}</td>
                <td className={tdCls}>
                  <span className="inline-flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${online ? 'bg-green-500' : 'bg-gray-400'}`} />
                    <span className="text-text-secondary">{online ? 'Online' : 'Offline'}</span>
                  </span>
                </td>
                <td className={tdCls}>{new Date(b.createdAt).toLocaleDateString()}</td>
                <td className={`${tdCls} text-right`}>
                  <div className="inline-flex items-center gap-2">
                    {!online && (
                      <button
                        className="btn-secondary text-xs inline-flex items-center gap-1"
                        onClick={() => setInstalling({ bridge: b })}
                        title="Install branch agent"
                        data-testid={`bridge-install-${b.id}`}
                      >
                        <Download className="h-3.5 w-3.5" /> Install agent
                      </button>
                    )}
                    <button className="btn-ghost text-xs" onClick={() => rotate(b)} title="Rotate token" data-testid={`bridge-rotate-${b.id}`}>
                      <RotateCw className="h-3.5 w-3.5" />
                    </button>
                    <button className="btn-ghost text-xs text-rose-600" onClick={() => remove(b)} title="Delete" data-testid={`bridge-delete-${b.id}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>

      {showAdd && (
        <Modal title="Add branch bridge" onClose={() => setShowAdd(false)} footer={
          <>
            <button className="btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
            <button className="btn-primary" onClick={add} disabled={busy || !outletId}>{busy ? 'Adding…' : 'Add bridge'}</button>
          </>
        }>
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-text-primary">Branch (outlet)</span>
              <select className="input-field" value={outletId} onChange={(e) => setOutletId(e.target.value)} data-testid="bridge-outlet-select">
                {outlets.length === 0 && <option value="">No outlets</option>}
                {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-text-primary">Name (optional)</span>
              <input className="input-field" placeholder="e.g. Front counter PC" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="flex items-start gap-2 rounded bg-surface-sunken p-2.5">
              <input type="checkbox" className="mt-0.5" checked={withWebcam} onChange={(e) => setWithWebcam(e.target.checked)} data-testid="bridge-webcam-toggle" />
              <span className="text-xs text-text-secondary">
                <span className="font-medium text-text-primary">Use this PC&apos;s built-in webcam as a camera</span> — for demos with no IP camera. The branch agent captures its own webcam (needs ffmpeg + <code className="font-mono">-Webcam</code> on install).
              </span>
            </label>
          </div>
        </Modal>
      )}

      {reveal?.pairingToken && (
        <Modal title="Bridge pairing" onClose={() => setReveal(null)} maxWidth="max-w-lg" footer={
          <>
            <button className="btn-ghost" onClick={() => setReveal(null)}>Done</button>
            <button
              className="btn-primary"
              onClick={() => { setInstalling({ bridge: reveal.bridge, installCommand: reveal.installCommand, altInstall: reveal.altInstall }); setReveal(null); }}
              data-testid="bridge-reveal-install"
            >
              Install branch agent
            </button>
          </>
        }>
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">
              Install the Aire Branch Bridge on a <strong>PC at {outletName(reveal.bridge.outletId)}</strong> that stays powered on and is on the same network as the cameras / bay controllers. Once it connects, the bridge shows <strong>Online</strong> (~15s). This token is shown only once.
            </p>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-text-secondary">
              <li>Download the Branch Bridge installer and extract the zip.</li>
              <li>Open <strong>PowerShell as Administrator</strong> in that folder.</li>
              <li>Run:</li>
            </ol>
            <div className="flex items-start gap-2">
              <code className="flex-1 break-all rounded bg-surface-sunken p-2 font-mono text-[11px] text-text-primary" data-testid="bridge-install-command">{revealCmd}</code>
              <button className="btn-secondary text-xs" onClick={copyCmd}><Copy className="mr-1 inline h-3 w-3" />{copied ? 'Copied!' : 'Copy'}</button>
            </div>
            {reveal.altInstall && (
              <details className="text-xs text-text-muted">
                <summary className="cursor-pointer select-none">Other platforms (Linux / Docker)</summary>
                <div className="mt-2 space-y-2">
                  <div>
                    <span className="text-text-secondary">Linux (systemd):</span>
                    <code className="mt-1 block break-all rounded bg-surface-sunken p-2 font-mono text-[11px] text-text-primary">{reveal.altInstall.linux}</code>
                  </div>
                  <div>
                    <span className="text-text-secondary">Docker:</span>
                    <code className="mt-1 block break-all rounded bg-surface-sunken p-2 font-mono text-[11px] text-text-primary">{reveal.altInstall.docker}</code>
                  </div>
                </div>
              </details>
            )}
            <p className="text-[11px] text-text-muted">Pairing token: <code className="font-mono">{reveal.pairingToken}</code></p>
          </div>
        </Modal>
      )}

      {chooser && (
        <BridgeSetupChooser
          outletName={outletName(chooser.bridge.outletId)}
          onClose={() => setChooser(null)}
          onPickInstall={() => { setInstalling({ ...chooser, fromChooser: true }); setChooser(null); }}
        />
      )}

      {installing && (
        <BridgeInstallWizard
          bridgeId={installing.bridge.id}
          outletName={outletName(installing.bridge.outletId)}
          installCommand={installing.installCommand}
          altInstall={installing.altInstall}
          pairingToken={installing.pairingToken}
          onBack={installing.fromChooser ? () => {
            const { bridge, installCommand, altInstall, pairingToken } = installing;
            setChooser({ bridge, installCommand, altInstall, pairingToken });
            setInstalling(null);
          } : undefined}
          onClose={() => setInstalling(null)}
          onConnected={() => { load(); }}
        />
      )}
    </Panel>
  );
}

export default BranchBridgesSection;
