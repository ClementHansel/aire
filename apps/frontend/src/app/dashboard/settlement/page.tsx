'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import BranchFilter from '@/components/dashboard/BranchFilter';

interface SummaryRow { owingOutletId: string; owingName: string; servingOutletId: string; servingName: string; entries: number; amount: number }
interface PayoutRow { id: string; amount: number; entryCount: number; note: string | null; owingName: string; servingName: string; createdAt: string }

const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

export default function SettlementPage() {
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [branch, setBranch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const bq = branch ? `?outletId=${branch}` : '';
      const [s, p] = await Promise.all([api.get<SummaryRow[]>(`/settlement/summary${bq}`), api.get<PayoutRow[]>(`/settlement/payouts${bq}`)]);
      setSummary(s); setPayouts(p);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load'); }
  }, [branch]);
  useEffect(() => { load(); }, [load]);

  const payout = async (r: SummaryRow) => {
    if (!confirm(`Settle ${fmt(r.amount)} owed by ${r.owingName} to ${r.servingName}?`)) return;
    setBusy(r.owingOutletId + r.servingOutletId);
    try { await api.post('/settlement/payout', { owingOutletId: r.owingOutletId, servingOutletId: r.servingOutletId }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Payout failed'); }
    finally { setBusy(''); }
  };

  const totalPending = summary.reduce((s, r) => s + r.amount, 0);

  return (
    <div data-testid="settlement-page">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Inter-Branch Settlement</h1>
          <p className="mt-1 text-sm text-text-secondary">When a member washes at a branch other than where they bought their membership, the home branch owes the serving branch.</p>
        </div>
        <BranchFilter value={branch} onChange={setBranch} label="Involving branch" />
      </div>
      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="card"><p className="text-xs text-text-muted">Total pending settlement</p><p className="text-2xl font-bold text-text-primary mt-1">{fmt(totalPending)}</p></div>
        <div className="card"><p className="text-xs text-text-muted">Open branch pairs</p><p className="text-2xl font-bold text-text-primary mt-1">{summary.length}</p></div>
      </div>

      <div className="card p-0 overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-border"><h2 className="text-sm font-semibold text-text-primary">Pending (owed)</h2></div>
        <table className="w-full">
          <thead><tr className="border-b border-border bg-surface-sunken/50">
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Owing branch</th>
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Owes</th>
            <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">Entries</th>
            <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">Amount</th>
            <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">Action</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {summary.length === 0 ? <tr><td colSpan={5} className="px-5 py-6 text-sm text-text-muted text-center">Nothing pending.</td></tr> : summary.map((r) => (
              <tr key={r.owingOutletId + r.servingOutletId}>
                <td className="px-5 py-3.5 text-sm font-medium">{r.owingName}</td>
                <td className="px-5 py-3.5 text-sm">{r.servingName}</td>
                <td className="px-5 py-3.5 text-sm text-right">{r.entries}</td>
                <td className="px-5 py-3.5 text-sm text-right font-mono">{fmt(r.amount)}</td>
                <td className="px-5 py-3.5 text-right"><button className="btn-primary text-xs py-1" disabled={busy === r.owingOutletId + r.servingOutletId} onClick={() => payout(r)}>Settle / Payout</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-border"><h2 className="text-sm font-semibold text-text-primary">Payout history</h2></div>
        <table className="w-full">
          <thead><tr className="border-b border-border bg-surface-sunken/50">
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Date</th>
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">From → To</th>
            <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">Entries</th>
            <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">Amount</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {payouts.length === 0 ? <tr><td colSpan={4} className="px-5 py-6 text-sm text-text-muted text-center">No payouts yet.</td></tr> : payouts.map((p) => (
              <tr key={p.id}>
                <td className="px-5 py-3.5 text-xs text-text-muted">{new Date(p.createdAt).toLocaleString()}</td>
                <td className="px-5 py-3.5 text-sm">{p.owingName} → {p.servingName}</td>
                <td className="px-5 py-3.5 text-sm text-right">{p.entryCount}</td>
                <td className="px-5 py-3.5 text-sm text-right font-mono">{fmt(p.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
