'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import {
  Modal, Field, StatusBadge, Tabs, ErrorBanner, Spinner,
  TableWrap, EmptyRow, thCls, tdCls, fmtIDR, fmtDate,
} from '@/components/dashboard/ui';
import type { Branch, UserLite } from './page';

interface Detail {
  id: string; name: string; role: string | null; phone: string | null; email: string | null;
  salary: number; status: string; hiredAt: string | null; employmentType: string;
  outletId: string | null; outletName: string | null; userId: string | null; userEmail: string | null; createdAt: string;
  attendanceThisMonth: { present: number; absent: number };
  attendance: { workDate: string; status: string; checkIn: string | null; checkOut: string | null; hoursWorked: number | null }[];
  schedules: { id: string; workDate: string; startTime: string | null; endTime: string | null; notes: string | null; outletName: string | null }[];
  leave: { id: string; startDate: string; endDate: string; type: string; reason: string | null; status: string; paid: boolean }[];
  adjustments: { id: string; type: string; amount: number; reason: string | null; period: string; status: string; recurring: boolean; totalPeriods: number | null; appliedCount: number }[];
  loans: { id: string; principal: number; balance: number; monthlyInstallment: number; reason: string | null; status: string; createdAt: string }[];
  payslips: { id: string; period: string; runStatus: string; baseSalary: number; bonusTotal: number; deductionTotal: number; advanceTotal: number; loanRepaymentTotal: number; unpaidLeaveDeduction: number; grossPay: number; netPay: number; daysWorked: number; scheduledDays: number }[];
}

type Tab = 'profile' | 'attendance' | 'schedule' | 'leave' | 'payroll';

export function EmployeeDetailModal({
  employeeId, branches, users, onClose, onChanged,
}: {
  employeeId: string;
  branches: Branch[];
  users: UserLite[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [tab, setTab] = useState<Tab>('profile');
  const [error, setError] = useState('');

  const reload = () => api.get<Detail>(`/hr/employees/${employeeId}`).then(setDetail).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [employeeId]);

  const TABS: { id: Tab; label: string; badge?: number }[] = [
    { id: 'profile', label: t('dash.hr.tabProfile', 'Profile') },
    { id: 'attendance', label: t('dash.hr.tabAttendance', 'Attendance') },
    { id: 'schedule', label: t('dash.hr.tabSchedule', 'Schedule') },
    { id: 'leave', label: t('dash.hr.tabLeave', 'Leave'), badge: detail?.leave.filter((l) => l.status === 'pending').length },
    { id: 'payroll', label: t('dash.hr.tabPayroll', 'Payroll') },
  ];

  return (
    <Modal title={detail?.name ?? t('dash.hr.employee', 'Employee')} onClose={onClose} maxWidth="max-w-3xl">
      <ErrorBanner message={error} onDismiss={() => setError('')} />
      {!detail ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-text-muted"><Spinner /> {t('common.loading', 'Loading…')}</div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={detail.status} />
            <span className={`badge ${detail.employmentType === 'contract' ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700'}`}>
              {detail.employmentType === 'contract' ? t('dash.hr.contract', 'Contract') : t('dash.hr.permanent', 'Permanent')}
            </span>
            {detail.role && <span className="text-sm text-text-secondary">{detail.role}</span>}
            <span className="text-sm text-text-muted">· {detail.outletName || t('dash.hr.tenantWide', 'Tenant-wide')}</span>
          </div>

          <Tabs tabs={TABS} active={tab} onChange={setTab} />

          {tab === 'profile' && <ProfileTab detail={detail} branches={branches} users={users} onSaved={() => { reload(); onChanged(); }} />}
          {tab === 'attendance' && <AttendanceTab detail={detail} />}
          {tab === 'schedule' && <ScheduleTab detail={detail} />}
          {tab === 'leave' && <LeaveTab detail={detail} />}
          {tab === 'payroll' && <PayrollTab detail={detail} />}
        </div>
      )}
    </Modal>
  );
}

function ProfileTab({ detail, branches, users, onSaved }: { detail: Detail; branches: Branch[]; users: UserLite[]; onSaved: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    name: detail.name, role: detail.role ?? '', phone: detail.phone ?? '', email: detail.email ?? '',
    salary: String(detail.salary), outletId: detail.outletId ?? '', employmentType: detail.employmentType, status: detail.status,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // RBAC: assign a custom access-role to this employee's linked login directly
  // from the employee record (owner-only; endpoints 403 for others → controls hide).
  const [roles, setRoles] = useState<{ id: string; name: string }[] | null>(null);
  const [currentRoleId, setCurrentRoleId] = useState<string | null>(null);

  useEffect(() => {
    if (!detail.userId) { setRoles(null); return; }
    Promise.all([
      api.get<{ id: string; name: string }[]>('/roles').catch(() => null),
      api.get<{ id: string; customRoleId: string | null }[]>('/users').catch(() => null),
    ]).then(([r, u]) => {
      setRoles(r);
      setCurrentRoleId(u?.find((x) => x.id === detail.userId)?.customRoleId ?? null);
    });
  }, [detail.userId]);

  const assignRole = async (roleId: string) => {
    if (!detail.userId) return;
    setError('');
    try {
      await api.put(`/users/${detail.userId}`, { customRoleId: roleId || null });
      setCurrentRoleId(roleId || null);
    } catch (e) { setError(e instanceof Error ? e.message : t('dash.hr.actionFailed', 'Action failed')); }
  };

  const save = async () => {
    setSaving(true); setError('');
    try {
      await api.patch(`/hr/employees/${detail.id}`, {
        name: form.name, role: form.role || null, phone: form.phone || null, email: form.email || null,
        salary: Number(form.salary) || 0, outletId: form.outletId || null,
        employmentType: form.employmentType, status: form.status,
      });
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : t('dash.hr.actionFailed', 'Action failed')); }
    finally { setSaving(false); }
  };
  const linkUser = async (userId: string) => {
    setError('');
    try { await api.patch(`/hr/employees/${detail.id}/link-user`, { userId: userId || null }); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : t('dash.hr.actionFailed', 'Action failed')); }
  };

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} onDismiss={() => setError('')} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('dash.hr.name', 'Name')}><input className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label={t('dash.hr.role', 'Role')}><input className="input-field" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} /></Field>
        <Field label={t('dash.hr.employmentType', 'Employment type')}>
          <select className="input-field" value={form.employmentType} onChange={(e) => setForm({ ...form, employmentType: e.target.value })}>
            <option value="permanent">{t('dash.hr.permanent', 'Permanent')}</option>
            <option value="contract">{t('dash.hr.contract', 'Contract')}</option>
          </select>
        </Field>
        <Field label={t('dash.hr.status', 'Status')}>
          <select className="input-field" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="active">{t('dash.hr.active', 'Active')}</option>
            <option value="inactive">{t('dash.hr.inactive', 'Inactive')}</option>
          </select>
        </Field>
        <Field label={t('dash.hr.salary', 'Salary (Rp)')}><input className="input-field" type="number" min="0" value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })} /></Field>
        <Field label={t('dash.hr.branch', 'Branch')}>
          <select className="input-field" value={form.outletId} onChange={(e) => setForm({ ...form, outletId: e.target.value })}>
            <option value="">{t('dash.hr.noBranch', 'No branch (tenant-wide)')}</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label={t('dash.hr.phone', 'Phone')}><input className="input-field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label={t('dash.hr.email', 'Email')}><input className="input-field" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-sunken/40 p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">{t('dash.hr.loginAccount', 'Login account')}</p>
          <p className="text-xs text-text-muted">{t('dash.hr.linkUserTitle', 'Link a login so POS + scoping follow this employee’s schedule')}</p>
        </div>
        <select className="input-field max-w-[220px]" value={detail.userId ?? ''} onChange={(e) => linkUser(e.target.value)}>
          <option value="">{t('dash.hr.noLoginLinked', 'No login linked')}</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.email || u.name}</option>)}
        </select>
      </div>

      {/* Access role — only when a login is linked; owner assigns granular RBAC here. */}
      {detail.userId && roles && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-sunken/40 p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary">{t('dash.hr.accessRole', 'Access role')}</p>
            <p className="text-xs text-text-muted">{t('dash.hr.accessRoleHint', 'What this employee’s login can do. “Full access” = no restriction.')}</p>
          </div>
          <select className="input-field max-w-[220px]" value={currentRoleId ?? ''} onChange={(e) => assignRole(e.target.value)}>
            <option value="">{t('dash.hr.fullAccess', 'Full access (no custom role)')}</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
      )}

      <p className="text-xs text-text-muted">{t('dash.hr.hiredAt', 'Hire date')}: {fmtDate(detail.hiredAt)} · {t('dash.hr.added', 'Added')}: {fmtDate(detail.createdAt)}</p>
      <div className="flex justify-end"><button className="btn-primary" onClick={save} disabled={saving}>{saving ? <Spinner /> : t('common.save', 'Save changes')}</button></div>
    </div>
  );
}

function AttendanceTab({ detail }: { detail: Detail }) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="card"><p className="text-xs text-text-muted">{t('dash.hr.presentThisMonth', 'Present this month')}</p><p className="mt-1 text-2xl font-bold text-green-600">{detail.attendanceThisMonth.present}</p></div>
        <div className="card"><p className="text-xs text-text-muted">{t('dash.hr.absentThisMonth', 'Absent this month')}</p><p className="mt-1 text-2xl font-bold text-rose-600">{detail.attendanceThisMonth.absent}</p></div>
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <TableWrap>
          <thead><tr className="border-b border-border bg-surface-sunken/50">
            <th className={`${thCls} text-left`}>{t('dash.hr.date', 'Date')}</th>
            <th className={`${thCls} text-left`}>{t('dash.hr.status', 'Status')}</th>
            <th className={`${thCls} text-left`}>{t('dash.hr.in', 'In')}</th>
            <th className={`${thCls} text-left`}>{t('dash.hr.out', 'Out')}</th>
            <th className={`${thCls} text-right`}>{t('dash.hr.hours', 'Hours')}</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {detail.attendance.length === 0 ? <EmptyRow colSpan={5}>{t('dash.hr.noAttendance', 'No attendance records.')}</EmptyRow> : detail.attendance.map((a, i) => (
              <tr key={i}>
                <td className={`${tdCls} text-text-secondary`}>{fmtDate(a.workDate)}</td>
                <td className={tdCls}><StatusBadge status={a.status} /></td>
                <td className={`${tdCls} text-text-secondary`}>{a.checkIn ? new Date(a.checkIn).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                <td className={`${tdCls} text-text-secondary`}>{a.checkOut ? new Date(a.checkOut).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                <td className={`${tdCls} text-right tabular-nums`}>{a.hoursWorked ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </div>
    </div>
  );
}

function ScheduleTab({ detail }: { detail: Detail }) {
  const { t } = useI18n();
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <TableWrap>
        <thead><tr className="border-b border-border bg-surface-sunken/50">
          <th className={`${thCls} text-left`}>{t('dash.hr.date', 'Date')}</th>
          <th className={`${thCls} text-left`}>{t('dash.hr.time', 'Time')}</th>
          <th className={`${thCls} text-left`}>{t('dash.hr.branch', 'Branch')}</th>
          <th className={`${thCls} text-left`}>{t('dash.hr.notes', 'Notes')}</th>
        </tr></thead>
        <tbody className="divide-y divide-border">
          {detail.schedules.length === 0 ? <EmptyRow colSpan={4}>{t('dash.hr.noSchedules', 'No schedules set.')}</EmptyRow> : detail.schedules.map((s) => (
            <tr key={s.id}>
              <td className={`${tdCls} text-text-secondary`}>{fmtDate(s.workDate)}</td>
              <td className={`${tdCls} tabular-nums`}>{s.startTime ? `${s.startTime}–${s.endTime ?? ''}` : '—'}</td>
              <td className={`${tdCls} text-text-secondary`}>{s.outletName || '—'}</td>
              <td className={`${tdCls} text-text-muted`}>{s.notes || '—'}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}

function LeaveTab({ detail }: { detail: Detail }) {
  const { t } = useI18n();
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <TableWrap>
        <thead><tr className="border-b border-border bg-surface-sunken/50">
          <th className={`${thCls} text-left`}>{t('dash.hr.period', 'Period')}</th>
          <th className={`${thCls} text-left`}>{t('dash.hr.leaveType', 'Type')}</th>
          <th className={`${thCls} text-left`}>{t('dash.hr.paidLabel', 'Paid')}</th>
          <th className={`${thCls} text-left`}>{t('dash.hr.status', 'Status')}</th>
        </tr></thead>
        <tbody className="divide-y divide-border">
          {detail.leave.length === 0 ? <EmptyRow colSpan={4}>{t('dash.hr.noLeaveRequests', 'No leave requests.')}</EmptyRow> : detail.leave.map((l) => (
            <tr key={l.id}>
              <td className={`${tdCls} text-text-secondary`}>{fmtDate(l.startDate)} → {fmtDate(l.endDate)}{l.reason ? <span className="block text-xs text-text-muted">{l.reason}</span> : null}</td>
              <td className={`${tdCls} capitalize`}>{l.type}</td>
              <td className={tdCls}>{l.paid ? t('dash.hr.paid', 'Paid') : t('dash.hr.unpaid', 'Unpaid')}</td>
              <td className={tdCls}><StatusBadge status={l.status} /></td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}

function PayrollTab({ detail }: { detail: Detail }) {
  const { t } = useI18n();
  return (
    <div className="space-y-5">
      {/* Loans */}
      <section>
        <h4 className="mb-2 text-sm font-semibold text-text-primary">{t('dash.payroll.loans', 'Loans')}</h4>
        <div className="overflow-hidden rounded-lg border border-border">
          <TableWrap>
            <thead><tr className="border-b border-border bg-surface-sunken/50">
              <th className={`${thCls} text-left`}>{t('dash.payroll.reason', 'Reason')}</th>
              <th className={`${thCls} text-right`}>{t('dash.payroll.principal', 'Principal')}</th>
              <th className={`${thCls} text-right`}>{t('dash.payroll.balAbbr', 'Balance')}</th>
              <th className={`${thCls} text-right`}>{t('dash.payroll.installment', 'Installment')}</th>
              <th className={`${thCls} text-left`}>{t('dash.hr.status', 'Status')}</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {detail.loans.length === 0 ? <EmptyRow colSpan={5}>{t('dash.payroll.noLoans', 'No loans.')}</EmptyRow> : detail.loans.map((l) => (
                <tr key={l.id}>
                  <td className={tdCls}>{l.reason || '—'}</td>
                  <td className={`${tdCls} text-right tabular-nums`}>{fmtIDR(l.principal)}</td>
                  <td className={`${tdCls} text-right tabular-nums font-medium`}>{fmtIDR(l.balance)}</td>
                  <td className={`${tdCls} text-right tabular-nums text-text-secondary`}>{fmtIDR(l.monthlyInstallment)}</td>
                  <td className={tdCls}><StatusBadge status={l.status} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      </section>

      {/* Adjustments */}
      <section>
        <h4 className="mb-2 text-sm font-semibold text-text-primary">{t('dash.payroll.adjustments', 'Adjustments')}</h4>
        <div className="overflow-hidden rounded-lg border border-border">
          <TableWrap>
            <thead><tr className="border-b border-border bg-surface-sunken/50">
              <th className={`${thCls} text-left`}>{t('dash.payroll.type', 'Type')}</th>
              <th className={`${thCls} text-left`}>{t('dash.payroll.period', 'From period')}</th>
              <th className={`${thCls} text-right`}>{t('dash.payroll.amount', 'Amount')}</th>
              <th className={`${thCls} text-left`}>{t('dash.payroll.recurrence', 'Recurrence')}</th>
              <th className={`${thCls} text-left`}>{t('dash.hr.status', 'Status')}</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {detail.adjustments.length === 0 ? <EmptyRow colSpan={5}>{t('dash.payroll.noAdjustments', 'No adjustments yet.')}</EmptyRow> : detail.adjustments.map((a) => (
                <tr key={a.id}>
                  <td className={`${tdCls} capitalize`}>{a.type}{a.reason ? <span className="block text-xs text-text-muted">{a.reason}</span> : null}</td>
                  <td className={`${tdCls} text-text-secondary`}>{a.period}</td>
                  <td className={`${tdCls} text-right tabular-nums ${a.type === 'bonus' ? 'text-green-600' : 'text-rose-600'}`}>{fmtIDR(a.amount)}</td>
                  <td className={`${tdCls} text-text-secondary`}>{a.recurring ? `${a.appliedCount}/${a.totalPeriods ?? '∞'} ${t('dash.payroll.months', 'months')}` : t('dash.payroll.oneOff', 'One-off')}</td>
                  <td className={tdCls}><StatusBadge status={a.status} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      </section>

      {/* Payslip history */}
      <section>
        <h4 className="mb-2 text-sm font-semibold text-text-primary">{t('dash.payroll.payslipHistory', 'Payslip history')}</h4>
        <div className="overflow-hidden rounded-lg border border-border">
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
              {detail.payslips.length === 0 ? <EmptyRow colSpan={6}>{t('dash.payroll.noPayslips', 'No payslips yet.')}</EmptyRow> : detail.payslips.map((p) => (
                <tr key={p.id}>
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
        </div>
      </section>
    </div>
  );
}
