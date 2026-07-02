'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import BranchFilter from '@/components/dashboard/BranchFilter';

interface Item { id: string; sku: string | null; name: string; category: string | null; unit: string; quantity: number; reorderLevel: number; unitCost: number; }
interface Summary { totalItems: number; lowStockItems: number; stockValue: number; }

const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

export default function InventoryPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', sku: '', category: '', unit: 'pcs', quantity: '', reorderLevel: '', unitCost: '' });
  const [branch, setBranch] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const bq = branch ? `?outletId=${branch}` : '';
      const [s, i] = await Promise.all([api.get<Summary>(`/inventory/summary${bq}`), api.get<Item[]>(`/inventory/items${bq}`)]);
      setSummary(s); setItems(i); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
  }, [branch]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!form.name.trim()) return;
    setSaving(true); setError('');
    try {
      await api.post('/inventory/items', {
        name: form.name.trim(), sku: form.sku || undefined, category: form.category || undefined, unit: form.unit,
        quantity: Number(form.quantity) || 0, reorderLevel: Number(form.reorderLevel) || 0, unitCost: Number(form.unitCost) || 0,
      });
      setForm({ name: '', sku: '', category: '', unit: 'pcs', quantity: '', reorderLevel: '', unitCost: '' });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to create'); } finally { setSaving(false); }
  };

  const adjust = async (id: string, type: 'in' | 'out') => {
    const qtyStr = window.prompt(`Quantity to ${type === 'in' ? 'add' : 'remove'}?`);
    if (!qtyStr) return;
    try { await api.post(`/inventory/items/${id}/adjust`, { type, quantity: Number(qtyStr), reason: 'Manual adjustment' }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to adjust'); }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-semibold text-text-primary">Inventory</h1>
        <BranchFilter value={branch} onChange={setBranch} />
      </div>
      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
      <div className="grid grid-cols-3 gap-4">
        <div className="card"><p className="text-xs text-text-muted">Items</p><p className="text-2xl font-semibold">{summary?.totalItems ?? 0}</p></div>
        <div className="card"><p className="text-xs text-text-muted">Low stock</p><p className="text-2xl font-semibold text-amber-600">{summary?.lowStockItems ?? 0}</p></div>
        <div className="card"><p className="text-xs text-text-muted">Stock value</p><p className="text-2xl font-semibold">{fmt(summary?.stockValue ?? 0)}</p></div>
      </div>

      <div className="card">
        <h2 className="section-title mb-3">Add item</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <input className="input-field" placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input-field" placeholder="SKU" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          <input className="input-field" placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <input className="input-field" placeholder="Unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          <input className="input-field" type="number" placeholder="Qty" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
          <input className="input-field" type="number" placeholder="Reorder level" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} />
          <input className="input-field" type="number" placeholder="Unit cost" value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} />
          <button className="btn-primary" onClick={create} disabled={saving}>{saving ? 'Saving…' : 'Add'}</button>
        </div>
      </div>

      <div className="card">
        <h2 className="section-title mb-3">Items</h2>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-text-muted border-b border-border"><th className="py-2">Name</th><th>Category</th><th>Qty</th><th>Reorder</th><th>Cost</th><th></th></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className={`border-b border-border ${it.quantity <= it.reorderLevel ? 'bg-amber-50' : ''}`}>
                  <td className="py-2 font-medium text-text-primary">{it.name}{it.sku ? <span className="text-text-muted"> · {it.sku}</span> : ''}</td>
                  <td className="text-text-secondary">{it.category ?? '—'}</td>
                  <td>{it.quantity} {it.unit}</td>
                  <td className="text-text-muted">{it.reorderLevel}</td>
                  <td>{fmt(it.unitCost)}</td>
                  <td className="text-right whitespace-nowrap">
                    <button className="btn-ghost text-xs" onClick={() => adjust(it.id, 'in')}>+ In</button>
                    <button className="btn-ghost text-xs" onClick={() => adjust(it.id, 'out')}>− Out</button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={6} className="py-4 text-text-muted text-center">No items yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
