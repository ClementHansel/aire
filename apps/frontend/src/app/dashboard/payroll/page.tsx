'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

interface Employee { id: string; name: string; }
interface Adjustment { id: string; employee: string; type: string; amount: number; period: string; status: string; }
interface Loan { id: string; employee: string; principal: number; balance: number; monthlyInstallment: number; status: string; }
interface Run { id: string; period: string; status: string; employeeCount: number; totalGross: number; totalNet: number; }
interface Payslip { id: string; employeeName: string; baseSalary: number; bonusTotal: number; deductionTotal: number; advanceTotal: number; loanRepaymentTotal: number; unpaidLeaveDeduction: number; grossPay: number; netPay: number; }
interface RunDetail extends Run { workingDays: number; payslips: Payslip[]; }

const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
const thisPeriod = () => new Date().toISOString().slice(0, 7);

export default function PayrollPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [adjForm, setAdjForm] = useState({ employeeId: '', type: 'bonus', amount: '', period: thisPeriod(), reason: '' });
  const [loanForm, setLoanForm] = useState({ employeeId: '', principal: '', monthlyInstallment: '', reason: '' });
  const [genPeriod, setGenPeriod] = useState(thisPeriod());
  const [workingDays, setWorkingDays] = useState('26');

  const load = useCallback(async () => {
    try {
      const [e, a, l, r] = await Promise.all([
        api.get<Employee[]>('/hr/employees'),
        api.get<Adjustment[]>('/payroll/adjustments'),
        api.get<Loan[]>('/payroll/loans'),
        api.get<Run[]>('/payroll/runs'),
      ]);
      setEmployees(e); setAdjustments(a); setLoans(l); setRuns(r); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const wrap = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); } finally { setBusy(false); }
  };

  const addAdjustment = () => adjForm.employeeId && Number(adjForm.amount) && wrap(async () => {
    await api.post('/payroll/adjustments', { employeeId: adjForm.employeeId, type: adjForm.type, amount: Number(adjForm.amount), period: adjForm.period, reason: adjForm.reason || undefined });
    setAdjForm({ ...adjForm, amount: '', reason: '' });
  });
  const createLoan = () => loanForm.employeeId && Number(loanForm.principal) && Number(loanForm.monthlyInstallment) && wrap(async () => {
    await api.post('/payroll/loans', { employeeId: loanForm.employeeId, principal: Number(loanForm.principal), monthlyInstallment: Number(loanForm.monthlyInstallment), reason: loanForm.reason || undefined });
    setLoanForm({ employeeId: '', principal: '', monthlyInstallment: '', reason: '' });
  });
  const repay = (id: string) => {
    const amt = window.prompt('Repayment amount?'); if (!amt) return;
    wrap(() => api.post(`/payroll/loans/${id}/repay`, { amount: Number(amt) }));
  };
  const generate = () => wrap(async () => {
    const run = await api.post<RunDetail>('/payroll/generate', { period: genPeriod, workingDays: Number(workingDays) || 26 });
    setDetail(run);
  });
  const viewRun = async (id: string) => { try { setDetail(await api.get<RunDetail>(`/payroll/runs/${id}`)); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } };
  const finalize = (id: string) => wrap(async () => { await api.post(`/payroll/runs/${id}/finalize`); if (detail?.id === id) await viewRun(id); });
  const exportRun = (id: string) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('aire_access_token') : null;
    const base = process.env.NEXT_PUBLIC_API_URL || '/api';
    fetch(`${base}/payroll/runs/${id}/export`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.blob()).then((blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `payroll-${id}.csv`; a.click(); URL.revokeObjectURL(a.href); })
      .catch(() => setError('Export failed'));
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <h1 className="text-xl font-semibold text-text-primary">Payroll</h1>
      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      {/* Generate */}
      <div className="card">
        <h2 className="section-title mb-3">Generate payroll</h2>
        <div className="flex flex-wrap gap-2 items-end">
          <div><label className="block text-xs text-text-secondary mb-1">Period</label><input className="input-field" type="month" value={genPeriod} onChange={(e) => setGenPeriod(e.target.value)} /></div>
          <div><label className="block text-xs text-text-secondary mb-1">Working days</label><input className="input-field w-28" type="number" value={workingDays} onChange={(e) => setWorkingDays(e.target.value)} /></div>
          <button className="btn-primary" onClick={generate} disabled={busy}>{busy ? 'Working…' : 'Generate / Regenerate'}</button>
        </div>
        <p className="text-xs text-text-muted mt-2">Rolls base salary + bonuses − deductions − advances − loan installments − unpaid leave into payslips. Regenerating a draft reverses and recomputes.</p>
      </div>

      {/* Adjustments + Loans */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="section-title mb-3">Add adjustment (bonus / deduction / advance)</h2>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <select className="input-field" value={adjForm.employeeId} onChange={(e) => setAdjForm({ ...adjForm, employeeId: e.target.value })}><option value="">Employee *</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
            <select className="input-field" value={adjForm.type} onChange={(e) => setAdjForm({ ...adjForm, type: e.target.value })}><option value="bonus">Bonus</option><option value="deduction">Deduction</option><option value="advance">Advance</option></select>
            <input className="input-field" type="number" placeholder="Amount *" value={adjForm.amount} onChange={(e) => setAdjForm({ ...adjForm, amount: e.target.value })} />
            <input className="input-field" type="month" value={adjForm.period} onChange={(e) => setAdjForm({ ...adjForm, period: e.target.value })} />
          </div>
          <button className="btn-secondary w-full" onClick={addAdjustment}>Add</button>
          <div className="mt-3 space-y-1 max-h-40 overflow-auto">
            {adjustments.map((a) => (
              <div key={a.id} className="flex justify-between text-xs border-b border-border py-1">
                <span>{a.employee} · <span className="capitalize">{a.type}</span> · {a.period}</span>
                <span className={`${a.type === 'bonus' ? 'text-green-600' : 'text-red-600'}`}>{fmt(a.amount)} <span className="text-text-muted">({a.status})</span></span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h2 className="section-title mb-3">Loans</h2>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <select className="input-field" value={loanForm.employeeId} onChange={(e) => setLoanForm({ ...loanForm, employeeId: e.target.value })}><option value="">Employee *</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
            <input className="input-field" type="number" placeholder="Principal *" value={loanForm.principal} onChange={(e) => setLoanForm({ ...loanForm, principal: e.target.value })} />
            <input className="input-field" type="number" placeholder="Monthly installment *" value={loanForm.monthlyInstallment} onChange={(e) => setLoanForm({ ...loanForm, monthlyInstallment: e.target.value })} />
            <input className="input-field" placeholder="Reason" value={loanForm.reason} onChange={(e) => setLoanForm({ ...loanForm, reason: e.target.value })} />
          </div>
          <button className="btn-secondary w-full" onClick={createLoan}>Create loan</button>
          <div className="mt-3 space-y-1 max-h-40 overflow-auto">
            {loans.map((l) => (
              <div key={l.id} className="flex justify-between items-center text-xs border-b border-border py-1">
                <span>{l.employee} · bal {fmt(l.balance)} / {fmt(l.principal)}</span>
                <span className="flex items-center gap-2"><span className="badge bg-surface-sunken capitalize">{l.status}</span>{l.status === 'active' && <button className="btn-ghost text-xs" onClick={() => repay(l.id)}>Repay</button>}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Runs */}
      <div className="card">
        <h2 className="section-title mb-3">Payroll runs</h2>
        <div className="space-y-1.5 max-h-60 overflow-auto">
          {runs.map((r) => (
            <div key={r.id} className="flex items-center justify-between text-sm border-b border-border py-2">
              <span className="text-text-primary">{r.period} <span className="badge bg-surface-sunken capitalize">{r.status}</span></span>
              <span className="flex items-center gap-3">
                <span className="text-text-secondary">{r.employeeCount} staff · net {fmt(r.totalNet)}</span>
                <button className="btn-ghost text-xs" onClick={() => viewRun(r.id)}>View</button>
                <button className="btn-ghost text-xs" onClick={() => exportRun(r.id)}>Export</button>
                {r.status === 'draft' && <button className="btn-ghost text-xs text-green-600" onClick={() => finalize(r.id)}>Finalize</button>}
              </span>
            </div>
          ))}
          {runs.length === 0 && <p className="text-sm text-text-muted">No payroll runs yet.</p>}
        </div>
      </div>

      {/* Payslips */}
      {detail && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="section-title">Payslips — {detail.period} ({detail.status})</h2>
            <button className="btn-secondary text-sm" onClick={() => exportRun(detail.id)}>Export CSV</button>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-text-secondary uppercase">
                <th className="pb-2">Employee</th><th className="pb-2 text-right">Base</th><th className="pb-2 text-right">Bonus</th><th className="pb-2 text-right">Deduct</th><th className="pb-2 text-right">Advance</th><th className="pb-2 text-right">Loan</th><th className="pb-2 text-right">Unpaid Lv</th><th className="pb-2 text-right">Net</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {detail.payslips.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2">{p.employeeName}</td>
                    <td className="py-2 text-right font-mono">{fmt(p.baseSalary)}</td>
                    <td className="py-2 text-right font-mono text-green-600">{fmt(p.bonusTotal)}</td>
                    <td className="py-2 text-right font-mono text-red-600">{fmt(p.deductionTotal)}</td>
                    <td className="py-2 text-right font-mono text-red-600">{fmt(p.advanceTotal)}</td>
                    <td className="py-2 text-right font-mono text-red-600">{fmt(p.loanRepaymentTotal)}</td>
                    <td className="py-2 text-right font-mono text-red-600">{fmt(p.unpaidLeaveDeduction)}</td>
                    <td className="py-2 text-right font-mono font-semibold">{fmt(p.netPay)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-text-secondary mt-3 text-right">Total net: <span className="font-semibold text-text-primary">{fmt(detail.totalNet)}</span></p>
        </div>
      )}
    </div>
  );
}
