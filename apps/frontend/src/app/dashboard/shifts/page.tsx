'use client';

/**
 * Shift & cash reconciliation (tenant-owner). Tenant-wide view over /api/shifts:
 * who worked, opening float, cash vs non-cash sales, expected vs counted cash,
 * and variance — with a drawer showing petty-cash movements and logged issues.
 */

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { PageHeader, Panel, StatCard, TableWrap, thCls, tdCls, EmptyRow, fmtIDR, fmtIDRSigned, fmtDateTime, Modal } from '@/components/dashboard/ui';
import BranchFilter from '@/components/dashboard/BranchFilter';

interface Shift {
  id: string; outletId: string; operatorName: string | null; status: 'open' | 'closed';
  openingFloat: number; closingCounted: number | null; expectedCash: number | null; variance: number | null;
  cashSales: number | null; nonCashSales: number | null; totalSales: number | null; orderCount: number | null;
  notes: string | null; openedAt: string; closedAt: string | null;
}
interface PettyMovement { id: string; type: 'in' | 'out'; amount: number; category: string | null; reason: string | null; at: string }
interface ShiftDetail extends Shift {
  liveSales: { cash: number; nonCash: number; total: number; count: number };
  pettyCash: { in: number; out: number; movements: PettyMovement[] };
  expectedCashSoFar: number;
  issues: { id: string; severity: string; description: string; at: string }[];
}

const varianceCls = (v: number | null) =>
  v == null ? 'text-text-muted' : v === 0 ? 'text-emerald-600' : Math.abs(v) < 1000 ? 'text-amber-600' : 'text-rose-600';

export default function ShiftsPage() {
  const { t } = useI18n();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [branch, setBranch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<ShiftDetail | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams();
      if (branch) qs.set('outletId', branch);
      if (dateFrom) qs.set('dateFrom', dateFrom);
      if (dateTo) qs.set('dateTo', dateTo);
      setShifts(await api.get<Shift[]>(`/shifts?${qs.toString()}`));
    } catch (e) { setError(e instanceof Error ? e.message : t('dash.shifts.failLoad', 'Failed to load shifts')); }
    finally { setLoading(false); }
  }, [branch, dateFrom, dateTo]);
  useEffect(() => { load(); }, [load]);

  const openView = async (id: string) => {
    try { setDetail(await api.get<ShiftDetail>(`/shifts/${id}`)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  };

  const openCount = shifts.filter((s) => s.status === 'open').length;
  const totalVariance = shifts.reduce((a, s) => a + (s.variance ?? 0), 0);
  const totalCash = shifts.reduce((a, s) => a + (s.cashSales ?? 0), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('dash.shifts.title', 'Shifts & Cash')}
        subtitle={t('dash.shifts.subtitle', 'Register sessions across all branches — opening float, cash vs non-cash sales, and counted-vs-expected variance for daily cash reconciliation.')}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label={t('dash.shifts.openNow', 'Open now')} value={String(openCount)} />
        <StatCard label={t('dash.shifts.cashSales', 'Cash sales (shown)')} value={fmtIDR(totalCash)} />
        <StatCard label={t('dash.shifts.netVariance', 'Net variance (shown)')} value={fmtIDRSigned(totalVariance)} />
      </div>

      <Panel bodyClassName="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <BranchFilter value={branch} onChange={setBranch} />
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.shifts.from', 'From')}</label>
            <input type="date" className="input-field py-1.5" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.shifts.to', 'To')}</label>
            <input type="date" className="input-field py-1.5" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>
      </Panel>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      <Panel bodyClassName="p-0">
        <TableWrap>
          <thead className="bg-surface-sunken/50 border-b border-border">
            <tr>
              <th className={`${thCls} text-left`}>{t('dash.shifts.operator', 'Operator')}</th>
              <th className={`${thCls} text-left`}>{t('dash.shifts.opened', 'Opened')}</th>
              <th className={`${thCls} text-right`}>{t('dash.shifts.float', 'Float')}</th>
              <th className={`${thCls} text-right`}>{t('dash.shifts.cash', 'Cash')}</th>
              <th className={`${thCls} text-right`}>{t('dash.shifts.expected', 'Expected')}</th>
              <th className={`${thCls} text-right`}>{t('dash.shifts.counted', 'Counted')}</th>
              <th className={`${thCls} text-right`}>{t('dash.shifts.variance', 'Variance')}</th>
              <th className={`${thCls} text-left`}>{t('dash.shifts.status', 'Status')}</th>
              <th className={thCls}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <EmptyRow colSpan={9}>{t('dash.shifts.loading', 'Loading…')}</EmptyRow>
            ) : shifts.length === 0 ? (
              <EmptyRow colSpan={9}>{t('dash.shifts.none', 'No shifts in this range.')}</EmptyRow>
            ) : shifts.map((s) => (
              <tr key={s.id} className="hover:bg-surface-sunken/40">
                <td className={tdCls}>{s.operatorName ?? '—'}</td>
                <td className={`${tdCls} whitespace-nowrap`}>{fmtDateTime(s.openedAt)}</td>
                <td className={`${tdCls} text-right`}>{fmtIDR(s.openingFloat)}</td>
                <td className={`${tdCls} text-right`}>{s.cashSales != null ? fmtIDR(s.cashSales) : '—'}</td>
                <td className={`${tdCls} text-right`}>{s.expectedCash != null ? fmtIDR(s.expectedCash) : '—'}</td>
                <td className={`${tdCls} text-right`}>{s.closingCounted != null ? fmtIDR(s.closingCounted) : '—'}</td>
                <td className={`${tdCls} text-right font-medium ${varianceCls(s.variance)}`}>{s.variance != null ? fmtIDRSigned(s.variance) : '—'}</td>
                <td className={tdCls}><span className={`badge ${s.status === 'open' ? 'bg-sky-50 text-sky-700' : 'bg-surface-sunken text-text-secondary'}`}>{s.status}</span></td>
                <td className={`${tdCls} text-right`}><button className="btn-ghost text-xs" onClick={() => openView(s.id)}>{t('dash.shifts.view', 'View')}</button></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Panel>

      {detail && (
        <Modal title={`${detail.operatorName ?? t('dash.shifts.shift', 'Shift')} · ${detail.status}`} onClose={() => setDetail(null)} maxWidth="max-w-lg">
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs text-text-muted">{t('dash.shifts.opened', 'Opened')}</p><p className="font-medium">{fmtDateTime(detail.openedAt)}</p></div>
              <div><p className="text-xs text-text-muted">{t('dash.shifts.closed', 'Closed')}</p><p className="font-medium">{detail.closedAt ? fmtDateTime(detail.closedAt) : '—'}</p></div>
              <div><p className="text-xs text-text-muted">{t('dash.shifts.float', 'Opening float')}</p><p className="font-medium">{fmtIDR(detail.openingFloat)}</p></div>
              <div><p className="text-xs text-text-muted">{t('dash.shifts.orders', 'Orders')}</p><p className="font-medium">{detail.orderCount ?? detail.liveSales.count}</p></div>
              <div><p className="text-xs text-text-muted">{t('dash.shifts.cash', 'Cash sales')}</p><p className="font-medium">{fmtIDR(detail.cashSales ?? detail.liveSales.cash)}</p></div>
              <div><p className="text-xs text-text-muted">{t('dash.shifts.nonCash', 'Non-cash sales')}</p><p className="font-medium">{fmtIDR(detail.nonCashSales ?? detail.liveSales.nonCash)}</p></div>
              <div><p className="text-xs text-text-muted">{t('dash.shifts.expected', 'Expected cash')}</p><p className="font-medium">{fmtIDR(detail.expectedCash ?? detail.expectedCashSoFar)}</p></div>
              <div><p className="text-xs text-text-muted">{t('dash.shifts.counted', 'Counted')}</p><p className="font-medium">{detail.closingCounted != null ? fmtIDR(detail.closingCounted) : '—'}</p></div>
            </div>
            {detail.variance != null && (
              <div className={`rounded-lg p-3 ${varianceCls(detail.variance)} bg-surface-sunken`}>
                <span className="text-xs">{t('dash.shifts.variance', 'Variance')}: </span><span className="font-semibold">{fmtIDRSigned(detail.variance)}</span>
              </div>
            )}
            <div>
              <p className="text-xs font-medium text-text-secondary mb-1">{t('dash.shifts.petty', 'Petty cash')} (+{fmtIDR(detail.pettyCash.in)} / −{fmtIDR(detail.pettyCash.out)})</p>
              {detail.pettyCash.movements.length === 0 ? <p className="text-xs text-text-muted">{t('dash.shifts.noPetty', 'No movements.')}</p> : (
                <div className="space-y-1">
                  {detail.pettyCash.movements.map((m) => (
                    <div key={m.id} className="flex justify-between text-xs">
                      <span className="text-text-muted">{m.type === 'in' ? '+' : '−'} {m.category || ''} {m.reason ? `· ${m.reason}` : ''}</span>
                      <span>{fmtIDR(m.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {detail.issues.length > 0 && (
              <div>
                <p className="text-xs font-medium text-text-secondary mb-1">{t('dash.shifts.issues', 'Issues')}</p>
                {detail.issues.map((i) => (
                  <div key={i.id} className="text-xs text-text-muted">· [{i.severity}] {i.description}</div>
                ))}
              </div>
            )}
            {detail.notes && <p className="text-xs text-text-muted">{t('dash.shifts.notes', 'Notes')}: {detail.notes}</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}
