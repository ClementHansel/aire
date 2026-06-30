'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

interface Summary { suppliers: number; openPurchaseOrders: number; openPurchaseValue: number; }
interface Supplier { id: string; name: string; contactName: string | null; phone: string | null; }
interface PO { id: string; poNumber: string; status: string; total: number; supplier: string | null; }

const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

export default function ProcurementPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [pos, setPos] = useState<PO[]>([]);
  const [supForm, setSupForm] = useState({ name: '', contactName: '', phone: '' });
  const [po, setPo] = useState({ supplierId: '', description: '', quantity: '', unitCost: '' });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, sup, p] = await Promise.all([
        api.get<Summary>('/procurement/summary'),
        api.get<Supplier[]>('/procurement/suppliers'),
        api.get<PO[]>('/procurement/purchase-orders'),
      ]);
      setSummary(s); setSuppliers(sup); setPos(p); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const addSupplier = async () => {
    if (!supForm.name.trim()) return;
    try { await api.post('/procurement/suppliers', { name: supForm.name.trim(), contactName: supForm.contactName || undefined, phone: supForm.phone || undefined }); setSupForm({ name: '', contactName: '', phone: '' }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  };
  const createPo = async () => {
    if (!po.description.trim() || !Number(po.quantity) || !Number(po.unitCost)) return;
    try {
      await api.post('/procurement/purchase-orders', {
        supplierId: po.supplierId || undefined,
        items: [{ description: po.description.trim(), quantity: Number(po.quantity), unitCost: Number(po.unitCost) }],
      });
      setPo({ supplierId: '', description: '', quantity: '', unitCost: '' });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  };
  const receive = async (id: string) => { try { await api.post(`/procurement/purchase-orders/${id}/receive`); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <h1 className="text-xl font-semibold text-text-primary">Procurement</h1>
      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
      <div className="grid grid-cols-3 gap-4">
        <div className="card"><p className="text-xs text-text-muted">Suppliers</p><p className="text-2xl font-semibold">{summary?.suppliers ?? 0}</p></div>
        <div className="card"><p className="text-xs text-text-muted">Open POs</p><p className="text-2xl font-semibold">{summary?.openPurchaseOrders ?? 0}</p></div>
        <div className="card"><p className="text-xs text-text-muted">Open value</p><p className="text-2xl font-semibold">{fmt(summary?.openPurchaseValue ?? 0)}</p></div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="section-title mb-3">Add supplier</h2>
          <div className="grid grid-cols-3 gap-2">
            <input className="input-field" placeholder="Name *" value={supForm.name} onChange={(e) => setSupForm({ ...supForm, name: e.target.value })} />
            <input className="input-field" placeholder="Contact" value={supForm.contactName} onChange={(e) => setSupForm({ ...supForm, contactName: e.target.value })} />
            <input className="input-field" placeholder="Phone" value={supForm.phone} onChange={(e) => setSupForm({ ...supForm, phone: e.target.value })} />
          </div>
          <button className="btn-primary mt-2 w-full" onClick={addSupplier}>Add supplier</button>
        </div>
        <div className="card">
          <h2 className="section-title mb-3">Create purchase order</h2>
          <select className="input-field mb-2" value={po.supplierId} onChange={(e) => setPo({ ...po, supplierId: e.target.value })}>
            <option value="">No supplier</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <div className="grid grid-cols-3 gap-2">
            <input className="input-field" placeholder="Item description *" value={po.description} onChange={(e) => setPo({ ...po, description: e.target.value })} />
            <input className="input-field" type="number" placeholder="Qty *" value={po.quantity} onChange={(e) => setPo({ ...po, quantity: e.target.value })} />
            <input className="input-field" type="number" placeholder="Unit cost *" value={po.unitCost} onChange={(e) => setPo({ ...po, unitCost: e.target.value })} />
          </div>
          <button className="btn-primary mt-2 w-full" onClick={createPo}>Create PO</button>
        </div>
      </div>

      <div className="card">
        <h2 className="section-title mb-3">Purchase orders</h2>
        <div className="space-y-1.5 max-h-96 overflow-auto">
          {pos.map((p) => (
            <div key={p.id} className="flex items-center justify-between text-sm border-b border-border py-2">
              <span className="text-text-primary font-mono">{p.poNumber}<span className="text-text-muted">{p.supplier ? ` · ${p.supplier}` : ''} · {fmt(p.total)}</span></span>
              <span className="flex items-center gap-2">
                <span className="badge bg-surface-sunken text-text-secondary capitalize">{p.status}</span>
                {p.status === 'ordered' && <button className="btn-ghost text-xs text-green-600" onClick={() => receive(p.id)}>Receive</button>}
              </span>
            </div>
          ))}
          {pos.length === 0 && <p className="text-sm text-text-muted">No purchase orders yet.</p>}
        </div>
      </div>
    </div>
  );
}
