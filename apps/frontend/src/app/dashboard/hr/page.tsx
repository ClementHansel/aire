'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

interface Summary { activeEmployees: number; monthlyPayroll: number; presentToday: number; pendingLeaveRequests: number; }
interface Employee { id: string; name: string; role: string | null; phone: string | null; salary: number; status: string; }
interface Leave { id: string; employee: string; startDate: string; endDate: string; type: string; status: string; }

const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

export default function HrPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leave, setLeave] = useState<Leave[]>([]);
  const [form, setForm] = useState({ name: '', role: '', phone: '', salary: '' });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, e, l] = await Promise.all([api.get<Summary>('/hr/summary'), api.get<Employee[]>('/hr/employees'), api.get<Leave[]>('/hr/leave')]);
      setSummary(s); setEmployees(e); setLeave(l); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const addEmployee = async () => {
    if (!form.name.trim()) return;
    try { await api.post('/hr/employees', { name: form.name.trim(), role: form.role || undefined, phone: form.phone || undefined, salary: Number(form.salary) || 0 }); setForm({ name: '', role: '', phone: '', salary: '' }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  };
  const checkIn = async (id: string) => { try { await api.post(`/hr/employees/${id}/attendance`, { status: 'present', checkIn: new Date().toISOString() }); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } };
  const resolveLeave = async (id: string, status: 'approved' | 'rejected') => { try { await api.patch(`/hr/leave/${id}`, { status }); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <h1 className="text-xl font-semibold text-text-primary">HR</h1>
      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card"><p className="text-xs text-text-muted">Active staff</p><p className="text-2xl font-semibold">{summary?.activeEmployees ?? 0}</p></div>
        <div className="card"><p className="text-xs text-text-muted">Monthly payroll</p><p className="text-2xl font-semibold">{fmt(summary?.monthlyPayroll ?? 0)}</p></div>
        <div className="card"><p className="text-xs text-text-muted">Present today</p><p className="text-2xl font-semibold text-green-600">{summary?.presentToday ?? 0}</p></div>
        <div className="card"><p className="text-xs text-text-muted">Pending leave</p><p className="text-2xl font-semibold text-amber-600">{summary?.pendingLeaveRequests ?? 0}</p></div>
      </div>

      <div className="card">
        <h2 className="section-title mb-3">Add employee</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <input className="input-field" placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input-field" placeholder="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
          <input className="input-field" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <input className="input-field" type="number" placeholder="Salary" value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })} />
          <button className="btn-primary" onClick={addEmployee}>Add</button>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="section-title mb-3">Employees</h2>
          <div className="space-y-1.5 max-h-80 overflow-auto">
            {employees.map((e) => (
              <div key={e.id} className="flex items-center justify-between text-sm border-b border-border py-2">
                <span className="text-text-primary">{e.name}<span className="text-text-muted">{e.role ? ` · ${e.role}` : ''}</span></span>
                <button className="btn-ghost text-xs" onClick={() => checkIn(e.id)}>Check in</button>
              </div>
            ))}
            {employees.length === 0 && <p className="text-sm text-text-muted">No employees yet.</p>}
          </div>
        </div>
        <div className="card">
          <h2 className="section-title mb-3">Leave requests</h2>
          <div className="space-y-1.5 max-h-80 overflow-auto">
            {leave.map((l) => (
              <div key={l.id} className="flex items-center justify-between text-sm border-b border-border py-2">
                <span className="text-text-primary">{l.employee}<span className="text-text-muted"> · {l.startDate}→{l.endDate}</span></span>
                {l.status === 'pending' ? (
                  <span className="flex gap-1">
                    <button className="btn-ghost text-xs text-green-600" onClick={() => resolveLeave(l.id, 'approved')}>Approve</button>
                    <button className="btn-ghost text-xs text-red-600" onClick={() => resolveLeave(l.id, 'rejected')}>Reject</button>
                  </span>
                ) : <span className="badge bg-surface-sunken text-text-secondary capitalize">{l.status}</span>}
              </div>
            ))}
            {leave.length === 0 && <p className="text-sm text-text-muted">No leave requests.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
