'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

interface Branch {
  id: string;
  name: string;
  code: string | null;
  legalEntity: string | null;
  address: string | null;
  phone: string | null;
  mapsUrl: string | null;
  isActive: boolean;
}

interface FormState { name: string; code: string; legalEntity: string; address: string; phone: string; mapsUrl: string }
const EMPTY: FormState = { name: '', code: '', legalEntity: '', address: '', phone: '', mapsUrl: '' };

function BranchModal({ initial, onClose, onSaved }: { initial: Branch | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<FormState>(
    initial
      ? { name: initial.name, code: initial.code ?? '', legalEntity: initial.legalEntity ?? '', address: initial.address ?? '', phone: initial.phone ?? '', mapsUrl: initial.mapsUrl ?? '' }
      : EMPTY,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');
    const payload = {
      name: form.name,
      code: form.code || undefined,
      legalEntity: form.legalEntity || undefined,
      address: form.address || undefined,
      phone: form.phone || undefined,
      mapsUrl: form.mapsUrl || undefined,
    };
    try {
      if (initial) await api.put(`/outlets/${initial.id}`, payload);
      else await api.post('/outlets', payload);
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title mb-4">{initial ? 'Edit Branch' : 'Add Branch'}</h3>
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">Branch name</label>
            <input className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="e.g. Outlet Bintaro" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">Branch code (3 letters — used in voucher codes)</label>
            <input className="input-field uppercase" maxLength={8} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="BTR" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">Legal entity (PT) — label</label>
            <input className="input-field" value={form.legalEntity} onChange={(e) => setForm({ ...form, legalEntity: e.target.value })} placeholder="PT Aire Bersih Nusantara" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">Address</label>
            <input className="input-field" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Jl. ..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">Phone (WhatsApp)</label>
              <input className="input-field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="08118005650" />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">Google Maps link</label>
              <input className="input-field" value={form.mapsUrl} onChange={(e) => setForm({ ...form, mapsUrl: e.target.value })} placeholder="https://maps.app.goo.gl/…" />
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : initial ? 'Update' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setBranches(await api.get<Branch[]>('/outlets')); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load branches'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (b: Branch) => {
    try { await api.patch(`/outlets/${b.id}/${b.isActive ? 'deactivate' : 'activate'}`); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Action failed'); }
  };

  return (
    <div data-testid="branches-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Branches</h1>
          <p className="mt-1 text-sm text-text-secondary">Manage your outlets — name, branch code, legal entity (PT), and address.</p>
        </div>
        <button className="btn-primary" onClick={() => { setEditing(null); setModalOpen(true); }}>+ Add Branch</button>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      {loading ? (
        <div className="card text-sm text-text-muted">Loading…</div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-surface-sunken/50">
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Branch</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Code</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Legal Entity (PT)</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Contact</th>
                <th className="text-center px-5 py-3 text-xs font-medium text-text-secondary uppercase">Status</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {branches.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-6 text-sm text-text-muted text-center">No branches yet.</td></tr>
              ) : branches.map((b) => (
                <tr key={b.id}>
                  <td className="px-5 py-3.5 text-sm font-medium text-text-primary">{b.name}<div className="text-xs text-text-muted">{b.address}</div></td>
                  <td className="px-5 py-3.5"><span className="badge bg-sky-50 text-sky-700 font-mono">{b.code ?? '—'}</span></td>
                  <td className="px-5 py-3.5 text-sm text-text-secondary">{b.legalEntity ?? '—'}</td>
                  <td className="px-5 py-3.5 text-sm text-text-secondary">
                    {b.phone ?? '—'}
                    {b.mapsUrl && (
                      <a href={b.mapsUrl} target="_blank" rel="noopener noreferrer" className="block text-xs text-primary-600 hover:text-primary-700">📍 Maps</a>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-center"><span className={`badge ${b.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{b.isActive ? 'Active' : 'Inactive'}</span></td>
                  <td className="px-5 py-3.5 text-right whitespace-nowrap">
                    <button className="btn-ghost text-xs" onClick={() => { setEditing(b); setModalOpen(true); }}>Edit</button>
                    <button className="btn-ghost text-xs text-amber-600" onClick={() => toggle(b)}>{b.isActive ? 'Deactivate' : 'Activate'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && <BranchModal initial={editing} onClose={() => setModalOpen(false)} onSaved={() => { setModalOpen(false); load(); }} />}
    </div>
  );
}
