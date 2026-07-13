'use client';

/**
 * BridgeInstallWizard — a steps modal that makes installing the on-prem Aire
 * Branch Bridge agent on a branch PC as close to one-click as possible.
 * See docs/tech/08-device-registry-topology.md → "Branch install flow (Phase 1)".
 *
 *   Step 1 "Download"  → GET /api/bridges/:id/installer  (streams a zip)
 *                        503 { needsPackage, installCommand } → copy-paste fallback
 *   Step 2 "Run"       → extract, run install.ps1 as Administrator, approve prompt
 *   Step 3 "Waiting"   → auto-detect by polling GET /api/bridges every 3s until
 *                        this bridge reports live/online, then "Connected ✓"
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, Loader2, ShieldAlert } from 'lucide-react';
import { api, API_BASE_URL } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { Modal } from '@/components/dashboard/ui';
import { type BranchBridge, isBridgeOnline } from '@/lib/cctv';

interface Props {
  bridgeId: string;
  outletName: string;
  /** Primary Windows install command (token baked in) — shown in Run + fallback. */
  installCommand?: string;
  /** Alternate install commands for Linux / Docker. */
  altInstall?: { linux: string; docker: string };
  /** One-time pairing token (shown in the Run step when provided). */
  pairingToken?: string;
  /**
   * When provided, the footer shows "Back to options" instead of "Cancel" so the
   * user can return to the A/B setup chooser (non-blocking — never traps a demo).
   */
  onBack?: () => void;
  onClose: () => void;
  onConnected: () => void;
}

type StepId = 'download' | 'run' | 'waiting' | 'connected';
const ORDER: StepId[] = ['download', 'run', 'waiting'];

function CopyableCommand({ command, testId }: { command: string; testId?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked */ }
  }, [command]);
  return (
    <div className="flex items-start gap-2">
      <code className="flex-1 break-all rounded bg-surface-sunken p-2 font-mono text-[11px] text-text-primary" data-testid={testId}>{command}</code>
      <button type="button" className="btn-secondary text-xs whitespace-nowrap" onClick={copy}>
        <Copy className="mr-1 inline h-3 w-3" />{copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}

export function BridgeInstallWizard({ bridgeId, outletName, installCommand, altInstall, pairingToken, onBack, onClose, onConnected }: Props) {
  const { t } = useI18n();
  const [step, setStep] = useState<StepId>('download');

  // Download state.
  const [downloading, setDownloading] = useState(false);
  const [dlError, setDlError] = useState('');
  const [needsPackage, setNeedsPackage] = useState(false);
  // installCommand resolved either from props or a 503 body.
  const [fallbackCmd, setFallbackCmd] = useState('');
  const cmd = installCommand || fallbackCmd;

  // Waiting / auto-detect state.
  const [elapsed, setElapsed] = useState(0);
  const [checking, setChecking] = useState(false);
  const connectedRef = useRef(false);

  const download = useCallback(async () => {
    setDownloading(true);
    setDlError('');
    try {
      const token = getAccessToken();
      const res = await fetch(`${API_BASE_URL}/bridges/${bridgeId}/installer`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.status === 503) {
        // Package isn't hosted yet — fall back to the copy-paste command.
        const body = await res.json().catch(() => null);
        setNeedsPackage(true);
        if (body?.installCommand) setFallbackCmd(body.installCommand);
        setStep('run');
        return;
      }
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `aire-branch-bridge-${bridgeId}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStep('run');
    } catch (err) {
      setDlError(err instanceof Error ? err.message : 'Failed to download installer');
    } finally {
      setDownloading(false);
    }
  }, [bridgeId]);

  // Auto-detect: poll GET /api/bridges until this bridge flips to live/online.
  const checkOnce = useCallback(async () => {
    setChecking(true);
    try {
      const bridges = await api.get<BranchBridge[]>('/bridges');
      const b = bridges.find((x) => x.id === bridgeId);
      if (b && (b.live === true || isBridgeOnline(b)) && !connectedRef.current) {
        connectedRef.current = true;
        setStep('connected');
        onConnected();
      }
    } catch { /* transient — keep polling */ } finally {
      setChecking(false);
    }
  }, [bridgeId, onConnected]);

  useEffect(() => {
    if (step !== 'waiting') return;
    setElapsed(0);
    checkOnce();
    const poll = setInterval(checkOnce, 3000);
    const tick = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [step, checkOnce]);

  const activeIdx = step === 'connected' ? ORDER.length : ORDER.indexOf(step);

  return (
    <Modal
      title={t('dash.bridge.install.title', 'Install branch agent')}
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={
        step === 'connected' ? (
          <button className="btn-primary" onClick={onClose} data-testid="bridge-install-done">{t('common.done', 'Done')}</button>
        ) : (
          <>
            {onBack
              ? <button className="btn-ghost" onClick={onBack} data-testid="bridge-install-back">{t('dash.bridge.install.back', '← Back to options')}</button>
              : <button className="btn-ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</button>}
            {step === 'download' && (
              <button className="btn-primary" onClick={download} disabled={downloading} data-testid="bridge-install-download">
                {downloading ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 inline h-3.5 w-3.5" />}
                {downloading ? t('dash.bridge.install.downloading', 'Preparing…') : t('dash.bridge.install.download', 'Download installer')}
              </button>
            )}
            {step === 'run' && (
              <button className="btn-primary" onClick={() => setStep('waiting')} data-testid="bridge-install-next">
                {t('dash.bridge.install.ran', "I've run it")}
              </button>
            )}
            {step === 'waiting' && (
              <button className="btn-secondary" onClick={checkOnce} disabled={checking} data-testid="bridge-install-check">
                {checking && <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />}
                {t('dash.bridge.install.checkAgain', 'Check again')}
              </button>
            )}
          </>
        )
      }
    >
      <div className="space-y-4">
        {/* Stepper */}
        <ol className="flex items-center gap-2" aria-label="Install steps">
          {ORDER.map((s, i) => {
            const done = i < activeIdx;
            const active = i === activeIdx;
            const labels: Record<StepId, string> = {
              download: t('dash.bridge.install.step1', 'Download'),
              run: t('dash.bridge.install.step2', 'Run'),
              waiting: t('dash.bridge.install.step3', 'Connect'),
              connected: '',
            };
            return (
              <li key={s} className="flex flex-1 items-center gap-2">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold
                  ${done ? 'bg-green-500 text-white' : active ? 'bg-primary-500 text-white' : 'bg-surface-sunken text-text-muted'}`}>
                  {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className={`text-xs font-medium ${active || done ? 'text-text-primary' : 'text-text-muted'}`}>{labels[s]}</span>
                {i < ORDER.length - 1 && <span className={`h-px flex-1 ${done ? 'bg-green-500' : 'bg-border'}`} />}
              </li>
            );
          })}
        </ol>

        <p className="text-sm text-text-secondary">
          {t('dash.bridge.install.intro', 'Install the agent on a PC at')} <strong>{outletName}</strong> {t('dash.bridge.install.intro2', 'that stays powered on and shares the network with the cameras / bay controllers.')}
        </p>


        {/* Step 1 — Download */}
        {step === 'download' && (
          <div className="space-y-3 rounded-lg border border-border bg-surface-sunken/30 p-4">
            <p className="text-sm text-text-primary">{t('dash.bridge.install.dlDesc', 'Download the installer package (a small zip with the agent and your pairing token baked in).')}</p>
            {dlError && <p className="text-xs text-rose-600">{dlError}</p>}
          </div>
        )}

        {/* Step 2 — Run */}
        {step === 'run' && (
          <div className="space-y-3">
            {needsPackage && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                {t('dash.bridge.install.needsPackage', "The installer package isn't hosted yet. Run the command below on the branch PC instead — it downloads and installs the agent.")}
              </div>
            )}
            {!needsPackage && (
              <ol className="list-decimal space-y-1 pl-5 text-sm text-text-secondary">
                <li>{t('dash.bridge.install.run1', 'Extract the downloaded zip on the branch PC.')}</li>
                <li>{t('dash.bridge.install.run2', 'Open PowerShell as Administrator in that folder.')}</li>
                <li>{t('dash.bridge.install.run3', 'Run the install script and approve the Windows prompt:')}</li>
              </ol>
            )}
            {cmd
              ? <CopyableCommand command={cmd} testId="bridge-install-command" />
              : <CopyableCommand command={'.\\install.ps1'} testId="bridge-install-command" />}
            {pairingToken && (
              <p className="text-[11px] text-text-muted">
                {t('dash.bridge.install.token', 'Pairing token (shown once):')} <code className="font-mono">{pairingToken}</code>
              </p>
            )}
            {altInstall && (
              <details className="text-xs text-text-muted">
                <summary className="cursor-pointer select-none">{t('dash.bridge.install.otherPlatforms', 'Other platforms (Linux / Docker)')}</summary>
                <div className="mt-2 space-y-2">
                  <div>
                    <span className="text-text-secondary">Linux (systemd):</span>
                    <code className="mt-1 block break-all rounded bg-surface-sunken p-2 font-mono text-[11px] text-text-primary">{altInstall.linux}</code>
                  </div>
                  <div>
                    <span className="text-text-secondary">Docker:</span>
                    <code className="mt-1 block break-all rounded bg-surface-sunken p-2 font-mono text-[11px] text-text-primary">{altInstall.docker}</code>
                  </div>
                </div>
              </details>
            )}
            <p className="flex items-center gap-1.5 text-[11px] text-text-muted">
              <ShieldAlert className="h-3.5 w-3.5" />
              {t('dash.bridge.install.adminNote', 'Administrator rights are required so the agent can install as a background service.')}
            </p>
          </div>
        )}

        {/* Step 3 — Waiting */}
        {step === 'waiting' && (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface-sunken/30 p-6 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
            <p className="text-sm font-medium text-text-primary">{t('dash.bridge.install.waiting', 'Waiting for the branch agent to connect…')}</p>
            <p className="text-xs text-text-muted">
              {t('dash.bridge.install.waitingHint', 'This usually takes about 15 seconds after the agent starts.')}
              {elapsed > 0 && <> {t('dash.bridge.install.elapsed', 'Elapsed')} {elapsed}s.</>}
            </p>
          </div>
        )}

        {/* Success */}
        {step === 'connected' && (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500 text-white">
              <Check className="h-7 w-7" />
            </span>
            <p className="text-base font-semibold text-green-800" data-testid="bridge-install-connected">{t('dash.bridge.install.connected', 'Connected ✓')}</p>
            <p className="text-xs text-green-700">{t('dash.bridge.install.connectedHint', 'The branch agent is online. You can now scan for devices anytime.')}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default BridgeInstallWizard;
