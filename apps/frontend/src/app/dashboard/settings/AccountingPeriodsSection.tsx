'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface Period { period: string; status: 'open' | 'closed'; closedAt: string | null }

/**
 * Accounting periods (open/close), per tenant. A month is OPEN unless explicitly
 * closed here; the ledger refuses to post any journal entry dated in a closed
 * month, so a reconciled period can't be altered afterwards. Shows the last 12
 * months plus any explicitly-recorded periods.
 */
export function AccountingPeriodsSection() {
  const { t } = useI18n();
  const [statusByPeriod, setStatusByPeriod] = useState<Record<string, Period>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.get<Period[]>('/accounting/periods');
      setStatusByPeriod(Object.fromEntries(rows.map((r) => [r.period, r])));
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load periods'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Last 12 months, newest first.
  const months: string[] = (() => {
    const out: string[] = [];
    const d = new Date();
    for (let i = 0; i < 12; i++) { out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); d.setMonth(d.getMonth() - 1); }
    return out;
  })();

  const setStatus = async (period: string, status: 'open' | 'closed') => {
    setBusy(period); setError('');
    try { await api.post('/accounting/periods', { period, status }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to update period'); }
    finally { setBusy(''); }
  };

  const fmtMonth = (p: string) => {
    const [y, m] = p.split('-');
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
  };

  return (
    <div className="card">
      <h2 className="section-title mb-1">{t('settings.acct.title', 'Accounting periods')}</h2>
      <p className="section-description mb-4">{t('settings.acct.desc', 'Close a month once its books are reconciled. The ledger will reject any new or edited journal entry dated in a closed month, protecting finalized figures. Reopen a period if you need to correct it.')}</p>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full">
          <thead><tr className="border-b border-border bg-surface-sunken/50">
            <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-secondary">{t('settings.acct.month', 'Month')}</th>
            <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-secondary">{t('settings.acct.status', 'Status')}</th>
            <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wide text-text-secondary">{t('settings.acct.action', 'Action')}</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr><td colSpan={3} className="px-5 py-8 text-center text-sm text-text-muted">{t('common.loading', 'Loading…')}</td></tr>
            ) : months.map((p) => {
              const closed = statusByPeriod[p]?.status === 'closed';
              return (
                <tr key={p} className="hover:bg-surface-sunken/40">
                  <td className="px-5 py-3 text-sm font-medium text-text-primary">{fmtMonth(p)}</td>
                  <td className="px-5 py-3">
                    <span className={`badge ${closed ? 'bg-rose-50 text-rose-700' : 'bg-green-50 text-green-700'}`}>
                      {closed ? t('settings.acct.closed', 'Closed') : t('settings.acct.open', 'Open')}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    {closed ? (
                      <button className="btn-ghost px-3 py-1 text-xs" disabled={busy === p} onClick={() => setStatus(p, 'open')}>{t('settings.acct.reopen', 'Reopen')}</button>
                    ) : (
                      <button className="btn-secondary px-3 py-1 text-xs" disabled={busy === p} onClick={() => setStatus(p, 'closed')}>{t('settings.acct.close', 'Close')}</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
