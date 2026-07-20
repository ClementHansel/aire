'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Home, CalendarDays, Clock, FileText, Plane, Wallet, User, LogOut, LogIn, CheckCircle2,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { getUser, isAuthenticated, logout } from '@/lib/auth';
import { useI18n, LanguageToggle } from '@/lib/i18n';
import { LEAN_MODE } from '@aire/shared';

// ─── Types (mirror the /api/me responses) ────────────────────────────────────
interface EmployeeProfile {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  salary: number;
  status: string;
  hiredAt: string | null;
  employmentType: string;
  outletName: string | null;
}
interface TodaySchedule { startTime: string | null; endTime: string | null; notes: string | null; outletName: string | null }
interface TodayAttendance { checkIn: string | null; checkOut: string | null; status: string; hoursWorked: number | null }
interface HomeResp { employee: EmployeeProfile; todaySchedule: TodaySchedule | null; todayAttendance: TodayAttendance | null }
interface ScheduleRow { id: string; workDate: string; startTime: string | null; endTime: string | null; notes: string | null; outletName: string | null }
interface AttendanceRow { workDate: string; checkIn: string | null; checkOut: string | null; status: string; hoursWorked: number | null }
interface LeaveRow { id: string; startDate: string; endDate: string; type: string; reason: string | null; status: string; paid: boolean }
interface Repayment { amount: number; period: string | null; method: string; createdAt: string }
interface LoanRow { id: string; principal: number; balance: number; monthlyInstallment: number; reason: string | null; status: string; createdAt: string; repayments: Repayment[] }
interface PayslipSummary { id: string; period: string; finalizedAt: string | null }
interface PayslipDetail extends PayslipSummary {
  employeeName: string; baseSalary: number; scheduledDays: number; daysWorked: number; unpaidLeaveDays: number;
  bonusTotal: number; deductionTotal: number; advanceTotal: number; loanRepaymentTotal: number;
  unpaidLeaveDeduction: number; grossPay: number; netPay: number;
}

type Tab = 'home' | 'schedule' | 'attendance' | 'payslips' | 'leave' | 'loans' | 'profile';

const fmtIDR = (n: number | null | undefined) => `Rp ${Number(n ?? 0).toLocaleString('id-ID')}`;
const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fmtTime = (s: string | null | undefined) => {
  if (!s) return '—';
  // start_time/end_time come as "HH:MM:SS"; timestamps as ISO.
  if (/^\d{2}:\d{2}/.test(s)) return s.slice(0, 5);
  const d = new Date(s);
  return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
};

const LEAVE_BADGE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700', approved: 'bg-emerald-50 text-emerald-700', rejected: 'bg-rose-50 text-rose-700',
};

export default function EmployeePage() {
  const { t } = useI18n();
  const [checked, setChecked] = useState(false);
  const [tab, setTab] = useState<Tab>('home');
  const [home, setHome] = useState<HomeResp | null>(null);
  const [notLinked, setNotLinked] = useState(false);
  const [loadErr, setLoadErr] = useState('');

  const loadHome = useCallback(async () => {
    try {
      const h = await api.get<HomeResp>('/me/home');
      setHome(h); setNotLinked(false); setLoadErr('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) { setNotLinked(true); return; }
      setLoadErr(e instanceof Error ? e.message : 'Failed to load');
    }
  }, []);

  useEffect(() => {
    // Employee self-service is held while lean — a cashier logs straight into POS
    // and owners/admins use the dashboard. Send anyone here back to the hub.
    if (LEAN_MODE) { window.location.href = '/hub'; return; }
    if (!isAuthenticated()) { window.location.href = '/'; return; }
    setChecked(true);
    loadHome();
  }, [loadHome]);

  if (!checked) {
    return <div className="min-h-screen bg-surface flex items-center justify-center text-text-muted">{t('emp.loading', 'Loading…')}</div>;
  }

  if (notLinked) {
    const u = getUser();
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-6 text-center">
        <User className="w-12 h-12 text-text-muted mb-4" />
        <h1 className="text-xl font-bold text-text-primary">{t('emp.notLinked.title', 'No employee record')}</h1>
        <p className="text-sm text-text-muted mt-2 max-w-sm">
          {t('emp.notLinked.body', 'Your login is not linked to an employee record yet. Ask your manager to link your account in HR.')}
        </p>
        {u?.name && <p className="text-xs text-text-muted mt-3">{u.name} · {u.role?.replace(/_/g, ' ')}</p>}
        <button onClick={logout} className="btn-secondary mt-6">{t('emp.signOut', 'Sign out')}</button>
      </div>
    );
  }

  const NAV: { key: Tab; label: string; icon: typeof Home }[] = [
    { key: 'home', label: t('emp.nav.home', 'Home'), icon: Home },
    { key: 'schedule', label: t('emp.nav.schedule', 'Schedule'), icon: CalendarDays },
    { key: 'attendance', label: t('emp.nav.attendance', 'Attendance'), icon: Clock },
    { key: 'payslips', label: t('emp.nav.payslips', 'Payslips'), icon: FileText },
    { key: 'leave', label: t('emp.nav.leave', 'Leave'), icon: Plane },
    { key: 'loans', label: t('emp.nav.loans', 'Loans'), icon: Wallet },
    { key: 'profile', label: t('emp.nav.profile', 'Profile'), icon: User },
  ];
  const MOBILE_KEYS: Tab[] = ['home', 'schedule', 'payslips', 'leave', 'profile'];
  const mobileNav = NAV.filter((n) => MOBILE_KEYS.includes(n.key));
  const emp = home?.employee;

  return (
    <div className="min-h-screen bg-surface flex flex-col md:flex-row">
      {/* Desktop side rail */}
      <aside className="hidden md:flex md:w-60 md:flex-col md:border-r md:border-border bg-surface-raised p-4 gap-1">
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center justify-center w-9 h-9 bg-primary-500 rounded-xl text-white font-bold">A</span>
          <span className="font-semibold text-text-primary">{t('emp.title', 'My Work')}</span>
        </div>
        <nav className="mt-2 flex flex-col gap-1">
          {NAV.map((n) => (
            <button key={n.key} onClick={() => setTab(n.key)} className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-left transition-colors ${tab === n.key ? 'bg-primary-500 text-white' : 'text-text-secondary hover:bg-surface-sunken'}`}>
              <n.icon className="w-4 h-4" />{n.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto flex items-center justify-between pt-4">
          <LanguageToggle />
          <button onClick={logout} className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary"><LogOut className="w-3.5 h-3.5" />{t('emp.signOut', 'Sign out')}</button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-surface-raised sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-8 h-8 bg-primary-500 rounded-lg text-white font-bold">A</span>
          <span className="font-semibold text-text-primary">{emp?.name?.split(' ')[0] ?? t('emp.title', 'My Work')}</span>
        </div>
        <div className="flex items-center gap-2">
          <LanguageToggle />
          <button onClick={logout} aria-label={t('emp.signOut', 'Sign out')} className="text-text-muted"><LogOut className="w-4 h-4" /></button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 p-4 md:p-8 pb-24 md:pb-8 max-w-3xl w-full mx-auto">
        {loadErr && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{loadErr}</div>}
        {tab === 'home' && home && <HomeView home={home} onChange={loadHome} go={setTab} />}
        {tab === 'schedule' && <ScheduleView />}
        {tab === 'attendance' && <AttendanceView />}
        {tab === 'payslips' && <PayslipsView />}
        {tab === 'leave' && <LeaveView />}
        {tab === 'loans' && <LoansView />}
        {tab === 'profile' && emp && <ProfileView emp={emp} />}
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-10 grid grid-cols-5 border-t border-border bg-surface-raised">
        {mobileNav.map((n) => (
          <button key={n.key} onClick={() => setTab(n.key)} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${tab === n.key ? 'text-primary-600' : 'text-text-muted'}`}>
            <n.icon className="w-5 h-5" />{n.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

// ─── Home ─────────────────────────────────────────────────────────────────────
function HomeView({ home, onChange, go }: { home: HomeResp; onChange: () => void; go: (t: Tab) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const { employee: emp, todaySchedule: sched, todayAttendance: att } = home;
  const clockedIn = !!att?.checkIn && !att?.checkOut;
  const clockedOut = !!att?.checkOut;

  const doClock = async (dir: 'in' | 'out') => {
    setBusy(true); setErr('');
    try {
      await api.post(`/me/clock-${dir}`);
      onChange();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">{t('emp.home.hello', 'Hi')}, {emp.name.split(' ')[0]}</h1>
        <p className="text-xs text-text-muted mt-0.5 capitalize">{emp.role || t('emp.home.staff', 'Staff')}{emp.outletName ? ` · ${emp.outletName}` : ''}</p>
      </div>

      {/* Today's shift + clock */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-text-muted">{t('emp.home.todayShift', "Today's shift")}</p>
            <p className="text-lg font-semibold text-text-primary">
              {sched ? `${fmtTime(sched.startTime)} – ${fmtTime(sched.endTime)}` : t('emp.home.noShift', 'Not scheduled')}
            </p>
            {sched?.outletName && <p className="text-xs text-text-muted">{sched.outletName}</p>}
          </div>
          {att && (
            <span className={`badge capitalize ${clockedOut ? 'bg-slate-100 text-slate-600' : clockedIn ? 'bg-emerald-50 text-emerald-700' : 'bg-surface-sunken text-text-secondary'}`}>
              {clockedOut ? t('emp.home.done', 'Done') : clockedIn ? t('emp.home.onShift', 'On shift') : att.status}
            </span>
          )}
        </div>
        {att && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-xs text-text-muted">{t('emp.home.in', 'Clock in')}</p><p className="font-medium">{fmtTime(att.checkIn)}</p></div>
            <div><p className="text-xs text-text-muted">{t('emp.home.out', 'Clock out')}</p><p className="font-medium">{fmtTime(att.checkOut)}{att.hoursWorked != null ? ` · ${att.hoursWorked}h` : ''}</p></div>
          </div>
        )}
        {err && <p className="text-sm text-red-600">{err}</p>}
        {clockedOut ? (
          <div className="flex items-center justify-center gap-2 text-sm text-emerald-700 py-1"><CheckCircle2 className="w-4 h-4" />{t('emp.home.clockedOut', "You're clocked out for today.")}</div>
        ) : clockedIn ? (
          <button className="btn-primary w-full flex items-center justify-center gap-2" onClick={() => doClock('out')} disabled={busy}><LogOut className="w-4 h-4" />{busy ? '…' : t('emp.home.clockOut', 'Clock out')}</button>
        ) : (
          <button className="btn-primary w-full flex items-center justify-center gap-2" onClick={() => doClock('in')} disabled={busy}><LogIn className="w-4 h-4" />{busy ? '…' : t('emp.home.clockIn', 'Clock in')}</button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => go('payslips')} className="card flex items-center gap-3 hover:border-primary-300 text-left">
          <FileText className="w-5 h-5 text-primary-600" /><p className="text-sm font-medium text-text-primary">{t('emp.nav.payslips', 'Payslips')}</p>
        </button>
        <button onClick={() => go('leave')} className="card flex items-center gap-3 hover:border-primary-300 text-left">
          <Plane className="w-5 h-5 text-primary-600" /><p className="text-sm font-medium text-text-primary">{t('emp.nav.leave', 'Leave')}</p>
        </button>
        <button onClick={() => go('schedule')} className="card flex items-center gap-3 hover:border-primary-300 text-left">
          <CalendarDays className="w-5 h-5 text-primary-600" /><p className="text-sm font-medium text-text-primary">{t('emp.nav.schedule', 'Schedule')}</p>
        </button>
        <button onClick={() => go('loans')} className="card flex items-center gap-3 hover:border-primary-300 text-left">
          <Wallet className="w-5 h-5 text-primary-600" /><p className="text-sm font-medium text-text-primary">{t('emp.nav.loans', 'Loans')}</p>
        </button>
      </div>
    </div>
  );
}

// ─── Schedule ───────────────────────────────────────────────────────────────
function ScheduleView() {
  const { t } = useI18n();
  const [rows, setRows] = useState<ScheduleRow[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const today = new Date();
    const to = new Date(today); to.setDate(to.getDate() + 45);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    api.get<ScheduleRow[]>(`/me/schedule?from=${iso(today)}&to=${iso(to)}`).then(setRows).catch((e) => setErr(e instanceof Error ? e.message : 'Failed'));
  }, []);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-text-primary">{t('emp.schedule.title', 'My schedule')}</h1>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {!rows ? <p className="text-sm text-text-muted">{t('emp.loading', 'Loading…')}</p> : rows.length === 0 ? (
        <p className="text-sm text-text-muted">{t('emp.schedule.none', 'No upcoming shifts scheduled.')}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="card flex items-center justify-between">
              <div>
                <p className="font-medium text-text-primary">{fmtDate(r.workDate)}</p>
                {r.notes && <p className="text-xs text-text-muted">{r.notes}</p>}
              </div>
              <div className="text-right text-sm">
                <p className="font-medium text-text-primary">{fmtTime(r.startTime)} – {fmtTime(r.endTime)}</p>
                {r.outletName && <p className="text-xs text-text-muted">{r.outletName}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Attendance ─────────────────────────────────────────────────────────────
function AttendanceView() {
  const { t } = useI18n();
  const [rows, setRows] = useState<AttendanceRow[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api.get<AttendanceRow[]>('/me/attendance').then(setRows).catch((e) => setErr(e instanceof Error ? e.message : 'Failed'));
  }, []);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-text-primary">{t('emp.attendance.title', 'Attendance history')}</h1>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {!rows ? <p className="text-sm text-text-muted">{t('emp.loading', 'Loading…')}</p> : rows.length === 0 ? (
        <p className="text-sm text-text-muted">{t('emp.attendance.none', 'No attendance records yet.')}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="card flex items-center justify-between">
              <div>
                <p className="font-medium text-text-primary">{fmtDate(r.workDate)}</p>
                <p className="text-xs text-text-muted capitalize">{r.status}</p>
              </div>
              <div className="text-right text-sm">
                <p className="text-text-primary">{fmtTime(r.checkIn)} → {fmtTime(r.checkOut)}</p>
                {r.hoursWorked != null && <p className="text-xs text-text-muted">{r.hoursWorked}h</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Payslips ─────────────────────────────────────────────────────────────
function PayslipsView() {
  const { t } = useI18n();
  const [rows, setRows] = useState<PayslipSummary[] | null>(null);
  const [open, setOpen] = useState<PayslipDetail | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api.get<PayslipSummary[]>('/me/payslips').then(setRows).catch((e) => setErr(e instanceof Error ? e.message : 'Failed'));
  }, []);
  const view = async (id: string) => {
    try { setOpen(await api.get<PayslipDetail>(`/me/payslips/${id}`)); } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  };
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-text-primary">{t('emp.payslips.title', 'My payslips')}</h1>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {!rows ? <p className="text-sm text-text-muted">{t('emp.loading', 'Loading…')}</p> : rows.length === 0 ? (
        <p className="text-sm text-text-muted">{t('emp.payslips.none', 'No finalized payslips yet.')}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <button key={r.id} onClick={() => view(r.id)} className="card w-full flex items-center justify-between hover:border-primary-300 text-left">
              <div><p className="font-medium text-text-primary">{r.period}</p><p className="text-xs text-text-muted">{t('emp.payslips.finalized', 'Finalized')} {fmtDate(r.finalizedAt)}</p></div>
              <FileText className="w-5 h-5 text-primary-600" />
            </button>
          ))}
        </div>
      )}
      {open && <PayslipModal slip={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function PayslipModal({ slip, onClose }: { slip: PayslipDetail; onClose: () => void }) {
  const { t } = useI18n();
  const Row = ({ label, value, strong, negative }: { label: string; value: number; strong?: boolean; negative?: boolean }) => (
    <div className={`flex items-center justify-between py-1.5 text-sm ${strong ? 'font-semibold text-text-primary' : 'text-text-secondary'}`}>
      <span>{label}</span><span>{negative && value > 0 ? '− ' : ''}{fmtIDR(value)}</span>
    </div>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-0 md:p-4" onClick={onClose}>
      <div className="bg-surface-raised w-full max-w-md rounded-t-2xl md:rounded-2xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div><h2 className="text-lg font-bold text-text-primary">{t('emp.payslips.title', 'Payslip')} · {slip.period}</h2><p className="text-xs text-text-muted">{fmtDate(slip.finalizedAt)}</p></div>
          <button onClick={onClose} className="text-text-muted text-xl leading-none">×</button>
        </div>
        <div className="divide-y divide-border">
          <Row label={t('emp.payslips.base', 'Base salary')} value={slip.baseSalary} />
          <Row label={`${t('emp.payslips.daysWorked', 'Days worked')}`} value={slip.daysWorked} />
          <Row label={t('emp.payslips.bonus', 'Bonus')} value={slip.bonusTotal} />
          <Row label={t('emp.payslips.deduction', 'Deductions')} value={slip.deductionTotal} negative />
          <Row label={t('emp.payslips.advance', 'Advance')} value={slip.advanceTotal} negative />
          <Row label={t('emp.payslips.loan', 'Loan repayment')} value={slip.loanRepaymentTotal} negative />
          <Row label={t('emp.payslips.unpaidLeave', 'Unpaid leave')} value={slip.unpaidLeaveDeduction} negative />
          <Row label={t('emp.payslips.gross', 'Gross pay')} value={slip.grossPay} strong />
          <Row label={t('emp.payslips.net', 'Net pay')} value={slip.netPay} strong />
        </div>
      </div>
    </div>
  );
}

// ─── Leave ─────────────────────────────────────────────────────────────────
function LeaveView() {
  const { t } = useI18n();
  const [rows, setRows] = useState<LeaveRow[] | null>(null);
  const [form, setForm] = useState({ startDate: '', endDate: '', type: 'annual', reason: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(() => { api.get<LeaveRow[]>('/me/leave').then(setRows).catch((e) => setErr(e instanceof Error ? e.message : 'Failed')); }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!form.startDate || !form.endDate) { setErr(t('emp.leave.needDates', 'Choose a start and end date.')); return; }
    setBusy(true); setErr(''); setMsg('');
    try {
      await api.post('/me/leave', form);
      setMsg(t('emp.leave.submitted', 'Leave request submitted for approval.'));
      setForm({ startDate: '', endDate: '', type: 'annual', reason: '' });
      load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-text-primary">{t('emp.leave.title', 'Leave')}</h1>
      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700">{err}</div>}
      {msg && <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 text-sm text-emerald-800">{msg}</div>}
      <div className="card space-y-3">
        <p className="section-title">{t('emp.leave.request', 'Request leave')}</p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-text-secondary mb-1">{t('emp.leave.from', 'From')}</label><input type="date" className="input-field" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div>
          <div><label className="block text-xs font-medium text-text-secondary mb-1">{t('emp.leave.to', 'To')}</label><input type="date" className="input-field" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></div>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">{t('emp.leave.type', 'Type')}</label>
          <select aria-label={t('emp.leave.type', 'Type')} className="input-field" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="annual">{t('emp.leave.annual', 'Annual')}</option>
            <option value="sick">{t('emp.leave.sick', 'Sick')}</option>
            <option value="unpaid">{t('emp.leave.unpaid', 'Unpaid')}</option>
            <option value="other">{t('emp.leave.other', 'Other')}</option>
          </select>
        </div>
        <input className="input-field" placeholder={t('emp.leave.reason', 'Reason (optional)')} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        <button className="btn-primary w-full" onClick={submit} disabled={busy}>{busy ? t('emp.leave.submitting', 'Submitting…') : t('emp.leave.submit', 'Submit request')}</button>
      </div>
      <div>
        <h2 className="section-title mb-2">{t('emp.leave.mine', 'My requests')}</h2>
        {!rows ? <p className="text-sm text-text-muted">{t('emp.loading', 'Loading…')}</p> : rows.length === 0 ? (
          <p className="text-sm text-text-muted">{t('emp.leave.none', 'No leave requests yet.')}</p>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.id} className="card flex items-center justify-between">
                <div>
                  <p className="font-medium text-text-primary text-sm">{fmtDate(r.startDate)} → {fmtDate(r.endDate)}</p>
                  <p className="text-xs text-text-muted capitalize">{r.type}{r.paid ? '' : ` · ${t('emp.leave.unpaidTag', 'unpaid')}`}{r.reason ? ` · ${r.reason}` : ''}</p>
                </div>
                <span className={`badge capitalize ${LEAVE_BADGE[r.status] ?? 'bg-surface-sunken text-text-secondary'}`}>{r.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Loans ─────────────────────────────────────────────────────────────────
function LoansView() {
  const { t } = useI18n();
  const [rows, setRows] = useState<LoanRow[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.get<LoanRow[]>('/me/loans').then(setRows).catch((e) => setErr(e instanceof Error ? e.message : 'Failed')); }, []);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-text-primary">{t('emp.loans.title', 'My loans')}</h1>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {!rows ? <p className="text-sm text-text-muted">{t('emp.loading', 'Loading…')}</p> : rows.length === 0 ? (
        <p className="text-sm text-text-muted">{t('emp.loans.none', 'No loans on record.')}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((l) => (
            <div key={l.id} className="card space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-text-primary">{fmtIDR(l.balance)} <span className="text-xs text-text-muted font-normal">/ {fmtIDR(l.principal)}</span></p>
                  <p className="text-xs text-text-muted">{l.reason || t('emp.loans.loan', 'Loan')} · {t('emp.loans.installment', 'installment')} {fmtIDR(l.monthlyInstallment)}</p>
                </div>
                <span className={`badge capitalize ${l.status === 'paid' ? 'bg-emerald-50 text-emerald-700' : l.status === 'active' ? 'bg-sky-50 text-sky-700' : 'bg-surface-sunken text-text-secondary'}`}>{l.status}</span>
              </div>
              {l.repayments.length > 0 && (
                <div className="border-t border-border pt-2 space-y-1">
                  {l.repayments.slice(0, 6).map((rp, i) => (
                    <div key={i} className="flex items-center justify-between text-xs text-text-muted">
                      <span>{rp.period || fmtDate(rp.createdAt)} · {rp.method}</span><span>{fmtIDR(rp.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Profile ─────────────────────────────────────────────────────────────
function ProfileView({ emp }: { emp: EmployeeProfile }) {
  const { t } = useI18n();
  const Item = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
      <span className="text-sm text-text-muted">{label}</span><span className="text-sm font-medium text-text-primary text-right">{value}</span>
    </div>
  );
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-text-primary">{t('emp.profile.title', 'My profile')}</h1>
      <div className="card">
        <div className="flex items-center gap-3 pb-3 border-b border-border mb-1">
          <span className="inline-flex items-center justify-center w-12 h-12 bg-primary-100 text-primary-700 rounded-full text-lg font-bold">{emp.name.charAt(0)}</span>
          <div><p className="font-semibold text-text-primary">{emp.name}</p><p className="text-xs text-text-muted capitalize">{emp.role || t('emp.home.staff', 'Staff')}</p></div>
        </div>
        <Item label={t('emp.profile.status', 'Status')} value={emp.status} />
        <Item label={t('emp.profile.employment', 'Employment')} value={emp.employmentType} />
        <Item label={t('emp.profile.branch', 'Branch')} value={emp.outletName || '—'} />
        <Item label={t('emp.profile.hired', 'Hired')} value={fmtDate(emp.hiredAt)} />
        <Item label={t('emp.profile.phone', 'Phone')} value={emp.phone || '—'} />
        <Item label={t('emp.profile.email', 'Email')} value={emp.email || '—'} />
      </div>
      {/* Salary — self-only. Never exposed to other employees; management-wide
          salary access stays behind the HR/payroll (owner/HR/finance) screens. */}
      <div className="card">
        <p className="section-title mb-1">{t('emp.profile.compensation', 'Compensation')}</p>
        <Item label={t('emp.profile.baseSalary', 'Base salary')} value={fmtIDR(emp.salary)} />
        <p className="text-xs text-text-muted mt-2">{t('emp.profile.salaryNote', 'Only you can see your salary here. See Payslips for monthly take-home.')}</p>
      </div>
    </div>
  );
}
