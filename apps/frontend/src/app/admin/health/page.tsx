'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { isAuthenticated } from '@/lib/auth';

interface Health {
  db: { ok: boolean; latencyMs: number };
  waha: { ok: boolean; status: string };
  counts: { tenants: number; outlets: number; orders: number; agents: number };
  checkedAt: string;
}

function Pill({ ok }: { ok: boolean }) {
  return <span className={`badge ${ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{ok ? '● Healthy' : '● Down'}</span>;
}

export default function AdminHealthPage() {
  const [h, setH] = useState<Health | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setH(await api.get<Health>('/admin/health')); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (!isAuthenticated()) { window.location.href = '/'; return; } load(); }, [load]);

  return (
    <div data-testid="admin-health">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-text-primary">System Health</h1>
        <button className="btn-secondary" onClick={load}>↻ Refresh</button>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      {loading || !h ? <p className="text-text-muted">Loading…</p> : (
        <>
          <div className="grid sm:grid-cols-2 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-border p-5">
              <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Database</h2><Pill ok={h.db.ok} /></div>
              <p className="text-sm text-text-muted mt-2">Query latency: <span className="font-medium text-text-primary">{h.db.latencyMs} ms</span></p>
            </div>
            <div className="bg-white rounded-xl border border-border p-5">
              <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">WhatsApp gateway (WAHA)</h2><Pill ok={h.waha.ok} /></div>
              <p className="text-sm text-text-muted mt-2">Status: <span className="font-medium text-text-primary">{h.waha.status}</span></p>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs text-text-secondary uppercase">Tenants</p><p className="text-2xl font-bold mt-1">{h.counts.tenants}</p></div>
            <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs text-text-secondary uppercase">Outlets</p><p className="text-2xl font-bold mt-1">{h.counts.outlets}</p></div>
            <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs text-text-secondary uppercase">Orders (all-time)</p><p className="text-2xl font-bold mt-1">{h.counts.orders}</p></div>
            <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs text-text-secondary uppercase">Agents</p><p className="text-2xl font-bold mt-1">{h.counts.agents}</p></div>
          </div>

          <p className="text-xs text-text-muted mt-4">Checked at {new Date(h.checkedAt).toLocaleString('id-ID')}.</p>
        </>
      )}
    </div>
  );
}
