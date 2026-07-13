'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import BranchFilter from '@/components/dashboard/BranchFilter';
import { useI18n } from '@/lib/i18n';
import {
  PageHeader, StatCard, Panel, ErrorBanner, Modal, Field,
  TableWrap, EmptyRow, TableSkeleton, thCls, tdCls,
  fmtIDR, fmtPct, fmtDate, Spinner,
} from '@/components/dashboard/ui';

interface Summary {
  windowDays: number;
  revenue: number;
  expenses: number;
  netProfit: number;
  expensesByCategory: { category: string; total: number }[];
}
interface Expense { id: string; category: string; description: string | null; amount: number; date: string; paymentMethod: string | null; }
interface Forecast { period: string; actual: number; projected: number; target: number; projectedAttainmentPct: number | null; }

const WINDOWS = [7, 30, 90] as const;
const PAYMENT_METHODS = ['cash', 'transfer', 'card', 'qris', 'other'] as const;
const today = () => new Date().toISOString().slice(0, 10);

export default function FinancePage() {
  const { t } = useI18n();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [branch, setBranch] = useState('');
  const [days, setDays] = useState<number>(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showRecord, setShowRecord] = useState(false);
  const [detail, setDetail] = useState<Expense | null>(null);
  const [catFilter, setCatFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const scope = branch ? `outletId=${branch}` : '';
      const [s, e, f] = await Promise.all([
        api.get<Summary>(`/finance/summary?days=${days}${scope ? `&${scope}` : ''}`),
        api.get<Expense[]>(`/finance/expenses?limit=200${scope ? `&${scope}` : ''}`),
        api.get<Forecast>(`/sales/summary${scope ? `?${scope}` : ''}`).catch(() => null),
      ]);
      setSummary(s); setExpenses(e); setForecast(f); setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dash.finance.loadError', 'Failed to load finance data'));
    } finally {
      setLoading(false);
    }
  }, [branch, days, t]);
  useEffect(() => { load(); }, [load]);

  const netMargin = summary && summary.revenue > 0 ? (summary.netProfit / summary.revenue) * 100 : null;
  const categoryTotals = summary?.expensesByCategory ?? [];
  const shownExpenses = catFilter ? expenses.filter((e) => e.category === catFilter) : expenses;
  const maxCat = Math.max(1, ...categoryTotals.map((c) => c.total));
  // Existing categories feed the datalist so entry stays consistent over time.
  const knownCategories = useMemo(
    () => Array.from(new Set([...categoryTotals.map((c) => c.category), ...expenses.map((e) => e.category)])).sort(),
    [categoryTotals, expenses],
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title={t('dash.finance.title', 'Finance')}
        subtitle={t('dash.finance.subtitle', 'Revenue, operating expenses and net profit for your selected period. Record and track outgoing costs by category.')}
        actions={
          <>
            <BranchFilter value={branch} onChange={setBranch} label={t('dash.finance.branch', 'Branch')} />
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">{t('dash.finance.period', 'Period')}</label>
              <div className="inline-flex rounded-md border border-border bg-surface-raised p-0.5">
                {WINDOWS.map((w) => (
                  <button
                    key={w}
                    onClick={() => setDays(w)}
                    className={`rounded px-3 py-1.5 text-sm font-medium ${days === w ? 'bg-primary-500 text-white' : 'text-text-secondary hover:text-text-primary'}`}
                  >
                    {w}{t('dash.finance.daySuffix', 'd')}
                  </button>
                ))}
              </div>
            </div>
            <button className="btn-primary self-end" onClick={() => setShowRecord(true)}>+ {t('dash.finance.record', 'Record expense')}</button>
          </>
        }
      />

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard loading={loading} label={`${t('dash.finance.revenue', 'Revenue')} · ${days}${t('dash.finance.daySuffix', 'd')}`} value={fmtIDR(summary?.revenue)} tone="positive" />
        <StatCard loading={loading} label={t('dash.finance.expenses', 'Expenses')} value={fmtIDR(summary?.expenses)} tone="negative" />
        <StatCard loading={loading} label={t('dash.finance.netProfit', 'Net profit')} value={fmtIDR(summary?.netProfit)} tone={(summary?.netProfit ?? 0) >= 0 ? 'default' : 'negative'} />
        <StatCard loading={loading} label={t('dash.finance.netMargin', 'Net margin')} value={fmtPct(netMargin)} tone={netMargin == null ? 'default' : netMargin >= 0 ? 'positive' : 'negative'} />
      </div>

      {/* Revenue this month — actual vs forecast (run-rate) vs target */}
      {forecast && (forecast.target > 0 || forecast.actual > 0) && (
        <Panel
          title={t('dash.overview.revenueThisMonth', 'Revenue this month')}
          actions={<span className="text-xs text-text-muted">{forecast.period}</span>}
        >
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div><p className="text-xs text-text-muted">{t('dash.overview.fcActual', 'Actual so far')}</p><p className="text-xl font-semibold text-green-600">{fmtIDR(forecast.actual)}</p></div>
            <div><p className="text-xs text-text-muted">{t('dash.overview.fcForecast', 'Forecast (month-end)')}</p><p className="text-xl font-semibold text-primary-600">{fmtIDR(forecast.projected)}</p></div>
            <div><p className="text-xs text-text-muted">{t('dash.overview.fcTarget', 'Target')}</p><p className="text-xl font-semibold">{forecast.target > 0 ? fmtIDR(forecast.target) : '—'}</p></div>
            <div><p className="text-xs text-text-muted">{t('dash.overview.fcAttainment', 'Projected attainment')}</p><p className={`text-xl font-semibold ${forecast.projectedAttainmentPct == null ? '' : forecast.projectedAttainmentPct >= 100 ? 'text-green-600' : 'text-amber-600'}`}>{forecast.projectedAttainmentPct != null ? `${forecast.projectedAttainmentPct}%` : '—'}</p></div>
          </div>
        </Panel>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Recent expenses */}
        <div className="lg:col-span-2">
          <Panel
            title={t('dash.finance.recentExpenses', 'Recent expenses')}
            bodyClassName="p-0"
            description={catFilter ? undefined : t('dash.finance.recentExpensesDesc', 'Latest recorded costs — click a row for details')}
            actions={catFilter ? (
              <button className="btn-ghost py-1 text-xs" onClick={() => setCatFilter('')}>
                {t('dash.finance.filteredBy', 'Filtered')}: {catFilter} ✕
              </button>
            ) : undefined}
          >
            {loading ? (
              <TableSkeleton rows={6} cols={4} />
            ) : (
              <TableWrap>
                <thead>
                  <tr className="border-b border-border bg-surface-sunken/50">
                    <th className={`${thCls} text-left`}>{t('dash.finance.colDate', 'Date')}</th>
                    <th className={`${thCls} text-left`}>{t('dash.finance.colCategory', 'Category')}</th>
                    <th className={`${thCls} text-left`}>{t('dash.finance.colDescription', 'Description')}</th>
                    <th className={`${thCls} text-left`}>{t('dash.finance.colMethod', 'Method')}</th>
                    <th className={`${thCls} text-right`}>{t('dash.finance.colAmount', 'Amount')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {shownExpenses.length === 0 ? (
                    <EmptyRow colSpan={5}>{t('dash.finance.noExpenses', 'No expenses recorded in this period.')}</EmptyRow>
                  ) : shownExpenses.map((e) => (
                    <tr key={e.id} className="cursor-pointer hover:bg-surface-sunken/40" onClick={() => setDetail(e)}>
                      <td className={`${tdCls} whitespace-nowrap text-text-muted`}>{fmtDate(e.date)}</td>
                      <td className={`${tdCls} font-medium`}>{e.category}</td>
                      <td className={`${tdCls} text-text-secondary`}>{e.description || '—'}</td>
                      <td className={`${tdCls} capitalize text-text-secondary`}>{e.paymentMethod || '—'}</td>
                      <td className={`${tdCls} text-right font-medium tabular-nums text-rose-600`}>{fmtIDR(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Panel>
        </div>

        {/* By category */}
        <Panel title={t('dash.finance.byCategory', 'Expenses by category')}>
          {loading ? (
            <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-8 animate-pulse rounded bg-surface-sunken" />)}</div>
          ) : categoryTotals.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">{t('dash.finance.noData', 'No data.')}</p>
          ) : (
            <div className="space-y-3">
              {categoryTotals.map((c) => (
                <button key={c.category} className="block w-full text-left" onClick={() => setCatFilter(catFilter === c.category ? '' : c.category)}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className={`${catFilter === c.category ? 'font-semibold text-primary-600' : 'text-text-primary'}`}>{c.category}</span>
                    <span className="font-medium tabular-nums text-text-secondary">{fmtIDR(c.total)}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
                    <div className={`h-full rounded-full ${catFilter === c.category ? 'bg-primary-600' : 'bg-primary-500'}`} style={{ width: `${Math.max(4, (c.total / maxCat) * 100)}%` }} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {showRecord && (
        <RecordExpenseModal
          branch={branch}
          categories={knownCategories}
          onClose={() => setShowRecord(false)}
          onSaved={() => { setShowRecord(false); load(); }}
        />
      )}

      {detail && (
        <Modal title={t('dash.finance.expenseDetail', 'Expense detail')} onClose={() => setDetail(null)}>
          <dl className="divide-y divide-border text-sm">
            <div className="flex justify-between py-2"><dt className="text-text-secondary">{t('dash.finance.colDate', 'Date')}</dt><dd className="font-medium text-text-primary">{fmtDate(detail.date)}</dd></div>
            <div className="flex justify-between py-2"><dt className="text-text-secondary">{t('dash.finance.colCategory', 'Category')}</dt><dd className="font-medium text-text-primary">{detail.category}</dd></div>
            <div className="flex justify-between py-2"><dt className="text-text-secondary">{t('dash.finance.colMethod', 'Method')}</dt><dd className="capitalize text-text-primary">{detail.paymentMethod || '—'}</dd></div>
            <div className="flex justify-between gap-6 py-2"><dt className="text-text-secondary">{t('dash.finance.colDescription', 'Description')}</dt><dd className="text-right text-text-primary">{detail.description || '—'}</dd></div>
            <div className="flex justify-between py-2"><dt className="text-text-secondary">{t('dash.finance.colAmount', 'Amount')}</dt><dd className="text-lg font-bold tabular-nums text-rose-600">{fmtIDR(detail.amount)}</dd></div>
          </dl>
        </Modal>
      )}
    </div>
  );
}

function RecordExpenseModal({
  branch, categories, onClose, onSaved,
}: {
  branch: string;
  categories: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({ category: '', amount: '', description: '', expenseDate: today(), paymentMethod: 'cash' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!form.category.trim() || !(Number(form.amount) > 0)) {
      setError(t('dash.finance.validation', 'Category and a positive amount are required.'));
      return;
    }
    setSaving(true); setError('');
    try {
      await api.post('/finance/expenses', {
        category: form.category.trim(),
        amount: Number(form.amount),
        description: form.description || undefined,
        expenseDate: form.expenseDate || undefined,
        paymentMethod: form.paymentMethod || undefined,
        outletId: branch || undefined,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dash.finance.recordError', 'Failed to record expense'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={t('dash.finance.recordExpense', 'Record expense')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>{t('common.cancel', 'Cancel')}</button>
          <button type="submit" form="record-expense-form" className="btn-primary" disabled={saving}>
            {saving ? <Spinner /> : t('dash.finance.save', 'Save expense')}
          </button>
        </>
      }
    >
      <form id="record-expense-form" onSubmit={submit} className="space-y-4">
        <ErrorBanner message={error} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('dash.finance.colCategory', 'Category')}>
            <input className="input-field" list="expense-categories" value={form.category} placeholder={t('dash.finance.categoryPh', 'e.g. Utilities')} onChange={(e) => setForm({ ...form, category: e.target.value })} required />
            <datalist id="expense-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label={t('dash.finance.colAmount', 'Amount (Rp)')}>
            <input className="input-field" type="number" min="1" value={form.amount} placeholder="0" onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          </Field>
          <Field label={t('dash.finance.colDate', 'Date')}>
            <input className="input-field" type="date" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} />
          </Field>
          <Field label={t('dash.finance.colMethod', 'Payment method')}>
            <select className="input-field capitalize" value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
        </div>
        <Field label={t('dash.finance.colDescription', 'Description')} hint={t('dash.finance.descriptionHint', 'Optional note for this expense')}>
          <input className="input-field" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
      </form>
    </Modal>
  );
}
