'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Camera-based QR/barcode scanner. Loads html5-qrcode lazily (browser-only) and
 * calls onDecode with the first decoded value. Used for membership identify.
 */
export function QrScanButton({ onDecode, label = 'Scan', className = 'btn-secondary' }: {
  onDecode: (text: string) => void;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{label}</button>
      {open && <ScanModal onClose={() => setOpen(false)} onDecode={(t) => { setOpen(false); onDecode(t); }} />}
    </>
  );
}

function ScanModal({ onClose, onDecode }: { onClose: () => void; onDecode: (t: string) => void }) {
  const [err, setErr] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scannerRef = useRef<any>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import('html5-qrcode');
        if (cancelled) return;
        const inst = new mod.Html5Qrcode('qr-scan-region');
        scannerRef.current = inst;
        await inst.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: 240 },
          (text: string) => { if (!doneRef.current) { doneRef.current = true; onDecode(text); } },
          () => { /* per-frame decode failure — ignore */ },
        );
      } catch {
        setErr('Unable to start the camera. Check camera permissions, or type the code instead.');
      }
    })();
    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (s) { s.stop().then(() => s.clear()).catch(() => { /* already stopped */ }); }
    };
  }, [onDecode]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title mb-2">Scan membership code</h3>
        {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-sm text-red-700 mb-2">{err}</div>}
        <div id="qr-scan-region" className="w-full rounded-lg overflow-hidden bg-black/5 min-h-[240px]" />
        <div className="flex justify-end mt-3"><button className="btn-secondary" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
