'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import BranchFilter from '@/components/dashboard/BranchFilter';

interface Summary { period: string; actual: number; target: number; attainmentPct: number | null; orders: number; leadFunnel: Record<string, number>; }
interface Lead { id: string; name: string; phone: string | null; source: string | null; status: string; }

const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
const NEXT: Record<string, string> = { new: 'contacted', contacted: 'won' };

export default function SalesPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [form, setForm] = useState({ name: '', phone: '', source: '' });
  const [target, setTarget] = useState('');
  const [branch, setBranch] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      // Branch scopes actual + target; leads are tenant-wide (not branch-scoped).
      const [s, l] = await Promise.all([
        api.get<Summary>(`/sales/summary${branch ? `?outletId=${branch}` : ''}`),
        api.get<Lead[]>('/sales/leads'),
      ]);
      setSummary(s); setLeads(l); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
  }, [branch]);
  useEffect(() => { load(); }, [load]);

  const createLead = async () => {
    if (!form.name.trim()) return;
    try { await api.post('/sales/leads', { name: form.name.trim(), phone: form.phone || undefined, source: form.source || undefined }); setForm({ name: '', phone: '', source: '' }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  };
  const advance = async (lead: Lead) => {
    const next = NEXT[lead.status]; if (!next) return;
    try { await api.patch(`/sales/leads/${lead.id}/status`, { status: next }); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  };
  const saveTarget = async () => {
    if (!Number(target)) return;
    const period = new Date().toISOString().slice(0, 7);
    try { await api.post('/sales/targets', { period, targetAmount: Number(target) }); setTarget(''); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-semibold text-text-primary">Sales</h1>
        <BranchFilter value={branch} onChange={setBranch} />
      </div>
      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card"><p className="text-xs text-text-muted">Actual ({summary?.period})</p><p className="text-2xl font-semibold text-green-600">{fmt(summary?.actual ?? 0)}</p></div>
        <div className="card"><p className="text-xs text-text-muted">Target</p><p className="text-2xl font-semibold">{fmt(summary?.target ?? 0)}</p></div>
        <div className="card"><p className="text-xs text-text-muted">Attainment</p><p className="text-2xl font-semibold">{summary?.attainmentPct != null ? `${summary.attainmentPct}%` : '—'}</p></div>
        <div className="card"><p className="text-xs text-text-muted">Orders</p><p className="text-2xl font-semibold">{summary?.orders ?? 0}</p></div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="section-title mb-3">Set monthly target</h2>
          <div className="flex gap-2">
            <input className="input-field flex-1" type="number" placeholder="Target amount (this month)" value={target} onChange={(e) => setTarget(e.target.value)} />
            <button className="btn-primary" onClick={saveTarget}>Save</button>
          </div>
        </div>
        <div className="card">
          <h2 className="section-title mb-3">New lead</h2>
          <div className="grid grid-cols-3 gap-2">
            <input className="input-field" placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input-field" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <input className="input-field" placeholder="Source" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
          </div>
          <button className="btn-primary mt-2 w-full" onClick={createLead}>Add lead</button>
        </div>
      </div>

      <div className="card">
        <h2 className="section-title mb-3">Leads</h2>
        <div className="space-y-1.5 max-h-96 overflow-auto">
          {leads.map((l) => (
            <div key={l.id} className="flex items-center justify-between text-sm border-b border-border py-2">
              <span className="text-text-primary">{l.name}<span className="text-text-muted">{l.phone ? ` · ${l.phone}` : ''}{l.source ? ` · ${l.source}` : ''}</span></span>
              <span className="flex items-center gap-2">
                <span className="badge bg-surface-sunken text-text-secondary capitalize">{l.status}</span>
                {NEXT[l.status] && <button className="btn-ghost text-xs" onClick={() => advance(l)}>→ {NEXT[l.status]}</button>}
              </span>
            </div>
          ))}
          {leads.length === 0 && <p className="text-sm text-text-muted">No leads yet.</p>}
        </div>
      </div>
    </div>
  );
}
