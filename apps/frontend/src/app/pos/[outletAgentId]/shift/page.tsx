'use client';

/**
 * POS Shift — open/close the register, petty cash, and shift issues.
 * Tracks per-shift sales, attendance (operator + open/close), and cash
 * reconciliation (opening float + cash sales + petty cash → expected vs counted).
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { isAuthenticated, getUser } from '@/lib/auth';
import { getPosOutletId } from '@/lib/posDevice';
import { PosNav } from '@/components/pos/PosNav';
import { useI18n } from '@/lib/i18n';

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
  const { t } = useI18n();
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
  // Attendance gate at shift open: a reason is required when the operator has no
  // schedule today (late / unscheduled login) or is opening an off-schedule branch.
  const [offSchedule, setOffSchedule] = useState(false);
  const [noSchedule, setNoSchedule] = useState(false);
  const [openReason, setOpenReason] = useState('');
  // Today's roster (from HR) — drives the default branch, the roster banner, and
  // the soft shift-time-mismatch warning.
  const [roster, setRoster] = useState<{ outletId: string | null; outletName: string | null; startTime: string | null; endTime: string | null } | null>(null);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [openOutletId, setOpenOutletId] = useState<string>('');

  const load = useCallback(async () => {
    try {
      const [cur, hist] = await Promise.all([
        api.get<Shift | null>('/shifts/current'),
        api.get<Shift[]>('/shifts'),
      ]);
      setShift(cur); setHistory(hist); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : t('pos.shift.loadFailed', 'Failed to load')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) { window.location.href = '/'; return; }
    load();
    const home = getUser()?.outletId ?? null;
    // On a registered POS terminal the device pin is the authoritative branch —
    // the shift (and therefore every order booked into it) opens at that branch.
    const pinned = getPosOutletId();
    api.get<{ todayOutletId: string | null; todayStartTime: string | null; todayEndTime: string | null; branches: { id: string; name: string }[] }>('/hr/my/branch-context')
      .then((ctx) => {
        const today = ctx?.todayOutletId ?? null;
        setBranches(ctx?.branches ?? []);
        // Device pin wins; otherwise default to today's roster, then home branch.
        const defaultOutlet = pinned ?? today ?? home ?? '';
        setOpenOutletId(defaultOutlet);
        const outletName = ctx?.branches?.find((b) => b.id === today)?.name ?? null;
        setRoster({ outletId: today, outletName, startTime: ctx?.todayStartTime ?? null, endTime: ctx?.todayEndTime ?? null });
        setNoSchedule(today == null);
        setOffSchedule(today == null || today !== defaultOutlet);
      })
      .catch(() => { setNoSchedule(false); setOffSchedule(false); });
  }, [load]);

  // Recompute the off-schedule flag when the operator overrides the branch.
  useEffect(() => {
    if (roster === null) return;
    setOffSchedule(roster.outletId == null || roster.outletId !== openOutletId);
  }, [openOutletId, roster]);

  // Soft warning: current local time is outside the rostered shift window.
  const timeMismatch = (() => {
    if (!roster?.startTime || !roster?.endTime) return null;
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (hhmm < roster.startTime) return 'early';
    if (hhmm > roster.endTime) return 'late';
    return null;
  })();

  const openShift = async () => {
    if (offSchedule && !openReason.trim()) {
      setError(noSchedule
        ? t('pos.shift.noScheduleReason', 'You have no schedule today — enter a reason to open a shift.')
        : t('pos.shift.offBranchReason', 'You are not scheduled at this branch today — enter a reason to open a shift.'));
      return;
    }
    setBusy(true); setError('');
    try {
      await api.post('/shifts/open', {
        openingFloat: Number(openingFloat) || 0,
        outletId: openOutletId || undefined,
        offScheduleReason: offSchedule ? openReason.trim() : undefined,
      });
      setOpeningFloat(''); setOpenReason(''); await load();
    }
    catch (e) { setError(e instanceof Error ? e.message : t('pos.shift.openFailed', 'Failed to open')); } finally { setBusy(false); }
  };
  const closeShift = async () => {
    if (!shift) return;
    if (counted === '') { setError(t('pos.shift.enterCounted', 'Enter the counted cash amount.')); return; }
    setBusy(true); setError('');
    try { await api.post(`/shifts/${shift.id}/close`, { countedCash: Number(counted), notes: closeNotes || undefined }); setCounted(''); setCloseNotes(''); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : t('pos.shift.closeFailed', 'Failed to close')); } finally { setBusy(false); }
  };
  const addPetty = async () => {
    if (!shift || !Number(petty.amount)) return;
    try { await api.post(`/shifts/${shift.id}/petty-cash`, { type: petty.type, amount: Number(petty.amount), reason: petty.reason || undefined }); setPetty({ type: 'out', amount: '', reason: '' }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : t('pos.shift.failed', 'Failed')); }
  };
  const addIssue = async () => {
    if (!shift || !issue.description.trim()) return;
    try { await api.post(`/shifts/${shift.id}/issues`, { severity: issue.severity, description: issue.description.trim() }); setIssue({ severity: 'low', description: '' }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : t('pos.shift.failed', 'Failed')); }
  };

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <PosNav agent={agent} active="shift" title={t('pos.shift.title', 'Shift & Register')} />

      <div className="p-5 flex-1 max-w-5xl mx-auto w-full space-y-6">
        {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
        {loading ? <div className="card text-sm text-text-muted">{t('pos.shift.loading', 'Loading…')}</div> : !shift ? (
          <div className="card max-w-md">
            <h2 className="section-title mb-2">{t('pos.shift.openShift', 'Open shift')}</h2>
            <p className="text-sm text-text-muted mb-3">{t('pos.shift.openIntro', 'Start your register session with the opening cash float.')}</p>

            {/* Today's roster (from HR schedule) */}
            <div className={`mb-3 rounded-lg border p-3 text-sm ${roster?.outletId ? 'border-border bg-surface-sunken/40' : 'border-amber-200 bg-amber-50'}`}>
              {roster?.outletId ? (
                <>
                  <p className="font-medium text-text-primary">{t('pos.shift.rosteredToday', 'Rostered today')}: {roster.outletName ?? '—'}</p>
                  <p className="text-xs text-text-muted">{roster.startTime ? `${roster.startTime}–${roster.endTime ?? ''}` : t('pos.shift.noHoursSet', 'No shift hours set')}</p>
                </>
              ) : (
                <p className="text-amber-700">{t('pos.shift.noScheduleToday', 'You have no schedule today.')}</p>
              )}
            </div>

            {timeMismatch && (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-700">
                {timeMismatch === 'early'
                  ? t('pos.shift.tooEarly', 'You are opening before your rostered start time.')
                  : t('pos.shift.tooLate', 'You are opening after your rostered end time.')}
              </div>
            )}

            {/* Branch is fixed by the registered terminal — no free choice. */}
            {!getPosOutletId() && branches.length > 1 && (
              <div className="mb-3">
                <label className="mb-1 block text-xs font-medium text-text-secondary">{t('pos.shift.branch', 'Branch')}</label>
                <select className="input-field" value={openOutletId} onChange={(e) => setOpenOutletId(e.target.value)}>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}{roster?.outletId === b.id ? ` · ${t('pos.shift.scheduled', 'scheduled')}` : ''}</option>
                  ))}
                </select>
              </div>
            )}

            <input className="input-field mb-3" type="number" placeholder={t('pos.shift.openingFloat', 'Opening cash float')} value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)} />
            {offSchedule && (
              <div className="mb-3">
                <input
                  className="input-field"
                  placeholder={noSchedule ? t('pos.shift.reasonNoSchedule', 'Reason (no schedule today / late) — required') : t('pos.shift.reasonOffBranch', 'Reason for off-schedule branch — required')}
                  value={openReason}
                  onChange={(e) => setOpenReason(e.target.value)}
                />
                <p className="text-xs text-text-muted mt-1">
                  {noSchedule ? t('pos.shift.noScheduleToday', 'You have no schedule today.') : t('pos.shift.notScheduledBranch', 'This is not your scheduled branch today.')} {t('pos.shift.reasonLogged', 'A reason is logged for attendance.')}
                </p>
              </div>
            )}
            <button className="btn-primary w-full" onClick={openShift} disabled={busy}>{busy ? t('pos.shift.opening', 'Opening…') : t('pos.shift.openShiftBtn', 'Open Shift')}</button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="card"><p className="text-xs text-text-muted">{t('pos.shift.salesThisShift', 'Sales this shift')}</p><p className="text-2xl font-semibold text-primary-600">{fmt(shift.liveSales?.total ?? 0)}</p></div>
              <div className="card"><p className="text-xs text-text-muted">{t('pos.shift.orders', 'Orders')}</p><p className="text-2xl font-semibold">{shift.liveSales?.count ?? 0}</p></div>
              <div className="card"><p className="text-xs text-text-muted">{t('pos.shift.cashSales', 'Cash sales')}</p><p className="text-2xl font-semibold">{fmt(shift.liveSales?.cash ?? 0)}</p></div>
              <div className="card"><p className="text-xs text-text-muted">{t('pos.shift.expectedDrawer', 'Expected drawer')}</p><p className="text-2xl font-semibold">{fmt(shift.expectedCashSoFar ?? 0)}</p></div>
            </div>
            <p className="text-xs text-text-muted">{t('pos.shift.opened', 'Opened')} {new Date(shift.openedAt).toLocaleString()} · {t('pos.shift.float', 'float')} {fmt(shift.openingFloat)} · {t('pos.shift.operator', 'operator')} {shift.operatorName ?? '—'}</p>

            <div className="grid lg:grid-cols-2 gap-6">
              <div className="card">
                <h2 className="section-title mb-3">{t('pos.shift.pettyCash', 'Petty cash')}</h2>
                <div className="flex gap-2 mb-2">
                  <select className="input-field w-24" value={petty.type} onChange={(e) => setPetty({ ...petty, type: e.target.value })}><option value="out">{t('pos.shift.out', 'Out')}</option><option value="in">{t('pos.shift.in', 'In')}</option></select>
                  <input className="input-field" type="number" placeholder={t('pos.shift.amount', 'Amount')} value={petty.amount} onChange={(e) => setPetty({ ...petty, amount: e.target.value })} />
                  <input className="input-field" placeholder={t('pos.shift.reason', 'Reason')} value={petty.reason} onChange={(e) => setPetty({ ...petty, reason: e.target.value })} />
                  <button className="btn-secondary" onClick={addPetty}>{t('pos.shift.add', 'Add')}</button>
                </div>
                <p className="text-xs text-text-muted mb-2">{t('pos.shift.in', 'In')} {fmt(shift.pettyCash?.in ?? 0)} · {t('pos.shift.out', 'Out')} {fmt(shift.pettyCash?.out ?? 0)}</p>
                <div className="space-y-1 max-h-40 overflow-auto">
                  {(shift.pettyCash?.movements ?? []).map((m) => (
                    <div key={m.id} className="flex justify-between text-xs border-b border-border py-1"><span>{m.type === 'in' ? '+' : '−'} {m.reason ?? m.category ?? t('pos.shift.cash', 'cash')}</span><span className={m.type === 'in' ? 'text-green-600' : 'text-red-600'}>{fmt(m.amount)}</span></div>
                  ))}
                </div>
              </div>
              <div className="card">
                <h2 className="section-title mb-3">{t('pos.shift.shiftIssues', 'Shift issues')}</h2>
                <div className="flex gap-2 mb-2">
                  <select className="input-field w-28" value={issue.severity} onChange={(e) => setIssue({ ...issue, severity: e.target.value })}><option value="low">{t('pos.shift.low', 'Low')}</option><option value="medium">{t('pos.shift.medium', 'Medium')}</option><option value="high">{t('pos.shift.high', 'High')}</option></select>
                  <input className="input-field" placeholder={t('pos.shift.describeIssue', 'Describe issue')} value={issue.description} onChange={(e) => setIssue({ ...issue, description: e.target.value })} />
                  <button className="btn-secondary" onClick={addIssue}>{t('pos.shift.log', 'Log')}</button>
                </div>
                <div className="space-y-1 max-h-40 overflow-auto">
                  {(shift.issues ?? []).map((i) => (
                    <div key={i.id} className="flex justify-between text-xs border-b border-border py-1"><span className="text-text-primary">{i.description}</span><span className="badge bg-surface-sunken capitalize">{i.severity}</span></div>
                  ))}
                  {(shift.issues ?? []).length === 0 && <p className="text-xs text-text-muted">{t('pos.shift.noIssues', 'No issues logged.')}</p>}
                </div>
              </div>
            </div>

            <div className="card max-w-md">
              <h2 className="section-title mb-2">{t('pos.shift.closeShift', 'Close shift')}</h2>
              <p className="text-sm text-text-muted mb-3">{t('pos.shift.countDrawer', 'Count the drawer. Expected:')} <span className="font-medium text-text-primary">{fmt(shift.expectedCashSoFar ?? 0)}</span></p>
              <input className="input-field mb-2" type="number" placeholder={t('pos.shift.countedCash', 'Counted cash *')} value={counted} onChange={(e) => setCounted(e.target.value)} />
              {counted !== '' && <p className="text-sm mb-2">{t('pos.shift.variance', 'Variance:')} <span className={`font-medium ${Number(counted) - (shift.expectedCashSoFar ?? 0) === 0 ? 'text-text-primary' : (Number(counted) - (shift.expectedCashSoFar ?? 0) < 0 ? 'text-red-600' : 'text-green-600')}`}>{fmt(Number(counted) - (shift.expectedCashSoFar ?? 0))}</span></p>}
              <input className="input-field mb-3" placeholder={t('pos.shift.closingNotes', 'Closing notes (optional)')} value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} />
              <button className="btn-primary w-full" onClick={closeShift} disabled={busy}>{busy ? t('pos.shift.closing', 'Closing…') : t('pos.shift.closeShiftBtn', 'Close Shift')}</button>
            </div>
          </>
        )}

        <div className="card">
          <h2 className="section-title mb-3">{t('pos.shift.recentShifts', 'Recent shifts')}</h2>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-text-muted border-b border-border"><th className="py-2">{t('pos.shift.operatorHeader', 'Operator')}</th><th>{t('pos.shift.opened', 'Opened')}</th><th>{t('pos.shift.status', 'Status')}</th><th className="text-right">{t('pos.shift.sales', 'Sales')}</th><th className="text-right">{t('pos.shift.varianceHeader', 'Variance')}</th></tr></thead>
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
                {history.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-text-muted">{t('pos.shift.noShifts', 'No shifts yet.')}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
