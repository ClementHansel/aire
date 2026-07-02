'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import BranchFilter from '@/components/dashboard/BranchFilter';

interface Booking {
  id: string;
  outletId: string | null;
  outletName: string | null;
  customerName: string;
  customerPhone: string | null;
  licensePlate: string | null;
  serviceId: string | null;
  serviceName: string | null;
  scheduledAt: string;
  status: 'booked' | 'confirmed' | 'done' | 'cancelled';
  notes: string | null;
}
interface Branch { id: string; name: string }
interface ServiceLite { id: string; name: string }

const STATUS_BADGE: Record<string, string> = {
  booked: 'bg-amber-50 text-amber-700',
  confirmed: 'bg-blue-50 text-blue-700',
  done: 'bg-green-50 text-green-700',
  cancelled: 'bg-red-50 text-red-700',
};
const FILTERS = ['all', 'booked', 'confirmed', 'done', 'cancelled'];

function BookingModal({ initial, branches, services, onClose, onSaved }: {
  initial: Booking | null; branches: Branch[]; services: ServiceLite[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    outletId: initial?.outletId ?? (branches[0]?.id ?? ''),
    customerName: initial?.customerName ?? '',
    customerPhone: initial?.customerPhone ?? '',
    licensePlate: initial?.licensePlate ?? '',
    serviceId: initial?.serviceId ?? '',
    scheduledAt: initial?.scheduledAt ? initial.scheduledAt.slice(0, 16) : '',
    notes: initial?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');
    const payload = {
      outletId: form.outletId || null,
      customerName: form.customerName.trim(),
      customerPhone: form.customerPhone || null,
      licensePlate: form.licensePlate || null,
      serviceId: form.serviceId || null,
      serviceName: services.find((s) => s.id === form.serviceId)?.name ?? null,
      scheduledAt: new Date(form.scheduledAt).toISOString(),
      notes: form.notes || null,
    };
    try {
      if (initial) await api.put(`/bookings/${initial.id}`, payload);
      else await api.post('/bookings', payload);
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title mb-4">{initial ? 'Edit Booking' : 'New Booking'}</h3>
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium mb-1.5">Customer name</label><input aria-label="Customer Name" className="input-field" value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} required /></div>
            <div><label className="block text-sm font-medium mb-1.5">Phone</label><input aria-label="Customer Phone" className="input-field" value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} placeholder="08123…" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium mb-1.5">License plate</label><input aria-label="License Plate" className="input-field uppercase" value={form.licensePlate} onChange={(e) => setForm({ ...form, licensePlate: e.target.value.toUpperCase() })} placeholder="D1234ABC" /></div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Branch</label>
              <select aria-label="Outlet Id" className="input-field" value={form.outletId} onChange={(e) => setForm({ ...form, outletId: e.target.value })}>
                <option value="">—</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Service</label>
            <select aria-label="Service Id" className="input-field" value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })}>
              <option value="">— select —</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Scheduled date &amp; time</label>
            <input aria-label="Scheduled At" type="datetime-local" className="input-field" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Notes</label>
            <input aria-label="Notes" className="input-field" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
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

export default function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [services, setServices] = useState<ServiceLite[]>([]);
  const [filter, setFilter] = useState('all');
  const [branch, setBranch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<{ open: boolean; editing: Booking | null }>({ open: false, editing: null });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      if (filter !== 'all') params.set('status', filter);
      if (branch) params.set('outletId', branch);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const [bk, br, sv] = await Promise.all([
        api.get<Booking[]>(`/bookings${qs}`),
        api.get<Branch[]>('/outlets'),
        api.get<ServiceLite[]>('/services'),
      ]);
      setBookings(bk); setBranches(br); setServices(sv);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [filter, branch]);
  useEffect(() => { load(); }, [load]);

  const setStatus = async (b: Booking, status: Booking['status']) => {
    try { await api.put(`/bookings/${b.id}`, { status }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
  };
  const remove = async (id: string) => {
    if (!confirm('Delete this booking?')) return;
    try { await api.delete(`/bookings/${id}`); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Delete failed'); }
  };

  return (
    <div data-testid="bookings-page">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Bookings</h1>
          <p className="mt-1 text-sm text-text-secondary">Scheduled appointments — customers reserve a service slot ahead of arrival.</p>
        </div>
        <button className="btn-primary" onClick={() => setModal({ open: true, editing: null })}>+ New Booking</button>
      </div>

      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <div className="flex gap-2">
          {FILTERS.map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} className={`badge capitalize ${filter === f ? 'bg-primary-500 text-white' : 'bg-surface-sunken text-text-secondary'}`}>{f}</button>
          ))}
        </div>
        <BranchFilter value={branch} onChange={setBranch} />
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      {loading ? (
        <div className="card text-sm text-text-muted">Loading…</div>
      ) : bookings.length === 0 ? (
        <div className="card text-sm text-text-muted">No bookings.</div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full">
            <thead><tr className="border-b border-border bg-surface-sunken/50">
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">When</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Customer</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Service</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Branch</th>
              <th className="text-center px-5 py-3 text-xs font-medium text-text-secondary uppercase">Status</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {bookings.map((b) => (
                <tr key={b.id}>
                  <td className="px-5 py-3 text-sm">{new Date(b.scheduledAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td className="px-5 py-3 text-sm font-medium text-text-primary">{b.customerName}<div className="text-xs text-text-muted">{b.customerPhone}{b.licensePlate ? ` · ${b.licensePlate}` : ''}</div></td>
                  <td className="px-5 py-3 text-sm text-text-secondary">{b.serviceName ?? '—'}</td>
                  <td className="px-5 py-3 text-sm text-text-secondary">{b.outletName ?? '—'}</td>
                  <td className="px-5 py-3 text-center"><span className={`badge capitalize ${STATUS_BADGE[b.status]}`}>{b.status}</span></td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    {b.status === 'booked' && <button className="btn-ghost text-xs text-blue-600" onClick={() => setStatus(b, 'confirmed')}>Confirm</button>}
                    {(b.status === 'booked' || b.status === 'confirmed') && <button className="btn-ghost text-xs text-green-600" onClick={() => setStatus(b, 'done')}>Done</button>}
                    <button className="btn-ghost text-xs" onClick={() => setModal({ open: true, editing: b })}>Edit</button>
                    <button className="btn-ghost text-xs text-red-600" onClick={() => remove(b.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal.open && <BookingModal initial={modal.editing} branches={branches} services={services} onClose={() => setModal({ open: false, editing: null })} onSaved={() => { setModal({ open: false, editing: null }); load(); }} />}
    </div>
  );
}
