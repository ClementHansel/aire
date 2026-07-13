'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { CsvImportModal, exportRows, downloadTemplate, type CsvColumn } from '@/components/dashboard/CsvTools';

interface Summary { suppliers: number; openPurchaseOrders: number; openPurchaseValue: number; }
interface Supplier { id: string; name: string; contactName: string | null; phone: string | null; email: string | null; address: string | null; }
interface PO { id: string; poNumber: string; status: string; total: number; notes: string | null; supplierId: string | null; supplier: string | null; itemCount: number; createdAt: string; receivedAt: string | null; }
interface POLine { id: string; itemId: string | null; itemName: string | null; itemUnit: string | null; description: string; quantity: number; receivedQuantity: number; unitCost: number; subtotal: number; }
interface PODetail { id: string; poNumber: string; status: string; total: number; notes: string | null; supplierId: string | null; supplier: string | null; createdAt: string; receivedAt: string | null; items: POLine[]; }
interface GRN { id: string; poId: string; poNumber: string | null; grnNumber: string; notes: string | null; receivedBy: string | null; receivedAt: string; createdAt: string; lineCount: number; totalQuantity: number; }
interface InvLite { id: string; name: string; unit: string; unitCost: number; }
interface SupplierItem { id: string; name: string; sku: string | null; unit: string; quantity: number; unitCost: number; }
interface SupplierDetail extends Supplier { items: SupplierItem[]; stats: { poCount: number; openPoCount: number; lifetimeValue: number }; }

const fmt = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
type Tab = 'orders' | 'suppliers';

const SUPPLIER_CSV_COLUMNS: CsvColumn[] = [
  { key: 'name', label: 'Name', required: true, example: 'PT Kimia Jaya' },
  { key: 'contact_name', label: 'Contact person', example: 'Budi' },
  { key: 'phone', label: 'Phone', example: '08123456789' },
  { key: 'email', label: 'Email', example: 'sales@kimiajaya.co.id' },
  { key: 'address', label: 'Address', example: 'Jl. Industri No. 5, Jakarta' },
];

function exportSuppliersCsv(suppliers: Supplier[]) {
  const rows = suppliers.map((s) => ({
    name: s.name, contact_name: s.contactName ?? '', phone: s.phone ?? '', email: s.email ?? '', address: s.address ?? '',
  }));
  exportRows('suppliers.csv', rows, SUPPLIER_CSV_COLUMNS);
}

export default function ProcurementPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('orders');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [pos, setPos] = useState<PO[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Modals
  const [poModal, setPoModal] = useState(false);
  const [viewPo, setViewPo] = useState<string | null>(null);
  const [grnPo, setGrnPo] = useState<string | null>(null);
  const [supModal, setSupModal] = useState<Supplier | 'new' | null>(null);
  const [viewSupplier, setViewSupplier] = useState<string | null>(null);
  const [importSup, setImportSup] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, sup, p] = await Promise.all([
        api.get<Summary>('/procurement/summary'),
        api.get<Supplier[]>('/procurement/suppliers'),
        api.get<PO[]>('/procurement/purchase-orders'),
      ]);
      setSummary(s); setSuppliers(sup); setPos(p); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : t('dash.procurement.loadError', 'Failed to load')); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const shownPos = useMemo(() => (statusFilter ? pos.filter((p) => p.status === statusFilter) : pos), [pos, statusFilter]);

  const cancel = async (id: string) => {
    if (!confirm(t('dash.procurement.confirmCancel', 'Cancel this purchase order?'))) return;
    try { await api.post(`/procurement/purchase-orders/${id}/cancel`); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : t('dash.procurement.failed', 'Failed')); }
  };
  const deactivateSupplier = async (s: Supplier) => {
    if (!confirm(t('dash.procurement.confirmSupplierDelete', 'Remove supplier "{name}"?').replace('{name}', s.name))) return;
    try { await api.delete(`/procurement/suppliers/${s.id}`); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : t('dash.procurement.failed', 'Failed')); }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-text-primary mb-1">{t('dash.procurement.title', 'Procurement')}</h1>
          <p className="text-sm text-text-secondary">{t('dash.procurement.subtitle', 'Manage suppliers and raise purchase orders. Receiving a PO restocks any inventory items linked to its lines.')}</p>
        </div>
        {tab === 'orders'
          ? <button className="btn-primary whitespace-nowrap" onClick={() => setPoModal(true)}>{t('dash.procurement.newPo', '+ New purchase order')}</button>
          : (
            <div className="flex items-center gap-2 flex-wrap">
              <button className="btn-secondary whitespace-nowrap" onClick={() => exportSuppliersCsv(suppliers)}>{t('dash.procurement.exportCsv', 'Export')}</button>
              <button className="btn-secondary whitespace-nowrap" onClick={() => downloadTemplate('suppliers-template.csv', SUPPLIER_CSV_COLUMNS)}>{t('dash.procurement.template', 'Template')}</button>
              <button className="btn-secondary whitespace-nowrap" onClick={() => setImportSup(true)}>{t('dash.procurement.importCsv', 'Import')}</button>
              <button className="btn-primary whitespace-nowrap" onClick={() => setSupModal('new')}>{t('dash.procurement.addSupplier', '+ Add supplier')}</button>
            </div>
          )}
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 flex justify-between gap-3"><span>{error}</span><button className="text-red-500" onClick={() => setError('')}>✕</button></div>}

      <div className="grid grid-cols-3 gap-4">
        <Tile label={t('dash.procurement.suppliers', 'Suppliers')} value={String(summary?.suppliers ?? 0)} />
        <Tile label={t('dash.procurement.openPos', 'Open POs')} value={String(summary?.openPurchaseOrders ?? 0)} tone={(summary?.openPurchaseOrders ?? 0) > 0 ? 'amber' : 'default'} />
        <Tile label={t('dash.procurement.openValue', 'Open value')} value={fmt(summary?.openPurchaseValue ?? 0)} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        <TabBtn active={tab === 'orders'} onClick={() => setTab('orders')}>{t('dash.procurement.purchaseOrders', 'Purchase orders')}</TabBtn>
        <TabBtn active={tab === 'suppliers'} onClick={() => setTab('suppliers')}>{t('dash.procurement.suppliers', 'Suppliers')}</TabBtn>
      </div>

      {tab === 'orders' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <select className="input-field py-1.5 w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">{t('dash.procurement.allStatuses', 'All statuses')}</option>
              <option value="ordered">{t('dash.procurement.stOrdered', 'Ordered')}</option>
              <option value="partially_received">{t('dash.procurement.stPartial', 'Partially received')}</option>
              <option value="received">{t('dash.procurement.stReceived', 'Received')}</option>
              <option value="cancelled">{t('dash.procurement.stCancelled', 'Cancelled')}</option>
            </select>
            <span className="text-sm text-text-muted">{shownPos.length} {t('dash.procurement.pos', 'PO(s)')}</span>
          </div>
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-border bg-surface-sunken/50 text-xs font-medium text-text-secondary uppercase">
                  <th className="text-left px-4 py-3">{t('dash.procurement.poNumber', 'PO #')}</th>
                  <th className="text-left px-4 py-3">{t('dash.procurement.supplier', 'Supplier')}</th>
                  <th className="text-right px-4 py-3">{t('dash.procurement.lines', 'Lines')}</th>
                  <th className="text-right px-4 py-3">{t('dash.procurement.total', 'Total')}</th>
                  <th className="text-left px-4 py-3">{t('dash.procurement.created', 'Created')}</th>
                  <th className="text-center px-4 py-3">{t('dash.procurement.status', 'Status')}</th>
                  <th className="px-4 py-3"></th>
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {loading && <tr><td colSpan={7} className="px-4 py-8 text-center text-text-muted text-sm">{t('dash.procurement.loading', 'Loading…')}</td></tr>}
                  {!loading && shownPos.map((p) => (
                    <tr key={p.id} className="hover:bg-surface-sunken/30">
                      <td className="px-4 py-2.5 font-mono text-sm text-text-primary">{p.poNumber}</td>
                      <td className="px-4 py-2.5 text-sm text-text-secondary">{p.supplier ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-sm">{p.itemCount}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-sm font-medium">{fmt(p.total)}</td>
                      <td className="px-4 py-2.5 text-sm text-text-muted whitespace-nowrap">{new Date(p.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-2.5 text-center"><PoBadge status={p.status} t={t} /></td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <button className="btn-ghost text-xs" onClick={() => setViewPo(p.id)}>{t('dash.procurement.view', 'View')}</button>
                        {(p.status === 'ordered' || p.status === 'partially_received' || p.status === 'draft') && <button className="btn-ghost text-xs text-green-600" onClick={() => setGrnPo(p.id)}>{t('dash.procurement.receiveGrn', 'Receive (GRN)')}</button>}
                        {(p.status === 'ordered' || p.status === 'draft') && <button className="btn-ghost text-xs text-rose-600" onClick={() => cancel(p.id)}>{t('dash.procurement.cancel', 'Cancel')}</button>}
                      </td>
                    </tr>
                  ))}
                  {!loading && shownPos.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-text-muted text-sm">{t('dash.procurement.noPos', 'No purchase orders yet.')}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'suppliers' && (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-border bg-surface-sunken/50 text-xs font-medium text-text-secondary uppercase">
                <th className="text-left px-4 py-3">{t('dash.procurement.name', 'Name')}</th>
                <th className="text-left px-4 py-3">{t('dash.procurement.contact', 'Contact')}</th>
                <th className="text-left px-4 py-3">{t('dash.procurement.phone', 'Phone')}</th>
                <th className="text-left px-4 py-3">{t('dash.procurement.email', 'Email')}</th>
                <th className="px-4 py-3"></th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {loading && <tr><td colSpan={5} className="px-4 py-8 text-center text-text-muted text-sm">{t('dash.procurement.loading', 'Loading…')}</td></tr>}
                {!loading && suppliers.map((s) => (
                  <tr key={s.id} className="hover:bg-surface-sunken/30">
                    <td className="px-4 py-2.5"><button className="font-medium text-text-primary hover:text-primary-600 text-left" onClick={() => setViewSupplier(s.id)}>{s.name}</button></td>
                    <td className="px-4 py-2.5 text-sm text-text-secondary">{s.contactName ?? '—'}</td>
                    <td className="px-4 py-2.5 text-sm text-text-secondary">{s.phone ?? '—'}</td>
                    <td className="px-4 py-2.5 text-sm text-text-secondary">{s.email ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <button className="btn-ghost text-xs" onClick={() => setViewSupplier(s.id)}>{t('dash.procurement.view', 'View')}</button>
                      <button className="btn-ghost text-xs" onClick={() => setSupModal(s)}>{t('dash.procurement.edit', 'Edit')}</button>
                      <button className="btn-ghost text-xs text-rose-600" onClick={() => deactivateSupplier(s)}>{t('dash.procurement.remove', 'Remove')}</button>
                    </td>
                  </tr>
                ))}
                {!loading && suppliers.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-text-muted text-sm">{t('dash.procurement.noSuppliers', 'No suppliers yet. Add one to start raising purchase orders.')}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {poModal && <PoModal suppliers={suppliers} onClose={() => setPoModal(false)} onSaved={() => { setPoModal(false); load(); }} />}
      {viewPo && <PoDetailModal poId={viewPo} onClose={() => setViewPo(null)} onReceive={(id) => { setViewPo(null); setGrnPo(id); }} onCancel={cancel} />}
      {grnPo && <GrnModal poId={grnPo} onClose={() => setGrnPo(null)} onSaved={() => { setGrnPo(null); load(); }} />}
      {supModal && <SupplierModal supplier={supModal === 'new' ? null : supModal} onClose={() => setSupModal(null)} onSaved={() => { setSupModal(null); load(); }} />}
      {viewSupplier && <SupplierDetailModal supplierId={viewSupplier} onClose={() => setViewSupplier(null)} onEdit={(s) => { setViewSupplier(null); setSupModal(s); }} />}
      {importSup && (
        <CsvImportModal
          title={t('dash.procurement.importSuppliers', 'Import suppliers from CSV')}
          columns={SUPPLIER_CSV_COLUMNS}
          endpoint="/procurement/suppliers/import"
          templateName="suppliers-template.csv"
          mapRow={(r) => ({ name: r.name, contactName: r['contact_name'] || undefined, phone: r.phone || undefined, email: r.email || undefined, address: r.address || undefined })}
          onClose={() => setImportSup(false)}
          onDone={load}
        />
      )}
    </div>
  );
}

function Tile({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'amber' | 'rose' }) {
  const toneCls = tone === 'amber' ? 'text-amber-600' : tone === 'rose' ? 'text-rose-600' : 'text-text-primary';
  return <div className="card"><p className="text-xs text-text-muted">{label}</p><p className={`text-2xl font-semibold tabular-nums ${toneCls}`}>{value}</p></div>;
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${active ? 'border-primary-600 text-primary-600' : 'border-transparent text-text-secondary hover:text-text-primary'}`} onClick={onClick}>{children}</button>;
}

function PoBadge({ status, t }: { status: string; t: (k: string, d: string) => string }) {
  const map: Record<string, [string, string]> = {
    ordered: ['bg-amber-50 text-amber-700', t('dash.procurement.stOrdered', 'Ordered')],
    partially_received: ['bg-indigo-50 text-indigo-700', t('dash.procurement.stPartial', 'Partially received')],
    received: ['bg-green-50 text-green-700', t('dash.procurement.stReceived', 'Received')],
    cancelled: ['bg-gray-100 text-gray-500', t('dash.procurement.stCancelled', 'Cancelled')],
    draft: ['bg-sky-50 text-sky-700', t('dash.procurement.stDraft', 'Draft')],
  };
  const [cls, label] = map[status] ?? ['bg-surface-sunken text-text-secondary', status];
  return <span className={`badge capitalize ${cls}`}>{label}</span>;
}

function ModalShell({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className={`card w-full ${wide ? 'max-w-3xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="section-title">{title}</h3>
          <button className="text-text-muted hover:text-text-primary" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Create a multi-line PO. Each line can be linked to an inventory item (so Receive restocks it) or free-text. */
function PoModal({ suppliers, onClose, onSaved }: { suppliers: Supplier[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  type Line = { itemId: string; description: string; quantity: string; unitCost: string };
  const blank: Line = { itemId: '', description: '', quantity: '1', unitCost: '' };
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([{ ...blank }]);
  const [inv, setInv] = useState<InvLite[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get<InvLite[]>('/inventory/items').then((rows) => setInv(rows.map((r) => ({ id: r.id, name: r.name, unit: r.unit, unitCost: r.unitCost })))).catch(() => {});
  }, []);

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const pickItem = (i: number, itemId: string) => {
    const item = inv.find((x) => x.id === itemId);
    setLine(i, { itemId, ...(item ? { description: item.name, unitCost: lines[i]?.unitCost || String(item.unitCost) } : {}) });
  };
  const addLine = () => setLines((ls) => [...ls, { ...blank }]);
  const removeLine = (i: number) => setLines((ls) => ls.length === 1 ? ls : ls.filter((_, idx) => idx !== i));

  const total = useMemo(() => lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0), [lines]);

  const save = async () => {
    const items = lines
      .filter((l) => l.description.trim() && Number(l.quantity) > 0)
      .map((l) => ({ itemId: l.itemId || undefined, description: l.description.trim(), quantity: Number(l.quantity), unitCost: Number(l.unitCost) || 0 }));
    if (items.length === 0) { setErr(t('dash.procurement.needLine', 'Add at least one line with a description and quantity')); return; }
    setSaving(true); setErr('');
    try {
      await api.post('/procurement/purchase-orders', { supplierId: supplierId || undefined, notes: notes.trim() || undefined, items });
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : t('dash.procurement.failed', 'Failed')); } finally { setSaving(false); }
  };

  return (
    <ModalShell title={t('dash.procurement.newPo', 'New purchase order')} onClose={onClose} wide>
      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-sm text-red-700 mb-3">{err}</div>}
      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.procurement.supplier', 'Supplier')}</label>
          <select className="input-field" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">{t('dash.procurement.noSupplier', 'No supplier')}</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.procurement.notes', 'Notes (optional)')}</label>
          <input className="input-field" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('dash.procurement.notesPlaceholder', 'e.g. Weekly restock')} />
        </div>
      </div>

      <label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.procurement.lineItems', 'Line items')}</label>
      <div className="space-y-2 mb-3">
        {lines.map((l, i) => {
          const item = inv.find((x) => x.id === l.itemId);
          return (
            <div key={i} className="grid grid-cols-12 gap-2 items-start">
              <div className="col-span-4">
                <select className="input-field py-1.5 text-sm" value={l.itemId} onChange={(e) => pickItem(i, e.target.value)}>
                  <option value="">{t('dash.procurement.customItem', 'Custom item…')}</option>
                  {inv.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </div>
              <input className="col-span-3 input-field py-1.5 text-sm" placeholder={t('dash.procurement.description', 'Description *')} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
              <div className="col-span-2 flex items-center gap-1">
                <input className="input-field py-1.5 text-sm text-right tabular-nums" type="number" placeholder={t('dash.procurement.qty', 'Qty')} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                {item && <span className="text-xs text-text-muted whitespace-nowrap">{item.unit}</span>}
              </div>
              <input className="col-span-2 input-field py-1.5 text-sm text-right tabular-nums" type="number" placeholder={t('dash.procurement.unitCost', 'Unit cost')} value={l.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value })} />
              <button className="col-span-1 btn-ghost text-rose-600 py-1.5" onClick={() => removeLine(i)} disabled={lines.length === 1} title={t('dash.procurement.removeLine', 'Remove line')}>✕</button>
            </div>
          );
        })}
      </div>
      <button className="btn-ghost text-sm mb-4" onClick={addLine}>{t('dash.procurement.addLine', '+ Add line')}</button>

      <div className="flex items-center justify-between border-t border-border pt-3">
        <span className="text-sm text-text-muted">{t('dash.procurement.linkedHint', 'Lines linked to an inventory item restock it on receive.')}</span>
        <div className="text-right">
          <p className="text-xs text-text-muted">{t('dash.procurement.total', 'Total')}</p>
          <p className="text-lg font-semibold tabular-nums">{fmt(total)}</p>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button className="btn-secondary" onClick={onClose}>{t('dash.procurement.cancel', 'Cancel')}</button>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? t('dash.procurement.saving', 'Saving…') : t('dash.procurement.createPoBtn', 'Create PO')}</button>
      </div>
    </ModalShell>
  );
}

/** View a PO's line items, with receive / cancel actions for open POs. */
function PoDetailModal({ poId, onClose, onReceive, onCancel }: { poId: string; onClose: () => void; onReceive: (id: string) => void; onCancel: (id: string) => void }) {
  const { t } = useI18n();
  const [po, setPo] = useState<PODetail | null>(null);
  const [supplier, setSupplier] = useState<SupplierDetail | null>(null);
  const [grns, setGrns] = useState<GRN[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => {
    api.get<PODetail>(`/procurement/purchase-orders/${poId}`).then((p) => {
      setPo(p);
      if (p.supplierId) api.get<SupplierDetail>(`/procurement/suppliers/${p.supplierId}`).then(setSupplier).catch(() => {});
    }).catch((e) => setErr(e instanceof Error ? e.message : 'Failed'));
    api.get<GRN[]>(`/procurement/purchase-orders/${poId}/goods-receipts`).then(setGrns).catch(() => {});
  }, [poId]);
  const canReceive = po ? (po.status === 'ordered' || po.status === 'partially_received' || po.status === 'draft') : false;

  const supLine = supplier ? [supplier.contactName, supplier.phone, supplier.email].filter(Boolean).join(' · ') : '';

  return (
    <ModalShell title={po ? po.poNumber : t('dash.procurement.loading', 'Loading…')} onClose={onClose} wide>
      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-sm text-red-700 mb-3">{err}</div>}
      {po && (
        <>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm mb-2">
            <span className="text-text-muted">{t('dash.procurement.supplier', 'Supplier')}: <span className="text-text-primary">{po.supplier ?? '—'}</span></span>
            <span className="text-text-muted">{t('dash.procurement.status', 'Status')}: <PoBadge status={po.status} t={t} /></span>
            <span className="text-text-muted">{t('dash.procurement.created', 'Created')}: <span className="text-text-primary">{new Date(po.createdAt).toLocaleString()}</span></span>
            {po.receivedAt && <span className="text-text-muted">{t('dash.procurement.received', 'Received')}: <span className="text-text-primary">{new Date(po.receivedAt).toLocaleString()}</span></span>}
          </div>
          {supLine && <p className="text-xs text-text-muted mb-4">{supLine}{supplier?.address ? ` · ${supplier.address}` : ''}</p>}
          {po.notes && <p className="text-sm text-text-secondary mb-4">{po.notes}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-text-muted border-b border-border text-xs uppercase">
                <th className="py-2">{t('dash.procurement.item', 'Item')}</th>
                <th className="text-right">{t('dash.procurement.qty', 'Qty')}</th>
                <th className="text-right">{t('dash.procurement.receivedQty', 'Received')}</th>
                <th className="text-right">{t('dash.procurement.unitCost', 'Unit cost')}</th>
                <th className="text-right">{t('dash.procurement.subtotal', 'Subtotal')}</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {po.items.map((l) => {
                  const full = l.receivedQuantity >= l.quantity;
                  return (
                  <tr key={l.id}>
                    <td className="py-2">
                      {l.description}
                      {l.itemId
                        ? <span className="badge bg-green-50 text-green-700 ml-2">{t('dash.procurement.linked', 'linked')}</span>
                        : <span className="badge bg-surface-sunken text-text-muted ml-2">{t('dash.procurement.unlinked', 'not linked')}</span>}
                    </td>
                    <td className="text-right tabular-nums">{l.quantity}{l.itemUnit ? ` ${l.itemUnit}` : ''}</td>
                    <td className={`text-right tabular-nums ${full ? 'text-green-600' : l.receivedQuantity > 0 ? 'text-indigo-600' : 'text-text-muted'}`}>{l.receivedQuantity}</td>
                    <td className="text-right tabular-nums">{fmt(l.unitCost)}</td>
                    <td className="text-right tabular-nums">{fmt(l.subtotal)}</td>
                  </tr>
                  );
                })}
              </tbody>
              <tfoot><tr className="border-t border-border font-semibold"><td className="py-2" colSpan={4}>{t('dash.procurement.total', 'Total')}</td><td className="text-right tabular-nums">{fmt(po.total)}</td></tr></tfoot>
            </table>
          </div>

          {grns.length > 0 && (
            <div className="mt-5">
              <p className="text-xs uppercase tracking-wide text-text-muted mb-2">{t('dash.procurement.grnHistory', 'Goods receipts')} ({grns.length})</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-text-muted border-b border-border text-xs uppercase">
                    <th className="py-2">{t('dash.procurement.grnNumber', 'GRN #')}</th>
                    <th className="text-left">{t('dash.procurement.received', 'Received')}</th>
                    <th className="text-right">{t('dash.procurement.lines', 'Lines')}</th>
                    <th className="text-right">{t('dash.procurement.qty', 'Qty')}</th>
                  </tr></thead>
                  <tbody className="divide-y divide-border">
                    {grns.map((g) => (
                      <tr key={g.id}>
                        <td className="py-2 font-mono text-xs">{g.grnNumber}</td>
                        <td className="text-text-muted whitespace-nowrap">{new Date(g.receivedAt).toLocaleString()}</td>
                        <td className="text-right tabular-nums">{g.lineCount}</td>
                        <td className="text-right tabular-nums">{g.totalQuantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 mt-5">
            <button className="btn-secondary" onClick={onClose}>{t('dash.procurement.close', 'Close')}</button>
            {(po.status === 'ordered' || po.status === 'draft') && <button className="btn-secondary text-rose-600" onClick={() => { onClose(); onCancel(po.id); }}>{t('dash.procurement.cancel', 'Cancel PO')}</button>}
            {canReceive && <button className="btn-primary" onClick={() => onReceive(po.id)}>{t('dash.procurement.receiveGrn', 'Receive (GRN)')}</button>}
          </div>
        </>
      )}
    </ModalShell>
  );
}

/** Record a goods receipt (GRN) against a PO. Each PO line shows ordered vs already-received qty,
 *  with a "receive now" input defaulting to the remaining quantity. Supports partial receiving. */
function GrnModal({ poId, onClose, onSaved }: { poId: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [po, setPo] = useState<PODetail | null>(null);
  const [rows, setRows] = useState<Record<string, { qty: string; cost: string }>>({});
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get<PODetail>(`/procurement/purchase-orders/${poId}`).then((p) => {
      setPo(p);
      const init: Record<string, { qty: string; cost: string }> = {};
      for (const l of p.items) {
        const remaining = Math.max(0, l.quantity - l.receivedQuantity);
        init[l.id] = { qty: remaining > 0 ? String(remaining) : '', cost: String(l.unitCost) };
      }
      setRows(init);
    }).catch((e) => setErr(e instanceof Error ? e.message : 'Failed'));
  }, [poId]);

  const setRow = (id: string, patch: Partial<{ qty: string; cost: string }>) =>
    setRows((r) => ({ ...r, [id]: { ...r[id]!, ...patch } }));

  const save = async () => {
    if (!po) return;
    const lines = po.items
      .map((l) => ({ l, qty: Number(rows[l.id]?.qty), cost: Number(rows[l.id]?.cost) }))
      .filter((x) => Number.isFinite(x.qty) && x.qty > 0)
      .map((x) => ({ poItemId: x.l.id, quantity: x.qty, unitCost: Number.isFinite(x.cost) ? x.cost : undefined }));
    if (lines.length === 0) { setErr(t('dash.procurement.grnNeedLine', 'Enter a receive quantity on at least one line')); return; }
    const over = po.items.find((l) => { const q = Number(rows[l.id]?.qty) || 0; return l.receivedQuantity + q > l.quantity; });
    if (over) { setErr(t('dash.procurement.grnOver', 'Receive quantity exceeds the remaining amount on a line')); return; }
    setSaving(true); setErr('');
    try {
      await api.post(`/procurement/purchase-orders/${poId}/goods-receipts`, { lines, notes: notes.trim() || undefined });
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : t('dash.procurement.failed', 'Failed')); } finally { setSaving(false); }
  };

  return (
    <ModalShell title={po ? `${t('dash.procurement.receiveGrn', 'Receive (GRN)')} · ${po.poNumber}` : t('dash.procurement.loading', 'Loading…')} onClose={onClose} wide>
      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-sm text-red-700 mb-3">{err}</div>}
      {po && (
        <>
          <p className="text-sm text-text-muted mb-3">{t('dash.procurement.grnHint', 'Enter how much of each line arrived. Defaults to the remaining quantity. Linked items are restocked.')}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-text-muted border-b border-border text-xs uppercase">
                <th className="py-2">{t('dash.procurement.item', 'Item')}</th>
                <th className="text-right">{t('dash.procurement.ordered', 'Ordered')}</th>
                <th className="text-right">{t('dash.procurement.receivedQty', 'Received')}</th>
                <th className="text-right">{t('dash.procurement.receiveNow', 'Receive now')}</th>
                <th className="text-right">{t('dash.procurement.unitCost', 'Unit cost')}</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {po.items.map((l) => {
                  const remaining = Math.max(0, l.quantity - l.receivedQuantity);
                  return (
                    <tr key={l.id}>
                      <td className="py-2">
                        {l.description}
                        {l.itemId
                          ? <span className="badge bg-green-50 text-green-700 ml-2">{t('dash.procurement.linked', 'linked')}</span>
                          : <span className="badge bg-surface-sunken text-text-muted ml-2">{t('dash.procurement.unlinked', 'not linked')}</span>}
                      </td>
                      <td className="text-right tabular-nums">{l.quantity}{l.itemUnit ? ` ${l.itemUnit}` : ''}</td>
                      <td className="text-right tabular-nums text-text-muted">{l.receivedQuantity}</td>
                      <td className="text-right">
                        <input className="input-field py-1 text-sm text-right tabular-nums w-24 inline-block" type="number" min={0} max={remaining}
                          value={rows[l.id]?.qty ?? ''} disabled={remaining <= 0}
                          onChange={(e) => setRow(l.id, { qty: e.target.value })} />
                      </td>
                      <td className="text-right">
                        <input className="input-field py-1 text-sm text-right tabular-nums w-28 inline-block" type="number" min={0}
                          value={rows[l.id]?.cost ?? ''} onChange={(e) => setRow(l.id, { cost: e.target.value })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4">
            <label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.procurement.notes', 'Notes (optional)')}</label>
            <input className="input-field" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('dash.procurement.grnNotesPlaceholder', 'e.g. Partial delivery, rest to follow')} />
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button className="btn-secondary" onClick={onClose}>{t('dash.procurement.cancel', 'Cancel')}</button>
            <button className="btn-primary" onClick={save} disabled={saving}>{saving ? t('dash.procurement.saving', 'Saving…') : t('dash.procurement.recordGrn', 'Record receipt')}</button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

function SupplierModal({ supplier, onClose, onSaved }: { supplier: Supplier | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const isNew = !supplier;
  const [form, setForm] = useState({
    name: supplier?.name ?? '', contactName: supplier?.contactName ?? '', phone: supplier?.phone ?? '',
    email: supplier?.email ?? '', address: supplier?.address ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!form.name.trim()) { setErr(t('dash.procurement.nameRequired', 'Name is required')); return; }
    setSaving(true); setErr('');
    const body = { name: form.name.trim(), contactName: form.contactName || null, phone: form.phone || null, email: form.email || null, address: form.address || null };
    try {
      if (isNew) await api.post('/procurement/suppliers', body);
      else await api.patch(`/procurement/suppliers/${supplier!.id}`, body);
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : t('dash.procurement.failed', 'Failed')); } finally { setSaving(false); }
  };

  return (
    <ModalShell title={isNew ? t('dash.procurement.addSupplier', 'Add supplier') : t('dash.procurement.editSupplier', 'Edit supplier')} onClose={onClose}>
      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-sm text-red-700 mb-3">{err}</div>}
      <div className="space-y-3">
        <div><label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.procurement.name', 'Name')}</label><input className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.procurement.contact', 'Contact person')}</label><input className="input-field" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></div>
          <div><label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.procurement.phone', 'Phone')}</label><input className="input-field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
        </div>
        <div><label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.procurement.email', 'Email')}</label><input className="input-field" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div><label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.procurement.address', 'Address')}</label><textarea className="input-field" rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-secondary" onClick={onClose}>{t('dash.procurement.cancel', 'Cancel')}</button>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? t('dash.procurement.saving', 'Saving…') : t('dash.procurement.save', 'Save')}</button>
      </div>
    </ModalShell>
  );
}

/** Supplier detail: contact info, purchase-order stats, and the inventory items sourced from them with prices. */
function SupplierDetailModal({ supplierId, onClose, onEdit }: { supplierId: string; onClose: () => void; onEdit: (s: Supplier) => void }) {
  const { t } = useI18n();
  const [sup, setSup] = useState<SupplierDetail | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api.get<SupplierDetail>(`/procurement/suppliers/${supplierId}`).then(setSup).catch((e) => setErr(e instanceof Error ? e.message : 'Failed'));
  }, [supplierId]);

  return (
    <ModalShell title={sup ? sup.name : t('dash.procurement.loading', 'Loading…')} onClose={onClose} wide>
      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-sm text-red-700 mb-3">{err}</div>}
      {sup && (
        <>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm mb-4">
            {sup.contactName && <span className="text-text-muted">{t('dash.procurement.contact', 'Contact')}: <span className="text-text-primary">{sup.contactName}</span></span>}
            {sup.phone && <span className="text-text-muted">{t('dash.procurement.phone', 'Phone')}: <span className="text-text-primary">{sup.phone}</span></span>}
            {sup.email && <span className="text-text-muted">{t('dash.procurement.email', 'Email')}: <span className="text-text-primary">{sup.email}</span></span>}
          </div>
          {sup.address && <p className="text-sm text-text-secondary mb-4">{sup.address}</p>}

          <div className="grid grid-cols-3 gap-3 mb-5">
            <Tile label={t('dash.procurement.totalPos', 'Total POs')} value={String(sup.stats.poCount)} />
            <Tile label={t('dash.procurement.openPos', 'Open POs')} value={String(sup.stats.openPoCount)} tone={sup.stats.openPoCount > 0 ? 'amber' : 'default'} />
            <Tile label={t('dash.procurement.lifetimeValue', 'Lifetime value')} value={fmt(sup.stats.lifetimeValue)} />
          </div>

          <p className="text-xs uppercase tracking-wide text-text-muted mb-2">{t('dash.procurement.suppliedItems', 'Items supplied')} ({sup.items.length})</p>
          {sup.items.length === 0 ? (
            <p className="text-sm text-text-muted py-2">{t('dash.procurement.noSuppliedItems', 'No inventory items are linked to this supplier yet. Assign a supplier on an item to see it here.')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-text-muted border-b border-border text-xs uppercase">
                  <th className="py-2">{t('dash.procurement.item', 'Item')}</th>
                  <th className="text-right">{t('dash.procurement.onHand', 'On hand')}</th>
                  <th className="text-right">{t('dash.procurement.unitCost', 'Unit cost')}</th>
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {sup.items.map((it) => (
                    <tr key={it.id}>
                      <td className="py-2">{it.name}{it.sku ? <span className="text-text-muted font-mono text-xs"> · {it.sku}</span> : ''}</td>
                      <td className="text-right tabular-nums">{it.quantity} {it.unit}</td>
                      <td className="text-right tabular-nums">{fmt(it.unitCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-end gap-2 mt-5">
            <button className="btn-secondary" onClick={onClose}>{t('dash.procurement.close', 'Close')}</button>
            <button className="btn-primary" onClick={() => onEdit(sup)}>{t('dash.procurement.edit', 'Edit supplier')}</button>
          </div>
        </>
      )}
    </ModalShell>
  );
}
