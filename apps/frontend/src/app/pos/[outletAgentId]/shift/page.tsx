'use client';

/**
 * POS Shift — open/close the register, petty cash, and shift issues.
 * Tracks per-shift sales, attendance (operator + open/close), and cash
 * reconciliation (opening float + cash sales + petty cash → expected vs counted).
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { isAuthenticated, getUser, logout } from '@/lib/auth';

interface Movement { id: string; type: string; amount: number; category: string | null; reason: string | null; at: string; }
interface Issue { id: string; severity: string; description: string; at: string; }
interface Shift {
  id: string; status: string; operatorName: string | null;
  openingFloat: number; totalSales: number | null; cashSales: number | null;
  expectedCash: number | null; closingCounted: number | null; variance: number | null;
  orderCount: number | null; openedAt: string; closedAt: string | null;
  liveSales?: { cash: number; nonCash: number; total: number; count: number };
  expectedCashSoFar?: number;
  pettyCash?: { in: number; out: number; movements: Movement[] };
  issues?: Issue[];
}

const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

export default function ShiftPage() {
  const params = useParams();
  const agent = params.outletAgentId as string;
  const [shift, setShift] = useState<Shift | null>(null);
  const [history, setHistory] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openingFloat, setOpeningFloat] = useState('');
  const [counted, setCounted] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [petty, setPetty] = useState({ type: 'out', amount: '', reason: '' });
  const [issue, setIssue] = useState({ severity: 'low', description: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cur, hist] = await Promise.all([
        api.get<Shift | null>('/shifts/current'),
        api.get<Shift[]>('/shifts'),
      ]);
      setShift(cur); setHistory(hist); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (!isAuthenticated()) { window.location.href = '/'; return; } load(); }, [load]);

  const openShift = async () => {
    setBusy(true); setError('');
    try { await api.post('/shifts/open', { openingFloat: Number(openingFloat) || 0 }); setOpeningFloat(''); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to open'); } finally { setBusy(false); }
  };
  const closeShift = async () => {
    if (!shift) return;
    if (counted === '') { setError('Enter the counted cash amount.'); return; }
    setBusy(true); setError('');
    try { await api.post(`/shifts/${shift.id}/close`, { countedCash: Number(counted), notes: closeNotes || undefined }); setCounted(''); setCloseNotes(''); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to close'); } finally { setBusy(false); }
  };
  const addPetty = async () => {
    if (!shift || !Number(petty.amount)) return;
    try { await api.post(`/shifts/${shift.id}/petty-cash`, { type: petty.type, amount: Number(petty.amount), reason: petty.reason || undefined }); setPetty({ type: 'out', amount: '', reason: '' }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  };
  const addIssue = async () => {
    if (!shift || !issue.description.trim()) return;
    try { await api.post(`/shifts/${shift.id}/issues`, { severity: issue.severity, description: issue.description.trim() }); setIssue({ severity: 'low', description: '' }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  };

  const user = getUser();

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <header className="bg-surface-raised border-b border-border px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-primary-500 rounded-lg flex items-center justify-center"><span className="text-sm font-bold text-white">A</span></div>
            <p className="font-semibold text-text-primary text-sm">Shift &amp; Register</p>
          </div>
          <nav className="flex gap-1 text-sm">
            <Link href={`/pos/${agent}/new-order`} className="btn-ghost py-1.5 px-3">New Order</Link>
            <Link href={`/pos/${agent}/orders`} className="btn-ghost py-1.5 px-3">Orders</Link>
            <Link href={`/pos/${agent}/summary`} className="btn-ghost py-1.5 px-3">Summary</Link>
            <span className="btn-ghost py-1.5 px-3 bg-surface-sunken">Shift</span>
          </nav>
        </div>
        <div className="flex items-center gap-3"><span className="text-xs text-text-secondary">{user?.name}</span><button onClick={logout} className="text-xs text-text-secondary hover:text-text-primary">Sign out</button></div>
      </header>

      <div className="p-5 flex-1 max-w-5xl mx-auto w-full space-y-6">
        {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
        {loading ? <div className="card text-sm text-text-muted">Loading…</div> : !shift ? (
          <div className="card max-w-md">
            <h2 className="section-title mb-2">Open shift</h2>
            <p className="text-sm text-text-muted mb-3">Start your register session with the opening cash float.</p>
            <input className="input-field mb-3" type="number" placeholder="Opening cash float" value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)} />
            <button className="btn-primary w-full" onClick={openShift} disabled={busy}>{busy ? 'Opening…' : 'Open Shift'}</button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="card"><p className="text-xs text-text-muted">Sales this shift</p><p className="text-2xl font-semibold text-primary-600">{fmt(shift.liveSales?.total ?? 0)}</p></div>
              <div className="card"><p className="text-xs text-text-muted">Orders</p><p className="text-2xl font-semibold">{shift.liveSales?.count ?? 0}</p></div>
              <div className="card"><p className="text-xs text-text-muted">Cash sales</p><p className="text-2xl font-semibold">{fmt(shift.liveSales?.cash ?? 0)}</p></div>
              <div className="card"><p className="text-xs text-text-muted">Expected drawer</p><p className="text-2xl font-semibold">{fmt(shift.expectedCashSoFar ?? 0)}</p></div>
            </div>
            <p className="text-xs text-text-muted">Opened {new Date(shift.openedAt).toLocaleString()} · float {fmt(shift.openingFloat)} · operator {shift.operatorName ?? '—'}</p>

            <div className="grid lg:grid-cols-2 gap-6">
              <div className="card">
                <h2 className="section-title mb-3">Petty cash</h2>
                <div className="flex gap-2 mb-2">
                  <select className="input-field w-24" value={petty.type} onChange={(e) => setPetty({ ...petty, type: e.target.value })}><option value="out">Out</option><option value="in">In</option></select>
                  <input className="input-field" type="number" placeholder="Amount" value={petty.amount} onChange={(e) => setPetty({ ...petty, amount: e.target.value })} />
                  <input className="input-field" placeholder="Reason" value={petty.reason} onChange={(e) => setPetty({ ...petty, reason: e.target.value })} />
                  <button className="btn-secondary" onClick={addPetty}>Add</button>
                </div>
                <p className="text-xs text-text-muted mb-2">In {fmt(shift.pettyCash?.in ?? 0)} · Out {fmt(shift.pettyCash?.out ?? 0)}</p>
                <div className="space-y-1 max-h-40 overflow-auto">
                  {(shift.pettyCash?.movements ?? []).map((m) => (
                    <div key={m.id} className="flex justify-between text-xs border-b border-border py-1"><span>{m.type === 'in' ? '+' : '−'} {m.reason ?? m.category ?? 'cash'}</span><span className={m.type === 'in' ? 'text-green-600' : 'text-red-600'}>{fmt(m.amount)}</span></div>
                  ))}
                </div>
              </div>
              <div className="card">
                <h2 className="section-title mb-3">Shift issues</h2>
                <div className="flex gap-2 mb-2">
                  <select className="input-field w-28" value={issue.severity} onChange={(e) => setIssue({ ...issue, severity: e.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select>
                  <input className="input-field" placeholder="Describe issue" value={issue.description} onChange={(e) => setIssue({ ...issue, description: e.target.value })} />
                  <button className="btn-secondary" onClick={addIssue}>Log</button>
                </div>
                <div className="space-y-1 max-h-40 overflow-auto">
                  {(shift.issues ?? []).map((i) => (
                    <div key={i.id} className="flex justify-between text-xs border-b border-border py-1"><span className="text-text-primary">{i.description}</span><span className="badge bg-surface-sunken capitalize">{i.severity}</span></div>
                  ))}
                  {(shift.issues ?? []).length === 0 && <p className="text-xs text-text-muted">No issues logged.</p>}
                </div>
              </div>
            </div>

            <div className="card max-w-md">
              <h2 className="section-title mb-2">Close shift</h2>
              <p className="text-sm text-text-muted mb-3">Count the drawer. Expected: <span className="font-medium text-text-primary">{fmt(shift.expectedCashSoFar ?? 0)}</span></p>
              <input className="input-field mb-2" type="number" placeholder="Counted cash *" value={counted} onChange={(e) => setCounted(e.target.value)} />
              {counted !== '' && <p className="text-sm mb-2">Variance: <span className={`font-medium ${Number(counted) - (shift.expectedCashSoFar ?? 0) === 0 ? 'text-text-primary' : (Number(counted) - (shift.expectedCashSoFar ?? 0) < 0 ? 'text-red-600' : 'text-green-600')}`}>{fmt(Number(counted) - (shift.expectedCashSoFar ?? 0))}</span></p>}
              <input className="input-field mb-3" placeholder="Closing notes (optional)" value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} />
              <button className="btn-primary w-full" onClick={closeShift} disabled={busy}>{busy ? 'Closing…' : 'Close Shift'}</button>
            </div>
          </>
        )}

        <div className="card">
          <h2 className="section-title mb-3">Recent shifts</h2>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-text-muted border-b border-border"><th className="py-2">Operator</th><th>Opened</th><th>Status</th><th className="text-right">Sales</th><th className="text-right">Variance</th></tr></thead>
              <tbody>
                {history.map((s) => (
                  <tr key={s.id} className="border-b border-border">
                    <td className="py-2">{s.operatorName ?? '—'}</td>
                    <td className="text-text-muted">{new Date(s.openedAt).toLocaleString()}</td>
                    <td><span className="badge bg-surface-sunken capitalize">{s.status}</span></td>
                    <td className="text-right">{s.totalSales != null ? fmt(s.totalSales) : '—'}</td>
                    <td className={`text-right ${s.variance != null && s.variance !== 0 ? (s.variance < 0 ? 'text-red-600' : 'text-green-600') : ''}`}>{s.variance != null ? fmt(s.variance) : '—'}</td>
                  </tr>
                ))}
                {history.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-text-muted">No shifts yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
