'use client';

import { useState, useCallback } from 'react';
import { useParams } from 'next/navigation';

interface QueueStatus {
  orderNumber: string;
  position: number;
  estimatedWaitMinutes: number;
  status: 'queued' | 'in_progress' | 'completed' | 'cancelled';
  assignedBay?: string;
}

const STATUS_LABEL: Record<string, string> = {
  queued: 'In Queue',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

export default function KioskPage() {
  const params = useParams();
  const tenantId = params.tenantId as string;
  const [orderNumber, setOrderNumber] = useState('');
  const [result, setResult] = useState<QueueStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const check = useCallback(async () => {
    if (!orderNumber.trim()) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;
      const res = await fetch(`${base}/kiosk/queue-status?orderNumber=${encodeURIComponent(orderNumber.trim())}`);
      if (!res.ok) {
        setError(res.status === 404 ? 'Order not found. Please check your order number.' : 'Unable to check status. Please try again.');
        return;
      }
      setResult(await res.json());
    } catch {
      setError('Connection error. Please try again.');
    } finally { setLoading(false); }
  }, [orderNumber]);

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-500 rounded-2xl mb-4"><span className="text-3xl font-bold text-white">A</span></div>
          <h1 className="text-3xl font-bold text-text-primary">Check Your Queue</h1>
          <p className="mt-2 text-text-secondary">Enter your order number to see your position and wait time</p>
        </div>

        <div className="card">
          <label className="block text-sm font-medium text-text-primary mb-1.5">Order Number</label>
          <div className="flex gap-2">
            <input
              className="input-field text-lg"
              placeholder="e.g. ORD-20260630-001"
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && check()}
              autoFocus
            />
            <button className="btn-primary whitespace-nowrap" onClick={check} disabled={!orderNumber.trim() || loading}>
              {loading ? '…' : 'Check'}
            </button>
          </div>

          {error && <div className="mt-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

          {result && (
            <div className="mt-6 pt-6 border-t border-border">
              <p className="text-center text-sm text-text-secondary">Order</p>
              <p className="text-center text-xl font-semibold text-text-primary mb-5">{result.orderNumber}</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-primary-50 p-4 text-center">
                  <p className="text-xs text-primary-700 uppercase font-medium">Position</p>
                  <p className="text-4xl font-bold text-primary-600 mt-1">#{result.position}</p>
                </div>
                <div className="rounded-xl bg-surface-sunken p-4 text-center">
                  <p className="text-xs text-text-secondary uppercase font-medium">Est. Wait</p>
                  <p className="text-4xl font-bold text-text-primary mt-1">{result.estimatedWaitMinutes}<span className="text-lg"> min</span></p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-center gap-3">
                <span className="badge bg-primary-50 text-primary-700">{STATUS_LABEL[result.status] ?? result.status}</span>
                {result.assignedBay && <span className="badge bg-green-50 text-green-700">Bay: {result.assignedBay}</span>}
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-text-muted mt-6">Tenant: {tenantId}</p>
      </div>
    </div>
  );
}
