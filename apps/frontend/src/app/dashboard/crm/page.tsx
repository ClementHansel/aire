'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

interface GrowthPoint { period: string; newCustomers: number }
interface Customer { id: string; name: string; phone: string; createdAt: string; totalVisits: number }

function today(): string { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function daysAgo(n: number): string { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

function Bars({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-1.5">
      {data.length === 0 ? <p className="text-sm text-text-muted italic">No data.</p> : data.map((d, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 text-text-muted truncate">{d.label}</span>
          <div className="flex-1 bg-surface-sunken rounded h-5 overflow-hidden"><div className="h-full bg-primary-500 rounded" style={{ width: `${(d.value / max) * 100}%` }} /></div>
          <span className="w-10 text-right font-mono text-text-secondary">{d.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function CrmPage() {
  const [dateFrom, setDateFrom] = useState(daysAgo(30));
  const [dateTo, setDateTo] = useState(today());
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day');
  const [growth, setGrowth] = useState<GrowthPoint[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Customer | null>(null);

  const loadGrowth = useCallback(async () => {
    try { setGrowth(await api.get<GrowthPoint[]>(`/reports/customer-growth?dateFrom=${dateFrom}&dateTo=${dateTo}&granularity=${granularity}`)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
  }, [dateFrom, dateTo, granularity]);

  const loadCustomers = useCallback(async () => {
    try {
      const res = await api.get<{ customers: Customer[]; total: number }>(`/customers/list?page=${page}&pageSize=${pageSize}${search ? `&search=${encodeURIComponent(search)}` : ''}`);
      setCustomers(res.customers); setTotal(res.total);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
  }, [page, pageSize, search]);

  useEffect(() => { loadGrowth(); }, [loadGrowth]);
  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  const del = async (c: Customer) => {
    if (!confirm(`Delete customer ${c.name}?`)) return;
    try { await api.delete(`/customers/${c.id}`); await loadCustomers(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Delete failed'); }
  };
  const save = async (patch: { name: string; phone: string }) => {
    if (!editing) return;
    try { await api.put(`/customers/${editing.id}`, patch); setEditing(null); await loadCustomers(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Save failed'); }
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const totalNew = growth.reduce((a, b) => a + b.newCustomers, 0);

  return (
    <div data-testid="crm-page">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Customers & Members</h1>
        <p className="mt-1 text-sm text-text-secondary">Customer growth, CRM table, and member management.</p>
      </div>
      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      <div className="card mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div><label className="block text-xs font-medium text-text-secondary mb-1">From</label><input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-field" /></div>
          <div><label className="block text-xs font-medium text-text-secondary mb-1">To</label><input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-field" /></div>
          <div><label className="block text-xs font-medium text-text-secondary mb-1">Group by</label>
            <select value={granularity} onChange={(e) => setGranularity(e.target.value as 'day' | 'week' | 'month')} className="input-field">
              <option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option>
            </select></div>
          <div className="card bg-surface-sunken px-4 py-2"><p className="text-xs text-text-muted">New customers</p><p className="text-xl font-bold">{totalNew}</p></div>
        </div>
      </div>

      <div className="card mb-6"><h2 className="section-title mb-3">New customers ({granularity})</h2><Bars data={growth.map((g) => ({ label: g.period, value: g.newCustomers }))} /></div>

      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-text-primary">Customers ({total})</h2>
          <input className="input-field max-w-xs py-1 text-sm" placeholder="Search name or phone…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <table className="w-full">
          <thead><tr className="border-b border-border bg-surface-sunken/50">
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Name</th>
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Phone</th>
            <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">Visits</th>
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">First seen</th>
            <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">Actions</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {customers.length === 0 ? <tr><td colSpan={5} className="px-5 py-6 text-sm text-text-muted text-center">No customers.</td></tr> : customers.map((c) => (
              <tr key={c.id}>
                <td className="px-5 py-3 text-sm font-medium">{c.name}</td>
                <td className="px-5 py-3 text-sm">{c.phone}</td>
                <td className="px-5 py-3 text-sm text-right">{c.totalVisits}</td>
                <td className="px-5 py-3 text-xs text-text-muted">{new Date(c.createdAt).toLocaleDateString()}</td>
                <td className="px-5 py-3 text-right whitespace-nowrap">
                  <button className="btn-ghost text-xs" onClick={() => setEditing(c)}>Edit</button>
                  <button className="btn-ghost text-xs text-red-600" onClick={() => del(c)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-5 py-3 border-t border-border text-sm">
          <span className="text-text-muted">Page {page} / {pages}</span>
          <div className="flex gap-2">
            <button className="btn-ghost text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
            <button className="btn-ghost text-xs" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditing(null)}>
          <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="section-title mb-4">Edit customer</h3>
            <EditCustomer customer={editing} onSave={save} onClose={() => setEditing(null)} />
          </div>
        </div>
      )}
    </div>
  );
}

function EditCustomer({ customer, onSave, onClose }: { customer: Customer; onSave: (p: { name: string; phone: string }) => void; onClose: () => void }) {
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone);
  return (
    <>
      <div className="space-y-3">
        <div><label className="block text-sm font-medium mb-1.5">Name</label><input className="input-field" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className="block text-sm font-medium mb-1.5">Phone</label><input className="input-field" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
      </div>
      <div className="flex gap-2 justify-end mt-4">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={() => onSave({ name, phone })}>Save</button>
      </div>
    </>
  );
}
