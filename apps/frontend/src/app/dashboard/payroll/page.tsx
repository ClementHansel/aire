'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import {
  PageHeader, StatCard, Panel, ErrorBanner, Modal, Field, StatusBadge, Tabs, SearchSelect,
  TableWrap, EmptyRow, TableSkeleton, thCls, tdCls, fmtIDR, Spinner,
} from '@/components/dashboard/ui';

interface Employee { id: string; name: string; }
interface Adjustment { id: string; employee: string; employeeId: string; type: string; amount: number; period: string; reason: string | null; status: string; recurring: boolean; totalPeriods: number | null; appliedCount: number; }
interface Loan { id: string; employee: string; employeeId: string; principal: number; balance: number; monthlyInstallment: number; reason: string | null; status: string; }
interface Run { id: string; period: string; status: string; workingDays: number; employeeCount: number; totalGross: number; totalNet: number; }
interface Payslip { id: string; employeeName: string; baseSalary: number; scheduledDays: number; daysWorked: number; unpaidLeaveDays: number; bonusTotal: number; deductionTotal: number; advanceTotal: number; loanRepaymentTotal: number; unpaidLeaveDeduction: number; grossPay: number; netPay: number; }
interface RunDetail extends Run { payslips: Payslip[]; }
interface EmpPayslip { id: string; period: string; runStatus: string; baseSalary: number; bonusTotal: number; deductionTotal: number; advanceTotal: number; loanRepaymentTotal: number; unpaidLeaveDeduction: number; grossPay: number; netPay: number; }

const thisPeriod = () => new Date().toISOString().slice(0, 7);
type Mode = 'employee' | 'runs';

export default function PayrollPage() {
  const { t } = useI18n();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<Mode>('employee');
  const [employeeId, setEmployeeId] = useState('');

  const loadBase = useCallback(async () => {
    setLoading(true);
    try {
      const [e, r] = await Promise.all([api.get<Employee[]>('/hr/employees'), api.get<Run[]>('/payroll/runs')]);
      setEmployees(e); setRuns(r); setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dash.payroll.loadFailed', 'Failed to load payroll data'));
    } finally { setLoading(false); }
  }, [t]);
  useEffect(() => { loadBase(); }, [loadBase]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title={t('dash.payroll.title', 'Payroll')}
        subtitle={t('dash.payroll.subtitle', 'Manage each employee’s bonuses, deductions and loans, then generate monthly payslips. Recurring items auto-apply every run until they finish.')}
        actions={
          <Tabs
            tabs={[{ id: 'employee', label: t('dash.payroll.byEmployee', 'By employee') }, { id: 'runs', label: t('dash.payroll.runsMode', 'Payroll runs') }]}
            active={mode}
            onChange={setMode}
          />
        }
      />
      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {mode === 'employee' ? (
        <>
          <Panel title={t('dash.payroll.selectEmployee', 'Select employee')}>
            <div className="max-w-md">
              <SearchSelect
                items={employees.map((e) => ({ id: e.id, label: e.name }))}
                value={employeeId}
                onChange={setEmployeeId}
                placeholder={t('dash.payroll.searchEmployee', 'Search employee by name…')}
                ariaLabel={t('dash.payroll.selectEmployee', 'Select employee')}
              />
            </div>
          </Panel>
          {employeeId
            ? <EmployeePayroll key={employeeId} employeeId={employeeId} employeeName={employees.find((e) => e.id === employeeId)?.name ?? ''} onError={setError} />
            : <div className="card text-center text-sm text-text-muted">{t('dash.payroll.pickEmployeePrompt', 'Search and pick an employee to view and manage their payroll.')}</div>}
        </>
      ) : (
        <RunsMode runs={runs} loading={loading} reloadRuns={loadBase} onError={setError} />
      )}
    </div>
  );
}

/* ── Per-employee view ──────────────────────────────────────────────── */

function EmployeePayroll({ employeeId, employeeName, onError }: { employeeId: string; employeeName: string; onError: (m: string) => void }) {
  const { t } = useI18n();
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [payslips, setPayslips] = useState<EmpPayslip[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [repayLoan, setRepayLoan] = useState<Loan | null>(null);

  const [adjForm, setAdjForm] = useState({ type: 'bonus', amount: '', period: thisPeriod(), reason: '', recurring: false, totalPeriods: '3' });
  const [loanForm, setLoanForm] = useState({ principal: '', monthlyInstallment: '', reason: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, l, detail] = await Promise.all([
        api.get<Adjustment[]>(`/payroll/adjustments?employeeId=${employeeId}`),
        api.get<Loan[]>(`/payroll/loans?employeeId=${employeeId}`),
        api.get<{ payslips: EmpPayslip[] }>(`/hr/employees/${employeeId}`),
      ]);
      setAdjustments(a); setLoans(l); setPayslips(detail.payslips ?? []);
    } catch (e) { onError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [employeeId, onError]);
  useEffect(() => { load(); }, [load]);

  const wrap = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); await load(); } catch (e) { onError(e instanceof Error ? e.message : 'Action failed'); } finally { setBusy(false); }
  };
  const addAdjustment = () => Number(adjForm.amount) > 0 && wrap(async () => {
    await api.post('/payroll/adjustments', {
      employeeId, type: adjForm.type, amount: Number(adjForm.amount), period: adjForm.period,
      reason: adjForm.reason || undefined,
      recurring: adjForm.recurring,
      totalPeriods: adjForm.recurring ? Number(adjForm.totalPeriods) || 1 : undefined,
    });
    setAdjForm({ ...adjForm, amount: '', reason: '' });
  });
  const createLoan = () => Number(loanForm.principal) > 0 && Number(loanForm.monthlyInstallment) > 0 && wrap(async () => {
    await api.post('/payroll/loans', { employeeId, principal: Number(loanForm.principal), monthlyInstallment: Number(loanForm.monthlyInstallment), reason: loanForm.reason || undefined });
    setLoanForm({ principal: '', monthlyInstallment: '', reason: '' });
  });

  const activeLoanBalance = loans.filter((l) => l.status === 'active').reduce((s, l) => s + l.balance, 0);
  const recurringCount = adjustments.filter((a) => a.recurring && a.status === 'active').length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard loading={loading} label={t('dash.payroll.latestNet', 'Latest net')} value={fmtIDR(payslips[0]?.netPay)} tone="primary" hint={payslips[0]?.period} />
        <StatCard loading={loading} label={t('dash.payroll.openLoans', 'Outstanding loans')} value={fmtIDR(activeLoanBalance)} tone={activeLoanBalance > 0 ? 'warning' : 'default'} />
        <StatCard loading={loading} label={t('dash.payroll.recurringActive', 'Active recurring')} value={recurringCount} />
        <StatCard loading={loading} label={t('dash.payroll.payslipsCount', 'Payslips')} value={payslips.length} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Adjustments */}
        <Panel title={`${t('dash.payroll.adjustments', 'Adjustments')} — ${employeeName}`} description={t('dash.payroll.adjustmentDesc', 'Bonus, deduction or advance. Make it recurring to auto-apply for N months.')}>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('dash.payroll.type', 'Type')}>
              <select className="input-field" value={adjForm.type} onChange={(e) => setAdjForm({ ...adjForm, type: e.target.value })}>
                <option value="bonus">{t('dash.payroll.bonus', 'Bonus')}</option>
                <option value="deduction">{t('dash.payroll.deduction', 'Deduction')}</option>
                <option value="advance">{t('dash.payroll.advance', 'Advance')}</option>
              </select>
            </Field>
            <Field label={t('dash.payroll.amount', 'Amount (Rp)')}><input className="input-field" type="number" min="1" value={adjForm.amount} onChange={(e) => setAdjForm({ ...adjForm, amount: e.target.value })} /></Field>
            <Field label={adjForm.recurring ? t('dash.payroll.startPeriod', 'Start period') : t('dash.payroll.period', 'Period')}><input className="input-field" type="month" value={adjForm.period} onChange={(e) => setAdjForm({ ...adjForm, period: e.target.value })} /></Field>
            <Field label={t('dash.payroll.reason', 'Reason')}><input className="input-field" value={adjForm.reason} onChange={(e) => setAdjForm({ ...adjForm, reason: e.target.value })} /></Field>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-sm text-text-secondary">
              <input type="checkbox" checked={adjForm.recurring} onChange={(e) => setAdjForm({ ...adjForm, recurring: e.target.checked })} />
              {t('dash.payroll.recurring', 'Recurring')}
            </label>
            {adjForm.recurring && (
              <label className="flex items-center gap-1.5 text-sm text-text-secondary">
                {t('dash.payroll.forMonths', 'for')}
                <input className="input-field w-20 py-1" type="number" min="1" value={adjForm.totalPeriods} onChange={(e) => setAdjForm({ ...adjForm, totalPeriods: e.target.value })} />
                {t('dash.payroll.months', 'months')}
              </label>
            )}
            <button className="btn-secondary ml-auto" onClick={addAdjustment} disabled={busy || !(Number(adjForm.amount) > 0)}>{t('dash.payroll.add', 'Add')}</button>
          </div>
          <div className="mt-4 max-h-64 overflow-auto rounded-lg border border-border">
            <TableWrap>
              <thead><tr className="border-b border-border bg-surface-sunken/50">
                <th className={`${thCls} text-left`}>{t('dash.payroll.type', 'Type')}</th>
                <th className={`${thCls} text-right`}>{t('dash.payroll.amount', 'Amount')}</th>
                <th className={`${thCls} text-left`}>{t('dash.payroll.recurrence', 'Recurrence')}</th>
                <th className={`${thCls} text-left`}>{t('dash.hr.status', 'Status')}</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {loading ? null : adjustments.length === 0 ? <EmptyRow colSpan={4}>{t('dash.payroll.noAdjustments', 'No adjustments yet.')}</EmptyRow> : adjustments.map((a) => (
                  <tr key={a.id}>
                    <td className={`${tdCls} capitalize`}>{a.type}{a.reason ? <span className="block text-xs text-text-muted">{a.reason}</span> : null}</td>
                    <td className={`${tdCls} text-right tabular-nums ${a.type === 'bonus' ? 'text-green-600' : 'text-rose-600'}`}>{fmtIDR(a.amount)}</td>
                    <td className={`${tdCls} text-text-secondary`}>{a.recurring ? `${a.appliedCount}/${a.totalPeriods ?? '∞'} · ${t('dash.payroll.fromLabel', 'from')} ${a.period}` : `${t('dash.payroll.oneOff', 'One-off')} · ${a.period}`}</td>
                    <td className={tdCls}><StatusBadge status={a.status} /></td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
        </Panel>

        {/* Loans */}
        <Panel title={`${t('dash.payroll.loans', 'Loans')} — ${employeeName}`} description={t('dash.payroll.loansDesc', 'Installments auto-deduct every payroll run until paid up.')}>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('dash.payroll.principal', 'Principal (Rp)')}><input className="input-field" type="number" min="1" value={loanForm.principal} onChange={(e) => setLoanForm({ ...loanForm, principal: e.target.value })} /></Field>
            <Field label={t('dash.payroll.installment', 'Monthly installment')}><input className="input-field" type="number" min="1" value={loanForm.monthlyInstallment} onChange={(e) => setLoanForm({ ...loanForm, monthlyInstallment: e.target.value })} /></Field>
            <div className="col-span-2"><Field label={t('dash.payroll.reason', 'Reason')}><input className="input-field" value={loanForm.reason} onChange={(e) => setLoanForm({ ...loanForm, reason: e.target.value })} /></Field></div>
          </div>
          <button className="btn-secondary mt-3 w-full" onClick={createLoan} disabled={busy || !(Number(loanForm.principal) > 0) || !(Number(loanForm.monthlyInstallment) > 0)}>{t('dash.payroll.createLoan', 'Create loan')}</button>
          <div className="mt-4 max-h-64 overflow-auto rounded-lg border border-border">
            <TableWrap>
              <thead><tr className="border-b border-border bg-surface-sunken/50">
                <th className={`${thCls} text-left`}>{t('dash.payroll.reason', 'Reason')}</th>
                <th className={`${thCls} text-right`}>{t('dash.payroll.balAbbr', 'Balance')}</th>
                <th className={`${thCls} text-right`}>{t('dash.payroll.installment', 'Installment')}</th>
                <th className={`${thCls} text-right`}>{t('dash.hr.action', 'Action')}</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {loading ? null : loans.length === 0 ? <EmptyRow colSpan={4}>{t('dash.payroll.noLoans', 'No loans.')}</EmptyRow> : loans.map((l) => (
                  <tr key={l.id}>
                    <td className={tdCls}>{l.reason || '—'} <StatusBadge status={l.status} /></td>
                    <td className={`${tdCls} text-right font-medium tabular-nums`}>{fmtIDR(l.balance)}<span className="block text-xs text-text-muted">/ {fmtIDR(l.principal)}</span></td>
                    <td className={`${tdCls} text-right tabular-nums text-text-secondary`}>{fmtIDR(l.monthlyInstallment)}</td>
                    <td className={`${tdCls} text-right`}>{l.status === 'active' && <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setRepayLoan(l)}>{t('dash.payroll.repay', 'Repay')}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
        </Panel>
      </div>

      {/* Payslip history */}
      <Panel title={t('dash.payroll.payslipHistory', 'Payslip history')} bodyClassName="p-0">
        {loading ? <TableSkeleton rows={5} cols={6} /> : (
          <TableWrap>
            <thead><tr className="border-b border-border bg-surface-sunken/50">
              <th className={`${thCls} text-left`}>{t('dash.payroll.period', 'Period')}</th>
              <th className={`${thCls} text-left`}>{t('dash.hr.status', 'Status')}</th>
              <th className={`${thCls} text-right`}>{t('dash.payroll.colBase', 'Base')}</th>
              <th className={`${thCls} text-right`}>{t('dash.payroll.colBonus', 'Bonus')}</th>
              <th className={`${thCls} text-right`}>{t('dash.payroll.deductions', 'Deductions')}</th>
              <th className={`${thCls} text-right`}>{t('dash.payroll.colNet', 'Net')}</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {payslips.length === 0 ? <EmptyRow colSpan={6}>{t('dash.payroll.noPayslips', 'No payslips yet. Generate a payroll run from the Payroll runs tab.')}</EmptyRow> : payslips.map((p) => (
                <tr key={p.id} className="hover:bg-surface-sunken/40">
                  <td className={`${tdCls} font-medium`}>{p.period}</td>
                  <td className={tdCls}><StatusBadge status={p.runStatus} /></td>
                  <td className={`${tdCls} text-right tabular-nums`}>{fmtIDR(p.baseSalary)}</td>
                  <td className={`${tdCls} text-right tabular-nums text-green-600`}>{p.bonusTotal ? fmtIDR(p.bonusTotal) : '—'}</td>
                  <td className={`${tdCls} text-right tabular-nums text-rose-600`}>{fmtIDR(p.deductionTotal + p.advanceTotal + p.loanRepaymentTotal + p.unpaidLeaveDeduction)}</td>
                  <td className={`${tdCls} text-right tabular-nums font-semibold`}>{fmtIDR(p.netPay)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      {repayLoan && <RepayModal loan={repayLoan} onClose={() => setRepayLoan(null)} onDone={() => { setRepayLoan(null); load(); }} />}
    </div>
  );
}

/* ── Runs mode (company-wide) ───────────────────────────────────────── */

function RunsMode({ runs, loading, reloadRuns, onError }: { runs: Run[]; loading: boolean; reloadRuns: () => Promise<void>; onError: (m: string) => void }) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [genPeriod, setGenPeriod] = useState(thisPeriod());
  const [workingDays, setWorkingDays] = useState('26');
  const [confirmGen, setConfirmGen] = useState(false);

  const draftRun = runs.find((r) => r.status === 'draft');
  const wrap = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); await reloadRuns(); } catch (e) { onError(e instanceof Error ? e.message : 'Action failed'); } finally { setBusy(false); }
  };
  const generate = () => { setConfirmGen(false); wrap(async () => { const run = await api.post<RunDetail>('/payroll/generate', { period: genPeriod, workingDays: Number(workingDays) || 26 }); setDetail(run); }); };
  const runOneClick = () => wrap(async () => { const run = await api.post<RunDetail>('/payroll/run', { period: genPeriod }); setDetail(run); });
  const viewRun = async (id: string) => { try { setDetail(await api.get<RunDetail>(`/payroll/runs/${id}`)); } catch (e) { onError(e instanceof Error ? e.message : 'Failed'); } };
  const finalize = (id: string) => wrap(async () => { await api.post(`/payroll/runs/${id}/finalize`); if (detail?.id === id) await viewRun(id); });
  const exportRun = (id: string, period: string) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('aire_access_token') : null;
    const base = process.env.NEXT_PUBLIC_API_URL || '/api';
    fetch(`${base}/payroll/runs/${id}/export`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.blob())
      .then((blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `payroll-${period}.csv`; a.click(); URL.revokeObjectURL(a.href); })
      .catch(() => onError(t('dash.payroll.exportFailed', 'Export failed')));
  };

  return (
    <div className="space-y-6">
      <Panel title={t('dash.payroll.generatePayroll', 'Generate payroll')} description={t('dash.payroll.generateHint', 'Rolls base salary + bonuses − deductions − advances − loan installments − unpaid leave into payslips. Recurring items auto-apply. Regenerating a draft reverses and recomputes.')}>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('dash.payroll.period', 'Period')}><input className="input-field" type="month" value={genPeriod} onChange={(e) => setGenPeriod(e.target.value)} /></Field>
          <Field label={t('dash.payroll.workingDays', 'Working days')}><input className="input-field w-28" type="number" min="1" value={workingDays} onChange={(e) => setWorkingDays(e.target.value)} /></Field>
          <button className="btn-primary" onClick={runOneClick} disabled={busy} title={t('dash.payroll.runNowHint', 'Generate and finalize in one step using your default working days')}>{busy ? <Spinner /> : `▶ ${t('dash.payroll.runNow', 'Run payroll now')}`}</button>
          <button className="btn-secondary" onClick={() => setConfirmGen(true)} disabled={busy}>{t('dash.payroll.generateRegenerate', 'Generate draft')}</button>
          {draftRun && <span className="pb-2.5 text-xs text-amber-600">{t('dash.payroll.draftExists', 'A draft run exists — regenerating replaces it.')}</span>}
        </div>
      </Panel>

      <Panel title={t('dash.payroll.payrollRuns', 'Payroll runs')} bodyClassName="p-0">
        {loading ? <TableSkeleton rows={4} cols={6} /> : (
          <TableWrap>
            <thead><tr className="border-b border-border bg-surface-sunken/50">
              <th className={`${thCls} text-left`}>{t('dash.payroll.period', 'Period')}</th>
              <th className={`${thCls} text-left`}>{t('dash.hr.status', 'Status')}</th>
              <th className={`${thCls} text-right`}>{t('dash.payroll.staff', 'Staff')}</th>
              <th className={`${thCls} text-right`}>{t('dash.payroll.gross', 'Gross')}</th>
              <th className={`${thCls} text-right`}>{t('dash.payroll.net', 'Net')}</th>
              <th className={`${thCls} text-right`}>{t('dash.hr.action', 'Action')}</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {runs.length === 0 ? <EmptyRow colSpan={6}>{t('dash.payroll.noRuns', 'No payroll runs yet. Generate one above.')}</EmptyRow> : runs.map((r) => (
                <tr key={r.id} className={`hover:bg-surface-sunken/40 ${detail?.id === r.id ? 'bg-surface-sunken/40' : ''}`}>
                  <td className={`${tdCls} font-medium`}>{r.period}</td>
                  <td className={tdCls}><StatusBadge status={r.status} /></td>
                  <td className={`${tdCls} text-right tabular-nums`}>{r.employeeCount}</td>
                  <td className={`${tdCls} text-right tabular-nums text-text-secondary`}>{fmtIDR(r.totalGross)}</td>
                  <td className={`${tdCls} text-right font-medium tabular-nums`}>{fmtIDR(r.totalNet)}</td>
                  <td className={`${tdCls} text-right`}>
                    <span className="inline-flex gap-1">
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => viewRun(r.id)}>{t('dash.payroll.view', 'View')}</button>
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => exportRun(r.id, r.period)}>{t('dash.payroll.export', 'Export')}</button>
                      {r.status === 'draft' && <button className="btn-ghost px-2 py-1 text-xs text-green-600" disabled={busy} onClick={() => finalize(r.id)}>{t('dash.payroll.finalize', 'Finalize')}</button>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      {detail && (
        <Panel
          title={`${t('dash.payroll.payslips', 'Payslips')} — ${detail.period}`}
          description={`${detail.employeeCount} ${t('dash.payroll.staff', 'staff')} · ${detail.workingDays} ${t('dash.payroll.workingDaysLower', 'working days')}`}
          bodyClassName="p-0"
          actions={
            <>
              <StatusBadge status={detail.status} />
              <button className="btn-secondary py-1.5 text-xs" onClick={() => exportRun(detail.id, detail.period)}>{t('dash.payroll.exportCsv', 'Export CSV')}</button>
              {detail.status === 'draft' && <button className="btn-primary py-1.5 text-xs" disabled={busy} onClick={() => finalize(detail.id)}>{t('dash.payroll.finalize', 'Finalize')}</button>}
            </>
          }
        >
          <TableWrap>
            <thead><tr className="border-b border-border bg-surface-sunken/50">
              <th className={`${thCls} text-left`}>{t('dash.payroll.colEmployee', 'Employee')}</th>
              <th className={`${thCls} text-right`}>{t('dash.payroll.colDays', 'Days')}</th>
              <th className={`${thCls} text-right`}>{t('dash.payroll.colBase', 'Base')}</th>
              <th className={`${thCls} text-right`}>{t('dash.payroll.colBonus', 'Bonus')}</th>
              <th className={`${thCls} text-right`}>{t('dash.payroll.colDeduct', 'Deduct')}</th>
              <th className={`${thCls} text-right`}>{t('dash.payroll.colLoan', 'Loan')}</th>
              <th className={`${thCls} text-right`}>{t('dash.payroll.colGross', 'Gross')}</th>
              <th className={`${thCls} text-right`}>{t('dash.payroll.colNet', 'Net')}</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {detail.payslips.map((p) => (
                <tr key={p.id} className="hover:bg-surface-sunken/40">
                  <td className={`${tdCls} font-medium`}>{p.employeeName}</td>
                  <td className={`${tdCls} text-right tabular-nums text-text-secondary`}>{p.daysWorked}/{p.scheduledDays}</td>
                  <td className={`${tdCls} text-right tabular-nums`}>{fmtIDR(p.baseSalary)}</td>
                  <td className={`${tdCls} text-right tabular-nums text-green-600`}>{p.bonusTotal ? fmtIDR(p.bonusTotal) : '—'}</td>
                  <td className={`${tdCls} text-right tabular-nums text-rose-600`}>{p.deductionTotal ? fmtIDR(p.deductionTotal) : '—'}</td>
                  <td className={`${tdCls} text-right tabular-nums text-rose-600`}>{p.loanRepaymentTotal ? fmtIDR(p.loanRepaymentTotal) : '—'}</td>
                  <td className={`${tdCls} text-right tabular-nums text-text-secondary`}>{fmtIDR(p.grossPay)}</td>
                  <td className={`${tdCls} text-right tabular-nums font-semibold`}>{fmtIDR(p.netPay)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-surface-sunken/40">
                <td className={`${tdCls} font-semibold`} colSpan={6}>{t('dash.payroll.total', 'Total')}</td>
                <td className={`${tdCls} text-right font-semibold tabular-nums`}>{fmtIDR(detail.totalGross)}</td>
                <td className={`${tdCls} text-right font-semibold tabular-nums`}>{fmtIDR(detail.totalNet)}</td>
              </tr>
            </tfoot>
          </TableWrap>
        </Panel>
      )}

      {confirmGen && (
        <Modal
          title={t('dash.payroll.generatePayroll', 'Generate payroll')}
          onClose={() => setConfirmGen(false)}
          footer={<><button className="btn-secondary" onClick={() => setConfirmGen(false)}>{t('common.cancel', 'Cancel')}</button><button className="btn-primary" onClick={generate}>{t('dash.payroll.confirmGenerate', 'Generate')}</button></>}
        >
          <p className="text-sm text-text-secondary">
            {draftRun
              ? t('dash.payroll.regenWarn', 'This will reverse the existing draft run and recompute payslips for')
              : t('dash.payroll.genWarn', 'This will compute payslips for all active staff for')}{' '}
            <span className="font-semibold text-text-primary">{genPeriod}</span> ({workingDays} {t('dash.payroll.workingDaysLower', 'working days')}).
          </p>
        </Modal>
      )}
    </div>
  );
}

function RepayModal({ loan, onClose, onDone }: { loan: Loan; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [amount, setAmount] = useState(String(Math.min(loan.monthlyInstallment, loan.balance) || ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const amt = Number(amount);
    if (!(amt > 0)) { setError(t('dash.payroll.amountPositive', 'Enter a positive amount.')); return; }
    setBusy(true); setError('');
    try { await api.post(`/payroll/loans/${loan.id}/repay`, { amount: amt }); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : t('dash.payroll.actionFailed', 'Action failed')); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      title={t('dash.payroll.recordRepayment', 'Record repayment')}
      onClose={onClose}
      footer={<><button type="button" className="btn-secondary" onClick={onClose}>{t('common.cancel', 'Cancel')}</button><button type="submit" form="repay-form" className="btn-primary" disabled={busy}>{busy ? <Spinner /> : t('dash.payroll.repay', 'Repay')}</button></>}
    >
      <form id="repay-form" onSubmit={submit} className="space-y-4">
        <ErrorBanner message={error} />
        <div className="rounded-lg border border-border bg-surface-sunken/40 p-4 text-sm">
          <div className="flex justify-between"><span className="text-text-secondary">{loan.employee}</span></div>
          <div className="mt-1 flex justify-between"><span className="text-text-secondary">{t('dash.payroll.balance', 'Outstanding balance')}</span><span className="font-semibold text-text-primary">{fmtIDR(loan.balance)}</span></div>
        </div>
        <Field label={t('dash.payroll.repaymentAmount', 'Repayment amount (Rp)')} hint={t('dash.payroll.repaymentHint', 'Capped at the outstanding balance.')}>
          <input className="input-field" type="number" min="1" max={loan.balance} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
      </form>
    </Modal>
  );
}
