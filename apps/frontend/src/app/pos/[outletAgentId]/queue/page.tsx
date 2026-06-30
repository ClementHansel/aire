'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { isAuthenticated, getUser, logout } from '@/lib/auth';

interface QueueEntry {
  id: string; plate: string | null; brand: string | null; model: string | null;
  businessUnit: string | null; note: string | null; status: string; position: number; createdAt: string;
}

export default function QueuePage() {
  const params = useParams();
  const agent = params.outletAgentId as string;
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [plate, setPlate] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [businessUnit, setBusinessUnit] = useState<'AIRE' | 'LEAD'>('AIRE');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setEntries(await api.get<QueueEntry[]>('/vehicle-queue')); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load queue'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) { window.location.href = '/'; return; }
    load();
    const id = setInterval(load, 8000); // light polling for a shared queue view
    return () => clearInterval(id);
  }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!plate.trim()) { setError('Enter at least a plate number'); return; }
    setError('');
    try {
      await api.post('/vehicle-queue', { plate: plate.trim().toUpperCase(), brand: brand.trim() || undefined, model: model.trim() || undefined, businessUnit });
      setPlate(''); setBrand(''); setModel('');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to add'); }
  };

  const setStatus = async (id: string, status: string) => {
    try { await api.patch(`/vehicle-queue/${id}/status`, { status }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
  };

  const user = getUser();

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <header className="bg-surface-raised border-b border-border px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-primary-500 rounded-lg flex items-center justify-center"><span className="text-sm font-bold text-white">A</span></div>
            <div><p className="font-semibold text-text-primary text-sm">Queue</p><p className="text-xs text-text-muted">Agent: {agent}</p></div>
          </div>
          <nav className="hidden sm:flex gap-1 text-sm">
            <a href="/hub" className="btn-ghost py-1.5 px-3">🏠 Hub</a>
            <Link href={`/pos/${agent}/new-order`} className="btn-ghost py-1.5 px-3">New Order</Link>
            <Link href={`/pos/${agent}/orders`} className="btn-ghost py-1.5 px-3">Orders</Link>
            <span className="btn-ghost py-1.5 px-3 bg-surface-sunken">Queue</span>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-secondary">{user?.name}</span>
          <button onClick={logout} className="text-xs text-text-secondary hover:text-text-primary">Sign out</button>
        </div>
      </header>

      {error && <div className="mx-5 mt-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      <div className="flex-1 grid lg:grid-cols-3 gap-5 p-5">
        {/* Add arrival */}
        <div className="card h-fit">
          <h2 className="section-title mb-3">Log Arrival</h2>
          <form onSubmit={add} className="space-y-3">
            <div className="inline-flex rounded-full border border-border bg-surface-raised p-0.5 w-full">
              {(['AIRE', 'LEAD'] as const).map((bu) => (
                <button key={bu} type="button" onClick={() => setBusinessUnit(bu)} className={`flex-1 px-3 py-1.5 text-sm font-semibold rounded-full ${businessUnit === bu ? 'bg-primary-500 text-white' : 'text-text-secondary'}`}>{bu}</button>
              ))}
            </div>
            <input className="input-field uppercase" placeholder="Plate (e.g. D1234ABC) *" value={plate} onChange={(e) => setPlate(e.target.value)} />
            <input className="input-field" placeholder="Brand (e.g. Honda)" value={brand} onChange={(e) => setBrand(e.target.value)} />
            <input className="input-field" placeholder="Type (e.g. Brio)" value={model} onChange={(e) => setModel(e.target.value)} />
            <button type="submit" className="btn-primary w-full">+ Add to queue</button>
          </form>
          <p className="text-xs text-text-muted mt-2">Record cars as they arrive. Complete the product &amp; payment later from New Order.</p>
        </div>

        {/* Queue list */}
        <div className="lg:col-span-2">
          <h2 className="section-title mb-3">In Queue ({entries.length})</h2>
          {loading ? <div className="card text-sm text-text-muted">Loading…</div> : entries.length === 0 ? (
            <div className="card text-sm text-text-muted">Queue is empty.</div>
          ) : (
            <div className="space-y-2">
              {entries.map((q) => (
                <div key={q.id} className={`card flex items-center gap-4 ${q.status === 'serving' ? 'border-primary-300 ring-1 ring-primary-100' : ''}`}>
                  <div className="w-9 h-9 rounded-full bg-surface-sunken flex items-center justify-center text-sm font-bold text-text-secondary shrink-0">{q.position}</div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-text-primary">{q.plate ?? '—'} <span className={`badge ml-1 ${q.businessUnit === 'LEAD' ? 'bg-violet-50 text-violet-700' : 'bg-sky-50 text-sky-700'}`}>{q.businessUnit ?? 'AIRE'}</span></p>
                    <p className="text-xs text-text-muted">{[q.brand, q.model].filter(Boolean).join(' ') || 'Vehicle details not set'} · {new Date(q.createdAt).toLocaleTimeString()}</p>
                  </div>
                  <span className={`badge ${q.status === 'serving' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'} capitalize`}>{q.status}</span>
                  <div className="flex gap-1">
                    {q.status === 'waiting' && <button className="btn-ghost text-xs text-amber-600" onClick={() => setStatus(q.id, 'serving')}>Start</button>}
                    <Link href={`/pos/${agent}/new-order`} className="btn-ghost text-xs">Order</Link>
                    <button className="btn-ghost text-xs text-green-600" onClick={() => setStatus(q.id, 'done')}>Done</button>
                    <button className="btn-ghost text-xs text-red-600" onClick={() => setStatus(q.id, 'cancelled')}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
