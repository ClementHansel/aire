'use client';

/**
 * BridgeSetupChooser — after a bridge is created, let the user pick HOW to bring
 * it online. Two paths, and this is non-blocking: Cancel always exits, and the
 * install wizard's "← Back to options" returns here.
 *
 *   A — Demo on this computer : run `pnpm demo:cctv` on the machine running AIRE
 *       (this laptop's webcam becomes the camera). Fastest for a solo demo.
 *   B — Install on a branch device : open the install wizard (real branches, or a
 *       2-laptop demo where the other laptop is the branch).
 */
import { useCallback, useState } from 'react';
import { Copy, Laptop, Server } from 'lucide-react';
import { Modal } from '@/components/dashboard/ui';

interface Props {
  outletName: string;
  /** Chosen "Install on a branch device" (opens the install wizard). */
  onPickInstall: () => void;
  /** Cancel / close — non-blocking. */
  onClose: () => void;
}

const DEMO_CMD = 'pnpm demo:cctv';

export function BridgeSetupChooser({ outletName, onPickInstall, onClose }: Props) {
  const [view, setView] = useState<'choose' | 'demo'>('choose');
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try { await navigator.clipboard.writeText(DEMO_CMD); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* blocked */ }
  }, []);

  if (view === 'demo') {
    return (
      <Modal
        title="Demo on this computer"
        onClose={onClose}
        maxWidth="max-w-lg"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setView('choose')} data-testid="chooser-demo-back">← Back to options</button>
            <button className="btn-primary" onClick={onClose}>Done</button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">
            Run everything on the computer you&apos;re presenting from — this laptop&apos;s
            webcam becomes a live camera. No separate device needed.
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-text-secondary">
            <li>On the machine running AIRE, open a terminal in the project folder.</li>
            <li>Run:</li>
          </ol>
          <div className="flex items-start gap-2">
            <code className="flex-1 break-all rounded bg-surface-sunken p-2 font-mono text-[12px] text-text-primary" data-testid="chooser-demo-cmd">{DEMO_CMD}</code>
            <button type="button" className="btn-secondary text-xs whitespace-nowrap" onClick={copy}><Copy className="mr-1 inline h-3 w-3" />{copied ? 'Copied!' : 'Copy'}</button>
          </div>
          <p className="text-[11px] text-text-muted">
            It starts a local RTSP source from the webcam, connects a bridge, and registers a
            camera automatically. Open the outlet&apos;s CCTV page to watch. Stop with <code className="font-mono">pnpm demo:cctv:down</code>.
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Set up this branch camera"
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={<button className="btn-ghost" onClick={onClose} data-testid="chooser-cancel">Cancel</button>}
    >
      <div className="space-y-3">
        <p className="text-sm text-text-secondary">
          Choose how to bring <strong>{outletName}</strong> online. You can change your mind — nothing is locked in.
        </p>
        <button
          type="button"
          onClick={() => setView('demo')}
          data-testid="chooser-option-a"
          className="flex w-full items-start gap-3 rounded-lg border border-border p-4 text-left hover:border-primary-400 hover:bg-surface-sunken/40"
        >
          <Laptop className="mt-0.5 h-5 w-5 shrink-0 text-primary-500" />
          <span>
            <span className="block text-sm font-semibold text-text-primary">A · Demo on this computer</span>
            <span className="block text-xs text-text-secondary">Fastest for a solo demo. Uses this laptop&apos;s webcam as the camera — no separate device.</span>
          </span>
        </button>
        <button
          type="button"
          onClick={onPickInstall}
          data-testid="chooser-option-b"
          className="flex w-full items-start gap-3 rounded-lg border border-border p-4 text-left hover:border-primary-400 hover:bg-surface-sunken/40"
        >
          <Server className="mt-0.5 h-5 w-5 shrink-0 text-primary-500" />
          <span>
            <span className="block text-sm font-semibold text-text-primary">B · Install on a branch device</span>
            <span className="block text-xs text-text-secondary">For real branches (or a 2-laptop demo). Installs the agent on the branch PC; it relays that PC&apos;s cameras or its built-in webcam.</span>
          </span>
        </button>
      </div>
    </Modal>
  );
}

export default BridgeSetupChooser;
