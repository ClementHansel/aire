'use client';

/**
 * Finance & Payroll onboarding step — self-contained so it works standalone at
 * /dashboard/finance-setup AND can be dropped into the (separately-built)
 * onboarding wizard: `<FinanceHrSetupStep onDone={next} />`. It talks only to the
 * finance-setup API, so it never touches the shared settings module.
 */

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Panel, Field, ErrorBanner, Spinner, fmtIDR } from '@/components/dashboard/ui';

interface Settings {
  payrollWorkingDays: number; payrollPayDay: number; autoRunPayroll: boolean; autoCloseBooks: boolean;
  taxEnabled: boolean; taxRate: number; openingBalancesPosted: boolean; provisionedAt: string | null;
}
interface Status {
  settings: Settings;
  checklist: { chartOfAccounts: boolean; openingBalances: boolean; employeesAdded: boolean; payrollRun: boolean; provisioned: boolean };
  counts: { accounts: number; activeEmployees: number; finalizedPayrollRuns: number };
}

export function FinanceHrSetupStep({ onDone }: { onDone?: () => void }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [opening, setOpening] = useState({ cash: '', bank: '', inventory: '' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const s = await api.get<Status>('/finance-setup/status');
      setStatus(s); setForm(s.settings); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load setup'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveSettings = async () => {
    if (!form) return;
    setBusy('save'); setError(''); setMsg('');
    try {
      await api.put('/finance-setup', {
        payrollWorkingDays: form.payrollWorkingDays, payrollPayDay: form.payrollPayDay,
        taxEnabled: form.taxEnabled, taxRate: form.taxRate,
        autoRunPayroll: form.autoRunPayroll, autoCloseBooks: form.autoCloseBooks,
      });
      setMsg(t('setup.saved', 'Settings saved.')); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); } finally { setBusy(''); }
  };

  const provision = async () => {
    setBusy('provision'); setError(''); setMsg('');
    try {
      const ob = { cash: Number(opening.cash) || undefined, bank: Number(opening.bank) || undefined, inventory: Number(opening.inventory) || undefined };
      const r = await api.post<{ seededAccounts: number; openingBalances: { posted: boolean; total: number }; synced: Record<string, number> }>('/finance-setup/provision', { openingBalances: ob });
      const syncedTotal = Object.values(r.synced || {}).reduce((s, n) => s + (n || 0), 0);
      setMsg(t('setup.provisioned', 'Books ready. {a} accounts, opening {o}, {n} historical entries posted.')
        .replace('{a}', String(r.seededAccounts))
        .replace('{o}', r.openingBalances?.posted ? fmtIDR(r.openingBalances.total) : t('setup.none', 'none'))
        .replace('{n}', String(syncedTotal)));
      await load();
      onDone?.();
    } catch (e) { setError(e instanceof Error ? e.message : 'Provision failed'); } finally { setBusy(''); }
  };

  if (!form || !status) return <div className="card flex items-center gap-2 text-sm text-text-muted"><Spinner /> {t('common.loading', 'Loading…')}</div>;

  const check = (ok: boolean, label: string) => (
    <div className="flex items-center gap-2 text-sm">
      <span className={ok ? 'text-green-600' : 'text-text-muted'}>{ok ? '✓' : '○'}</span>
      <span className={ok ? 'text-text-primary' : 'text-text-secondary'}>{label}</span>
    </div>
  );

  return (
    <div className="space-y-6">
      <ErrorBanner message={error} onDismiss={() => setError('')} />
      {msg && <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{msg}</div>}

      <Panel title={t('setup.checklist', 'Setup checklist')} description={t('setup.checklistDesc', 'Everything below runs automatically once set — no accountant needed.')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {check(status.checklist.chartOfAccounts, `${t('setup.coa', 'Chart of accounts')} (${status.counts.accounts})`)}
          {check(status.checklist.openingBalances, t('setup.opening', 'Opening balances recorded'))}
          {check(status.checklist.employeesAdded, `${t('setup.employees', 'Employees added')} (${status.counts.activeEmployees})`)}
          {check(status.checklist.payrollRun, `${t('setup.payroll', 'Payroll run')} (${status.counts.finalizedPayrollRuns})`)}
          {check(status.checklist.provisioned, t('setup.provisionedCheck', 'Bookkeeping provisioned'))}
        </div>
      </Panel>

      <Panel
        title={t('setup.oneClick', 'One-click setup')}
        description={t('setup.oneClickDesc', 'Seed the chart of accounts, record your starting balances, and post any existing sales/expenses/payroll into the ledger — all at once.')}
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label={t('setup.cash', 'Cash on hand (Rp)')}><input className="input-field" type="number" min="0" value={opening.cash} onChange={(e) => setOpening({ ...opening, cash: e.target.value })} placeholder="0" /></Field>
          <Field label={t('setup.bank', 'Bank balance (Rp)')}><input className="input-field" type="number" min="0" value={opening.bank} onChange={(e) => setOpening({ ...opening, bank: e.target.value })} placeholder="0" /></Field>
          <Field label={t('setup.inventory', 'Inventory value (Rp)')}><input className="input-field" type="number" min="0" value={opening.inventory} onChange={(e) => setOpening({ ...opening, inventory: e.target.value })} placeholder="0" /></Field>
        </div>
        <p className="mt-2 text-xs text-text-muted">{status.settings.openingBalancesPosted ? t('setup.openingDone', 'Opening balances already recorded — re-running won’t double-post them.') : t('setup.openingHint', 'Enter what your business currently holds; this becomes your starting equity. Optional.')}</p>
        <button className="btn-primary mt-4" onClick={provision} disabled={busy === 'provision'}>
          {busy === 'provision' ? <Spinner /> : t('setup.runSetup', 'Run one-click setup')}
        </button>
      </Panel>

      <Panel title={t('setup.defaults', 'Payroll & tax defaults')} description={t('setup.defaultsDesc', 'The system uses these so payroll and bookkeeping run without manual input each time.')}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label={t('setup.workingDays', 'Working days / month')}><input className="input-field" type="number" min="1" max="31" value={form.payrollWorkingDays} onChange={(e) => setForm({ ...form, payrollWorkingDays: Number(e.target.value) })} /></Field>
          <Field label={t('setup.payDay', 'Pay day')}><input className="input-field" type="number" min="1" max="28" value={form.payrollPayDay} onChange={(e) => setForm({ ...form, payrollPayDay: Number(e.target.value) })} /></Field>
          <label className="flex items-center gap-2 pb-2.5 text-sm text-text-secondary self-end"><input type="checkbox" checked={form.taxEnabled} onChange={(e) => setForm({ ...form, taxEnabled: e.target.checked })} />{t('setup.taxEnabled', 'Charge PPN')}</label>
          <Field label={t('setup.taxRate', 'PPN rate (%)')}><input className="input-field" type="number" min="0" step="0.5" value={form.taxRate} disabled={!form.taxEnabled} onChange={(e) => setForm({ ...form, taxRate: Number(e.target.value) })} /></Field>
        </div>
        <div className="mt-3 space-y-2 rounded-lg border border-border bg-surface-sunken/40 p-3">
          <p className="text-sm font-medium text-text-primary">{t('setup.automation', 'Automation (for teams without finance staff)')}</p>
          <label className="flex items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={form.autoRunPayroll} onChange={(e) => setForm({ ...form, autoRunPayroll: e.target.checked })} />{t('setup.autoPayroll', 'Automatically run & finalize payroll on pay day')}</label>
          <label className="flex items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={form.autoCloseBooks} onChange={(e) => setForm({ ...form, autoCloseBooks: e.target.checked })} />{t('setup.autoClose', 'Automatically close the previous month’s books')}</label>
        </div>
        <button className="btn-secondary mt-4" onClick={saveSettings} disabled={busy === 'save'}>{busy === 'save' ? <Spinner /> : t('common.save', 'Save settings')}</button>
      </Panel>
    </div>
  );
}
