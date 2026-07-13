'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import {
  PageHeader, StatCard, Panel, ErrorBanner, Modal, Field, StatusBadge,
  TableWrap, EmptyRow, TableSkeleton, thCls, tdCls,
  fmtIDR, fmtDate, Spinner,
} from '@/components/dashboard/ui';
import { EmployeeDetailModal } from './employee-detail';

type Tab = 'employees' | 'schedule' | 'leave' | 'holidays';

interface Summary { activeEmployees: number; monthlyPayroll: number; presentToday: number; pendingLeaveRequests: number; }
export interface Employee { id: string; name: string; role: string | null; phone: string | null; email: string | null; salary: number; status: string; hiredAt: string | null; employmentType: string; outletId: string | null; outletName: string | null; userId: string | null; userEmail: string | null; }
export interface UserLite { id: string; name: string; email: string }
interface Leave { id: string; employee: string; startDate: string; endDate: string; type: string; reason: string | null; status: string; }
interface Schedule { id: string; employee: string; workDate: string; startTime: string | null; endTime: string | null; notes: string | null; outletName: string | null; }
interface Holiday { id: string; date: string; name: string; isPaid: boolean; }
export interface Branch { id: string; name: string }

const LEAVE_TYPES = ['annual', 'sick', 'unpaid', 'other'] as const;

export default function HrPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('employees');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leave, setLeave] = useState<Leave[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [branchFilter, setBranchFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [showAddEmp, setShowAddEmp] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const [schedForm, setSchedForm] = useState({ employeeId: '', workDate: '', startTime: '', endTime: '', outletId: '' });
  const [leaveForm, setLeaveForm] = useState({ employeeId: '', startDate: '', endDate: '', type: 'annual', paid: true, reason: '' });
  const [holForm, setHolForm] = useState({ date: '', name: '', isPaid: true });

  const load = useCallback(async () => {
    setLoading(true);
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
      api.get<UserLite[]>('/users').then(setUsers).catch(() => setUsers([]));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dash.hr.loadFailed', 'Failed to load HR data'));
    } finally {
      setLoading(false);
    }
  }, [branchFilter, t]);
  useEffect(() => { load(); }, [load]);

  const wrap = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id); setError('');
    try { await fn(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : t('dash.hr.actionFailed', 'Action failed')); }
    finally { setBusyId(''); }
  };

  const clockIn = (id: string) => wrap(id, () => api.post(`/hr/employees/${id}/clock-in`));
  const clockOut = (id: string) => wrap(id, () => api.post(`/hr/employees/${id}/clock-out`));
  const setSchedule = () => schedForm.employeeId && schedForm.workDate && wrap('sched', async () => {
    await api.post('/hr/schedules', { employeeId: schedForm.employeeId, workDate: schedForm.workDate, startTime: schedForm.startTime || undefined, endTime: schedForm.endTime || undefined, outletId: schedForm.outletId || undefined });
    setSchedForm({ employeeId: '', workDate: '', startTime: '', endTime: '', outletId: '' });
  });
  const requestLeave = () => leaveForm.employeeId && leaveForm.startDate && leaveForm.endDate && wrap('leave', async () => {
    await api.post('/hr/leave', { employeeId: leaveForm.employeeId, startDate: leaveForm.startDate, endDate: leaveForm.endDate, type: leaveForm.type, paid: leaveForm.paid, reason: leaveForm.reason || undefined });
    setLeaveForm({ employeeId: '', startDate: '', endDate: '', type: 'annual', paid: true, reason: '' });
  });
  const resolveLeave = (id: string, status: 'approved' | 'rejected') => wrap(id, () => api.patch(`/hr/leave/${id}`, { status }));
  const addHoliday = () => holForm.date && holForm.name.trim() && wrap('hol', async () => {
    await api.post('/hr/holidays', { date: holForm.date, name: holForm.name.trim(), isPaid: holForm.isPaid });
    setHolForm({ date: '', name: '', isPaid: true });
  });

  const TABS: { id: Tab; label: string }[] = [
    { id: 'employees', label: t('dash.hr.tabEmployees', 'Employees') },
    { id: 'schedule', label: t('dash.hr.tabSchedule', 'Schedule') },
    { id: 'leave', label: t('dash.hr.tabLeave', 'Leave') },
    { id: 'holidays', label: t('dash.hr.tabHolidays', 'Holidays') },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title={t('dash.hr.title', 'Human Resources')}
        subtitle={t('dash.hr.subtitle', 'Manage your staff, attendance, schedules, leave requests and holidays. Click any employee for their full record.')}
        actions={
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">{t('dash.hr.branchFilter', 'Branch')}</label>
              <select aria-label={t('dash.hr.branchFilter', 'Branch Filter')} className="input-field max-w-[200px]" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
                <option value="">{t('dash.hr.allBranches', 'All branches (global)')}</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <a href="/dashboard/payroll" className="btn-secondary self-end">{t('dash.hr.payrollLink', 'Payroll')} →</a>
          </>
        }
      />

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard loading={loading} label={t('dash.hr.activeStaff', 'Active staff')} value={summary?.activeEmployees ?? 0} />
        <StatCard loading={loading} label={t('dash.hr.monthlyPayroll', 'Monthly payroll')} value={fmtIDR(summary?.monthlyPayroll)} />
        <StatCard loading={loading} label={t('dash.hr.presentToday', 'Present today')} value={summary?.presentToday ?? 0} tone="positive" />
        <StatCard loading={loading} label={t('dash.hr.pendingLeave', 'Pending leave')} value={summary?.pendingLeaveRequests ?? 0} tone={(summary?.pendingLeaveRequests ?? 0) > 0 ? 'warning' : 'default'} />
      </div>

      <div className="inline-flex rounded-lg bg-surface-sunken p-1">
        {TABS.map((tb) => (
          <button key={tb.id} onClick={() => setTab(tb.id)} className={`px-4 py-1.5 text-sm rounded-md ${tab === tb.id ? 'bg-surface-raised shadow-sm font-medium text-text-primary' : 'text-text-secondary'}`}>{tb.label}</button>
        ))}
      </div>

      {/* EMPLOYEES */}
      {tab === 'employees' && (
        <Panel
          title={t('dash.hr.employees', 'Employees')}
          bodyClassName="p-0"
          actions={<button className="btn-primary py-1.5 text-xs" onClick={() => setShowAddEmp(true)}>+ {t('dash.hr.addEmployee', 'Add employee')}</button>}
        >
          {loading ? (
            <TableSkeleton rows={6} cols={6} />
          ) : (
            <TableWrap>
              <thead>
                <tr className="border-b border-border bg-surface-sunken/50">
                  <th className={`${thCls} text-left`}>{t('dash.hr.name', 'Name')}</th>
                  <th className={`${thCls} text-left`}>{t('dash.hr.role', 'Role')}</th>
                  <th className={`${thCls} text-left`}>{t('dash.hr.type', 'Type')}</th>
                  <th className={`${thCls} text-left`}>{t('dash.hr.branch', 'Branch')}</th>
                  <th className={`${thCls} text-right`}>{t('dash.hr.salary', 'Salary')}</th>
                  <th className={`${thCls} text-left`}>{t('dash.hr.status', 'Status')}</th>
                  <th className={`${thCls} text-right`}>{t('dash.hr.attendance', 'Attendance')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {employees.length === 0 ? (
                  <EmptyRow colSpan={7}>{t('dash.hr.noEmployees', 'No employees yet. Add your first staff member.')}</EmptyRow>
                ) : employees.map((e) => (
                  <tr key={e.id} className="cursor-pointer hover:bg-surface-sunken/40" onClick={() => setDetailId(e.id)}>
                    <td className={tdCls}>
                      <div className="font-medium text-text-primary hover:underline">{e.name}</div>
                      <div className="text-xs text-text-muted">{e.phone || e.email || (e.hiredAt ? `${t('dash.hr.since', 'since')} ${fmtDate(e.hiredAt)}` : '—')}</div>
                    </td>
                    <td className={`${tdCls} text-text-secondary`}>{e.role || '—'}</td>
                    <td className={tdCls}>
                      <span className={`badge ${e.employmentType === 'contract' ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700'}`}>
                        {e.employmentType === 'contract' ? t('dash.hr.contract', 'Contract') : t('dash.hr.permanent', 'Permanent')}
                      </span>
                    </td>
                    <td className={`${tdCls} text-text-secondary`}>{e.outletName || <span className="text-text-muted">{t('dash.hr.tenantWide', 'Tenant-wide')}</span>}</td>
                    <td className={`${tdCls} text-right tabular-nums`}>{fmtIDR(e.salary)}</td>
                    <td className={tdCls}><StatusBadge status={e.status} /></td>
                    <td className={`${tdCls} text-right`} onClick={(ev) => ev.stopPropagation()}>
                      <span className="inline-flex gap-1">
                        <button className="btn-ghost px-2 py-1 text-xs text-green-600" disabled={busyId === e.id} onClick={() => clockIn(e.id)}>{t('dash.hr.clockIn', 'Clock in')}</button>
                        <button className="btn-ghost px-2 py-1 text-xs text-amber-600" disabled={busyId === e.id} onClick={() => clockOut(e.id)}>{t('dash.hr.clockOut', 'Clock out')}</button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Panel>
      )}

      {/* SCHEDULE */}
      {tab === 'schedule' && (
        <>
          <Panel title={t('dash.hr.setSchedule', 'Set schedule')} description={t('dash.hr.setScheduleHint', 'Roster staff to a branch and shift time. The POS uses today’s roster to pre-select the branch and warn on off-schedule opens.')}>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
              <Field label={t('dash.hr.employee', 'Employee')}>
                <select className="input-field" value={schedForm.employeeId} onChange={(e) => setSchedForm({ ...schedForm, employeeId: e.target.value })}>
                  <option value="">{t('dash.hr.selectEmployee', 'Select…')}</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </Field>
              <Field label={t('dash.hr.workDate', 'Date')}><input className="input-field" type="date" value={schedForm.workDate} onChange={(e) => setSchedForm({ ...schedForm, workDate: e.target.value })} /></Field>
              <Field label={t('dash.hr.startTime', 'Start')}><input className="input-field" type="time" value={schedForm.startTime} onChange={(e) => setSchedForm({ ...schedForm, startTime: e.target.value })} /></Field>
              <Field label={t('dash.hr.endTime', 'End')}><input className="input-field" type="time" value={schedForm.endTime} onChange={(e) => setSchedForm({ ...schedForm, endTime: e.target.value })} /></Field>
              <Field label={t('dash.hr.branch', 'Branch')}>
                <select className="input-field" value={schedForm.outletId} onChange={(e) => setSchedForm({ ...schedForm, outletId: e.target.value })}>
                  <option value="">{t('dash.hr.branchDots', 'Branch…')}</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
              <button className="btn-primary" onClick={setSchedule} disabled={busyId === 'sched' || !schedForm.employeeId || !schedForm.workDate}>{busyId === 'sched' ? <Spinner /> : t('dash.hr.save', 'Save')}</button>
            </div>
          </Panel>
          <Panel title={t('dash.hr.upcomingSchedules', 'Upcoming schedules')} bodyClassName="p-0">
            {loading ? <TableSkeleton rows={5} cols={4} /> : (
              <TableWrap>
                <thead>
                  <tr className="border-b border-border bg-surface-sunken/50">
                    <th className={`${thCls} text-left`}>{t('dash.hr.employee', 'Employee')}</th>
                    <th className={`${thCls} text-left`}>{t('dash.hr.workDate', 'Date')}</th>
                    <th className={`${thCls} text-left`}>{t('dash.hr.time', 'Time')}</th>
                    <th className={`${thCls} text-left`}>{t('dash.hr.branch', 'Branch')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {schedules.length === 0 ? (
                    <EmptyRow colSpan={4}>{t('dash.hr.noSchedules', 'No schedules set.')}</EmptyRow>
                  ) : schedules.map((s) => (
                    <tr key={s.id} className="hover:bg-surface-sunken/40">
                      <td className={`${tdCls} font-medium`}>{s.employee}</td>
                      <td className={`${tdCls} text-text-secondary`}>{fmtDate(s.workDate)}</td>
                      <td className={`${tdCls} text-text-secondary tabular-nums`}>{s.startTime ? `${s.startTime}–${s.endTime ?? ''}` : '—'}</td>
                      <td className={`${tdCls} text-text-secondary`}>{s.outletName || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Panel>
        </>
      )}

      {/* LEAVE */}
      {tab === 'leave' && (
        <>
          <Panel title={t('dash.hr.requestLeave', 'Request leave')}>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
              <Field label={t('dash.hr.employee', 'Employee')}>
                <select className="input-field" value={leaveForm.employeeId} onChange={(e) => setLeaveForm({ ...leaveForm, employeeId: e.target.value })}>
                  <option value="">{t('dash.hr.selectEmployee', 'Select…')}</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </Field>
              <Field label={t('dash.hr.startDate', 'Start')}><input className="input-field" type="date" value={leaveForm.startDate} onChange={(e) => setLeaveForm({ ...leaveForm, startDate: e.target.value })} /></Field>
              <Field label={t('dash.hr.endDate', 'End')}><input className="input-field" type="date" value={leaveForm.endDate} onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })} /></Field>
              <Field label={t('dash.hr.leaveType', 'Type')}>
                <select className="input-field capitalize" value={leaveForm.type} onChange={(e) => setLeaveForm({ ...leaveForm, type: e.target.value })}>
                  {LEAVE_TYPES.map((lt) => <option key={lt} value={lt}>{lt}</option>)}
                </select>
              </Field>
              <label className="flex items-center gap-1.5 pb-2.5 text-sm text-text-secondary"><input type="checkbox" checked={leaveForm.paid} onChange={(e) => setLeaveForm({ ...leaveForm, paid: e.target.checked })} />{t('dash.hr.paidLabel', 'Paid')}</label>
              <button className="btn-primary" onClick={requestLeave} disabled={busyId === 'leave' || !leaveForm.employeeId || !leaveForm.startDate || !leaveForm.endDate}>{busyId === 'leave' ? <Spinner /> : t('dash.hr.request', 'Request')}</button>
            </div>
          </Panel>
          <Panel title={t('dash.hr.leaveRequests', 'Leave requests')} bodyClassName="p-0">
            {loading ? <TableSkeleton rows={5} cols={5} /> : (
              <TableWrap>
                <thead>
                  <tr className="border-b border-border bg-surface-sunken/50">
                    <th className={`${thCls} text-left`}>{t('dash.hr.employee', 'Employee')}</th>
                    <th className={`${thCls} text-left`}>{t('dash.hr.period', 'Period')}</th>
                    <th className={`${thCls} text-left`}>{t('dash.hr.leaveType', 'Type')}</th>
                    <th className={`${thCls} text-left`}>{t('dash.hr.status', 'Status')}</th>
                    <th className={`${thCls} text-right`}>{t('dash.hr.action', 'Action')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {leave.length === 0 ? (
                    <EmptyRow colSpan={5}>{t('dash.hr.noLeaveRequests', 'No leave requests.')}</EmptyRow>
                  ) : leave.map((l) => (
                    <tr key={l.id} className="hover:bg-surface-sunken/40">
                      <td className={tdCls}>
                        <div className="font-medium text-text-primary">{l.employee}</div>
                        {l.reason && <div className="text-xs text-text-muted">{l.reason}</div>}
                      </td>
                      <td className={`${tdCls} text-text-secondary`}>{fmtDate(l.startDate)} → {fmtDate(l.endDate)}</td>
                      <td className={`${tdCls} capitalize text-text-secondary`}>{l.type}</td>
                      <td className={tdCls}><StatusBadge status={l.status} /></td>
                      <td className={`${tdCls} text-right`}>
                        {l.status === 'pending' ? (
                          <span className="inline-flex gap-1">
                            <button className="btn-ghost px-2 py-1 text-xs text-green-600" disabled={busyId === l.id} onClick={() => resolveLeave(l.id, 'approved')}>{t('dash.hr.approve', 'Approve')}</button>
                            <button className="btn-ghost px-2 py-1 text-xs text-red-600" disabled={busyId === l.id} onClick={() => resolveLeave(l.id, 'rejected')}>{t('dash.hr.reject', 'Reject')}</button>
                          </span>
                        ) : <span className="text-xs text-text-muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Panel>
        </>
      )}

      {/* HOLIDAYS */}
      {tab === 'holidays' && (
        <>
          <Panel title={t('dash.hr.addHoliday', 'Add holiday')}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
              <Field label={t('dash.hr.date', 'Date')}><input className="input-field" type="date" value={holForm.date} onChange={(e) => setHolForm({ ...holForm, date: e.target.value })} /></Field>
              <Field label={t('dash.hr.name', 'Name')}><input className="input-field" placeholder={t('dash.hr.holidayNamePh', 'e.g. Idul Fitri')} value={holForm.name} onChange={(e) => setHolForm({ ...holForm, name: e.target.value })} /></Field>
              <label className="flex items-center gap-1.5 pb-2.5 text-sm text-text-secondary"><input type="checkbox" checked={holForm.isPaid} onChange={(e) => setHolForm({ ...holForm, isPaid: e.target.checked })} />{t('dash.hr.paidLabel', 'Paid')}</label>
              <button className="btn-primary" onClick={addHoliday} disabled={busyId === 'hol' || !holForm.date || !holForm.name.trim()}>{busyId === 'hol' ? <Spinner /> : t('dash.hr.add', 'Add')}</button>
            </div>
          </Panel>
          <Panel title={t('dash.hr.holidays', 'Holidays')} bodyClassName="p-0">
            {loading ? <TableSkeleton rows={5} cols={3} /> : (
              <TableWrap>
                <thead>
                  <tr className="border-b border-border bg-surface-sunken/50">
                    <th className={`${thCls} text-left`}>{t('dash.hr.date', 'Date')}</th>
                    <th className={`${thCls} text-left`}>{t('dash.hr.name', 'Name')}</th>
                    <th className={`${thCls} text-right`}>{t('dash.hr.paidLabel', 'Paid')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {holidays.length === 0 ? (
                    <EmptyRow colSpan={3}>{t('dash.hr.noHolidays', 'No holidays set.')}</EmptyRow>
                  ) : holidays.map((h) => (
                    <tr key={h.id} className="hover:bg-surface-sunken/40">
                      <td className={`${tdCls} text-text-secondary`}>{fmtDate(h.date)}</td>
                      <td className={`${tdCls} font-medium`}>{h.name}</td>
                      <td className={`${tdCls} text-right`}><span className={`badge ${h.isPaid ? 'bg-green-50 text-green-700' : 'bg-surface-sunken text-text-secondary'}`}>{h.isPaid ? t('dash.hr.paid', 'Paid') : t('dash.hr.unpaid', 'Unpaid')}</span></td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Panel>
        </>
      )}

      {showAddEmp && (
        <AddEmployeeModal branches={branches} onClose={() => setShowAddEmp(false)} onSaved={() => { setShowAddEmp(false); load(); }} />
      )}
      {detailId && (
        <EmployeeDetailModal
          employeeId={detailId}
          branches={branches}
          users={users}
          onClose={() => setDetailId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function AddEmployeeModal({ branches, onClose, onSaved }: { branches: Branch[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ name: '', role: '', phone: '', email: '', salary: '', outletId: '', hiredAt: '', employmentType: 'permanent' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!form.name.trim()) { setError(t('dash.hr.nameRequired', 'Name is required.')); return; }
    setSaving(true); setError('');
    try {
      await api.post('/hr/employees', {
        name: form.name.trim(),
        role: form.role || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        salary: Number(form.salary) || 0,
        outletId: form.outletId || undefined,
        hiredAt: form.hiredAt || undefined,
        employmentType: form.employmentType,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dash.hr.actionFailed', 'Action failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={t('dash.hr.addEmployee', 'Add employee')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>{t('common.cancel', 'Cancel')}</button>
          <button type="submit" form="add-emp-form" className="btn-primary" disabled={saving}>{saving ? <Spinner /> : t('dash.hr.add', 'Add employee')}</button>
        </>
      }
    >
      <form id="add-emp-form" onSubmit={submit} className="space-y-4">
        <ErrorBanner message={error} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('dash.hr.name', 'Name')}><input className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
          <Field label={t('dash.hr.role', 'Role')}><input className="input-field" value={form.role} placeholder={t('dash.hr.rolePh', 'e.g. Cashier')} onChange={(e) => setForm({ ...form, role: e.target.value })} /></Field>
          <Field label={t('dash.hr.employmentType', 'Employment type')}>
            <select className="input-field" value={form.employmentType} onChange={(e) => setForm({ ...form, employmentType: e.target.value })}>
              <option value="permanent">{t('dash.hr.permanent', 'Permanent')}</option>
              <option value="contract">{t('dash.hr.contract', 'Contract')}</option>
            </select>
          </Field>
          <Field label={t('dash.hr.salary', 'Salary (Rp)')}><input className="input-field" type="number" min="0" value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })} /></Field>
          <Field label={t('dash.hr.phone', 'Phone')}><input className="input-field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label={t('dash.hr.email', 'Email')}><input className="input-field" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label={t('dash.hr.hiredAt', 'Hire date')}><input className="input-field" type="date" value={form.hiredAt} onChange={(e) => setForm({ ...form, hiredAt: e.target.value })} /></Field>
        </div>
        <Field label={t('dash.hr.branch', 'Branch')} hint={t('dash.hr.addEmployeeHint', 'Assign a branch, or leave blank for tenant-wide. Branch managers can only add to their own branch.')}>
          <select className="input-field" value={form.outletId} onChange={(e) => setForm({ ...form, outletId: e.target.value })}>
            <option value="">{t('dash.hr.noBranch', 'No branch (tenant-wide)')}</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
      </form>
    </Modal>
  );
}
