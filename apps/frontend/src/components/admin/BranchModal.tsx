'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

/**
 * Create-branch (outlet) modal.
 *
 * Backend (POST /api/outlets) scopes by role: a platform super-admin may pass a
 * tenantId (create a branch for the selected tenant); a tenant owner's branch is
 * always linked to their own tenant (the backend forces it), so omit tenantId.
 */
export function BranchModal({
  tenantId,
  onClose,
  onSaved,
}: {
  tenantId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({ name: '', code: '', address: '', phone: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Branch name is required'); return; }
    setSaving(true); setError('');
    try {
      await api.post('/outlets', {
        name: form.name.trim(),
        code: form.code.trim() || undefined,
        address: form.address.trim() || undefined,
        phone: form.phone.trim() || undefined,
        ...(tenantId ? { tenantId } : {}),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create branch');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-surface-raised rounded-xl p-6 w-full max-w-md shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4">Create Branch</h3>
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
          <div>
            <label className="block text-sm font-medium mb-1.5">Branch name *</label>
            <input className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Code <span className="text-text-muted font-normal">(optional — auto from name)</span></label>
            <input className="input-field uppercase" maxLength={3} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. BTR" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Address <span className="text-text-muted font-normal">(optional)</span></label>
            <input className="input-field" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Phone <span className="text-text-muted font-normal">(optional)</span></label>
            <input className="input-field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create Branch'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
