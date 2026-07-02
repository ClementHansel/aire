'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import BranchFilter from '@/components/dashboard/BranchFilter';

interface Summary { windowDays: number; revenue: number; expenses: number; netProfit: number; expensesByCategory: { category: string; total: number }[]; }
interface Expense { id: string; category: string; description: string | null; amount: number; date: string; }

const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

export default function FinancePage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [form, setForm] = useState({ category: '', amount: '', description: '' });
  const [branch, setBranch] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const bq = branch ? `?outletId=${branch}` : '';
      const [s, e] = await Promise.all([api.get<Summary>(`/finance/summary${bq}`), api.get<Expense[]>(`/finance/expenses${bq}`)]);
      setSummary(s); setExpenses(e); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load'); }
  }, [branch]);
  useEffect(() => { load(); }, [load]);

  const record = async () => {
    if (!form.category.trim() || !Number(form.amount)) return;
    setSaving(true); setError('');
    try {
      await api.post('/finance/expenses', { category: form.category.trim(), amount: Number(form.amount), description: form.description || undefined });
      setForm({ category: '', amount: '', description: '' });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to record'); } finally { setSaving(false); }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-semibold text-text-primary">Finance</h1>
        <BranchFilter value={branch} onChange={setBranch} />
      </div>
      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
      <div className="grid grid-cols-3 gap-4">
        <div className="card"><p className="text-xs text-text-muted">Revenue ({summary?.windowDays ?? 30}d)</p><p className="text-2xl font-semibold text-green-600">{fmt(summary?.revenue ?? 0)}</p></div>
        <div className="card"><p className="text-xs text-text-muted">Expenses</p><p className="text-2xl font-semibold text-red-600">{fmt(summary?.expenses ?? 0)}</p></div>
        <div className="card"><p className="text-xs text-text-muted">Net profit</p><p className={`text-2xl font-semibold ${(summary?.netProfit ?? 0) >= 0 ? 'text-text-primary' : 'text-red-600'}`}>{fmt(summary?.netProfit ?? 0)}</p></div>
      </div>

      <div className="card">
        <h2 className="section-title mb-3">Record expense</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <input className="input-field" placeholder="Category *" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <input className="input-field" type="number" placeholder="Amount *" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <input className="input-field" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <button className="btn-primary" onClick={record} disabled={saving}>{saving ? 'Saving…' : 'Record'}</button>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="section-title mb-3">Recent expenses</h2>
          <div className="space-y-1.5 max-h-80 overflow-auto">
            {expenses.map((e) => (
              <div key={e.id} className="flex justify-between text-sm border-b border-border py-1.5">
                <span className="text-text-primary">{e.category}<span className="text-text-muted">{e.description ? ` · ${e.description}` : ''}</span></span>
                <span className="font-medium text-red-600">{fmt(e.amount)}</span>
              </div>
            ))}
            {expenses.length === 0 && <p className="text-sm text-text-muted">No expenses yet.</p>}
          </div>
        </div>
        <div className="card">
          <h2 className="section-title mb-3">By category</h2>
          <div className="space-y-1.5">
            {(summary?.expensesByCategory ?? []).map((c) => (
              <div key={c.category} className="flex justify-between text-sm"><span className="text-text-primary">{c.category}</span><span className="text-text-secondary">{fmt(c.total)}</span></div>
            ))}
            {(summary?.expensesByCategory ?? []).length === 0 && <p className="text-sm text-text-muted">No data.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
