'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

type Tab = 'employees' | 'schedule' | 'leave' | 'holidays';

interface Summary { activeEmployees: number; monthlyPayroll: number; presentToday: number; pendingLeaveRequests: number; }
interface Employee { id: string; name: string; role: string | null; phone: string | null; salary: number; status: string; outletId: string | null; outletName: string | null; }
interface Leave { id: string; employee: string; startDate: string; endDate: string; type: string; status: string; }
interface Schedule { id: string; employee: string; workDate: string; startTime: string | null; endTime: string | null; outletName: string | null; }
interface Holiday { id: string; date: string; name: string; isPaid: boolean; }
interface Branch { id: string; name: string }

const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

export default function HrPage() {
  const [tab, setTab] = useState<Tab>('employees');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leave, setLeave] = useState<Leave[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchFilter, setBranchFilter] = useState(''); // '' = all branches (global)
  const [error, setError] = useState('');

  const [empForm, setEmpForm] = useState({ name: '', role: '', phone: '', salary: '', outletId: '' });
  const [schedForm, setSchedForm] = useState({ employeeId: '', workDate: '', startTime: '', endTime: '', outletId: '' });
  const [leaveForm, setLeaveForm] = useState({ employeeId: '', startDate: '', endDate: '', type: 'annual', paid: true });
  const [holForm, setHolForm] = useState({ date: '', name: '', isPaid: true });

  const load = useCallback(async () => {
    try {
      const q = branchFilter ? `?outletId=${branchFilter}` : '';
      const [s, e, l, sch, h, b] = await Promise.all([
        api.get<Summary>('/hr/summary'),
        api.get<Employee[]>(`/hr/employees${q}`),
        api.get<Leave[]>('/hr/leave'),
        api.get<Schedule[]>(`/hr/schedules${q}`),
        api.get<Holiday[]>('/hr/holidays'),
        api.get<Branch[]>('/outlets'),
      ]);
      setSummary(s); setEmployees(e); setLeave(l); setSchedules(sch); setHolidays(h); setBranches(b); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load'); }
  }, [branchFilter]);
  useEffect(() => { load(); }, [load]);

  const wrap = async (fn: () => Promise<unknown>) => {
    try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
  };

  const addEmployee = () => empForm.name.trim() && wrap(async () => {
    await api.post('/hr/employees', { name: empForm.name.trim(), role: empForm.role || undefined, phone: empForm.phone || undefined, salary: Number(empForm.salary) || 0, outletId: empForm.outletId || undefined });
    setEmpForm({ name: '', role: '', phone: '', salary: '', outletId: '' });
  });
  const clockIn = (id: string) => wrap(() => api.post(`/hr/employees/${id}/clock-in`));
  const clockOut = (id: string) => wrap(() => api.post(`/hr/employees/${id}/clock-out`));
  const setSchedule = () => schedForm.employeeId && schedForm.workDate && wrap(async () => {
    await api.post('/hr/schedules', { employeeId: schedForm.employeeId, workDate: schedForm.workDate, startTime: schedForm.startTime || undefined, endTime: schedForm.endTime || undefined, outletId: schedForm.outletId || undefined });
    setSchedForm({ employeeId: '', workDate: '', startTime: '', endTime: '', outletId: '' });
  });
  const requestLeave = () => leaveForm.employeeId && leaveForm.startDate && leaveForm.endDate && wrap(async () => {
    await api.post('/hr/leave', { employeeId: leaveForm.employeeId, startDate: leaveForm.startDate, endDate: leaveForm.endDate, type: leaveForm.type, paid: leaveForm.paid });
    setLeaveForm({ employeeId: '', startDate: '', endDate: '', type: 'annual', paid: true });
  });
  const resolveLeave = (id: string, status: 'approved' | 'rejected') => wrap(() => api.patch(`/hr/leave/${id}`, { status }));
  const addHoliday = () => holForm.date && holForm.name.trim() && wrap(async () => {
    await api.post('/hr/holidays', { date: holForm.date, name: holForm.name.trim(), isPaid: holForm.isPaid });
    setHolForm({ date: '', name: '', isPaid: true });
  });

  const TABS: { id: Tab; label: string }[] = [
    { id: 'employees', label: 'Employees' }, { id: 'schedule', label: 'Schedule' },
    { id: 'leave', label: 'Leave' }, { id: 'holidays', label: 'Holidays' },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-primary">HR</h1>
        <div className="flex items-center gap-3">
          <select className="input-field max-w-[200px]" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="">All branches (global)</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <a href="/dashboard/payroll" className="btn-secondary text-sm">Payroll →</a>
        </div>
      </div>
      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card"><p className="text-xs text-text-muted">Active staff</p><p className="text-2xl font-semibold">{summary?.activeEmployees ?? 0}</p></div>
        <div className="card"><p className="text-xs text-text-muted">Monthly payroll</p><p className="text-2xl font-semibold">{fmt(summary?.monthlyPayroll ?? 0)}</p></div>
        <div className="card"><p className="text-xs text-text-muted">Present today</p><p className="text-2xl font-semibold text-green-600">{summary?.presentToday ?? 0}</p></div>
        <div className="card"><p className="text-xs text-text-muted">Pending leave</p><p className="text-2xl font-semibold text-amber-600">{summary?.pendingLeaveRequests ?? 0}</p></div>
      </div>

      <div className="inline-flex rounded-lg bg-surface-sunken p-1">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-1.5 text-sm rounded-md ${tab === t.id ? 'bg-surface-raised shadow-sm font-medium text-text-primary' : 'text-text-secondary'}`}>{t.label}</button>
        ))}
      </div>

      {tab === 'employees' && (
        <>
          <div className="card">
            <h2 className="section-title mb-3">Add employee</h2>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
              <input className="input-field" placeholder="Name *" value={empForm.name} onChange={(e) => setEmpForm({ ...empForm, name: e.target.value })} />
              <input className="input-field" placeholder="Role" value={empForm.role} onChange={(e) => setEmpForm({ ...empForm, role: e.target.value })} />
              <input className="input-field" placeholder="Phone" value={empForm.phone} onChange={(e) => setEmpForm({ ...empForm, phone: e.target.value })} />
              <input className="input-field" type="number" placeholder="Salary" value={empForm.salary} onChange={(e) => setEmpForm({ ...empForm, salary: e.target.value })} />
              <select className="input-field" value={empForm.outletId} onChange={(e) => setEmpForm({ ...empForm, outletId: e.target.value })}>
                <option value="">No branch</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <button className="btn-primary" onClick={addEmployee}>Add</button>
            </div>
            <p className="text-xs text-text-muted mt-2">Assign a branch to place the employee there, or leave blank for tenant-wide. Branch managers can only add to their own branch.</p>
          </div>
          <div className="card">
            <h2 className="section-title mb-3">Employees</h2>
            <div className="space-y-1.5 max-h-96 overflow-auto">
              {employees.map((e) => (
                <div key={e.id} className="flex items-center justify-between text-sm border-b border-border py-2">
                  <span className="text-text-primary">{e.name}<span className="text-text-muted">{e.role ? ` · ${e.role}` : ''} · {fmt(e.salary)}{e.outletName ? ` · ${e.outletName}` : ''}</span></span>
                  <span className="flex gap-1">
                    <button className="btn-ghost text-xs text-green-600" onClick={() => clockIn(e.id)}>Clock in</button>
                    <button className="btn-ghost text-xs text-amber-600" onClick={() => clockOut(e.id)}>Clock out</button>
                  </span>
                </div>
              ))}
              {employees.length === 0 && <p className="text-sm text-text-muted">No employees yet.</p>}
            </div>
          </div>
        </>
      )}

      {tab === 'schedule' && (
        <>
          <div className="card">
            <h2 className="section-title mb-3">Set schedule</h2>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
              <select className="input-field" value={schedForm.employeeId} onChange={(e) => setSchedForm({ ...schedForm, employeeId: e.target.value })}>
                <option value="">Employee *</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <input className="input-field" type="date" value={schedForm.workDate} onChange={(e) => setSchedForm({ ...schedForm, workDate: e.target.value })} />
              <input className="input-field" type="time" value={schedForm.startTime} onChange={(e) => setSchedForm({ ...schedForm, startTime: e.target.value })} />
              <input className="input-field" type="time" value={schedForm.endTime} onChange={(e) => setSchedForm({ ...schedForm, endTime: e.target.value })} />
              <select className="input-field" value={schedForm.outletId} onChange={(e) => setSchedForm({ ...schedForm, outletId: e.target.value })}>
                <option value="">Branch…</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <button className="btn-primary" onClick={setSchedule}>Save</button>
            </div>
            <p className="text-xs text-text-muted mt-2">Assign which branch the shift is at. From the global view you can roster a staff member across branches; branch managers schedule within their branch.</p>
          </div>
          <div className="card">
            <h2 className="section-title mb-3">Upcoming schedules</h2>
            <div className="space-y-1.5 max-h-96 overflow-auto">
              {schedules.map((s) => (
                <div key={s.id} className="flex justify-between text-sm border-b border-border py-2">
                  <span className="text-text-primary">{s.employee}{s.outletName ? <span className="text-text-muted"> · {s.outletName}</span> : null}</span>
                  <span className="text-text-secondary">{s.workDate}{s.startTime ? ` · ${s.startTime}–${s.endTime ?? ''}` : ''}</span>
                </div>
              ))}
              {schedules.length === 0 && <p className="text-sm text-text-muted">No schedules set.</p>}
            </div>
          </div>
        </>
      )}

      {tab === 'leave' && (
        <>
          <div className="card">
            <h2 className="section-title mb-3">Request leave</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-center">
              <select className="input-field" value={leaveForm.employeeId} onChange={(e) => setLeaveForm({ ...leaveForm, employeeId: e.target.value })}>
                <option value="">Employee *</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <input className="input-field" type="date" value={leaveForm.startDate} onChange={(e) => setLeaveForm({ ...leaveForm, startDate: e.target.value })} />
              <input className="input-field" type="date" value={leaveForm.endDate} onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })} />
              <label className="flex items-center gap-1.5 text-sm text-text-secondary"><input type="checkbox" checked={leaveForm.paid} onChange={(e) => setLeaveForm({ ...leaveForm, paid: e.target.checked })} />Paid</label>
              <button className="btn-primary" onClick={requestLeave}>Request</button>
            </div>
          </div>
          <div className="card">
            <h2 className="section-title mb-3">Leave requests</h2>
            <div className="space-y-1.5 max-h-96 overflow-auto">
              {leave.map((l) => (
                <div key={l.id} className="flex items-center justify-between text-sm border-b border-border py-2">
                  <span className="text-text-primary">{l.employee}<span className="text-text-muted"> · {l.startDate}→{l.endDate} · {l.type}</span></span>
                  {l.status === 'pending' ? (
                    <span className="flex gap-1">
                      <button className="btn-ghost text-xs text-green-600" onClick={() => resolveLeave(l.id, 'approved')}>Approve</button>
                      <button className="btn-ghost text-xs text-red-600" onClick={() => resolveLeave(l.id, 'rejected')}>Reject</button>
                    </span>
                  ) : <span className="badge bg-surface-sunken capitalize">{l.status}</span>}
                </div>
              ))}
              {leave.length === 0 && <p className="text-sm text-text-muted">No leave requests.</p>}
            </div>
          </div>
        </>
      )}

      {tab === 'holidays' && (
        <>
          <div className="card">
            <h2 className="section-title mb-3">Add holiday</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-center">
              <input className="input-field" type="date" value={holForm.date} onChange={(e) => setHolForm({ ...holForm, date: e.target.value })} />
              <input className="input-field" placeholder="Name *" value={holForm.name} onChange={(e) => setHolForm({ ...holForm, name: e.target.value })} />
              <label className="flex items-center gap-1.5 text-sm text-text-secondary"><input type="checkbox" checked={holForm.isPaid} onChange={(e) => setHolForm({ ...holForm, isPaid: e.target.checked })} />Paid</label>
              <button className="btn-primary" onClick={addHoliday}>Add</button>
            </div>
          </div>
          <div className="card">
            <h2 className="section-title mb-3">Holidays</h2>
            <div className="space-y-1.5 max-h-96 overflow-auto">
              {holidays.map((h) => (
                <div key={h.id} className="flex justify-between text-sm border-b border-border py-2">
                  <span className="text-text-primary">{h.name}</span>
                  <span className="text-text-secondary">{h.date} {h.isPaid ? '· paid' : '· unpaid'}</span>
                </div>
              ))}
              {holidays.length === 0 && <p className="text-sm text-text-muted">No holidays set.</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
