'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import BranchFilter from '@/components/dashboard/BranchFilter';
import { useI18n } from '@/lib/i18n';
import { CsvImportModal, exportRows, downloadTemplate, type CsvColumn } from '@/components/dashboard/CsvTools';

interface Item {
  id: string; sku: string | null; name: string; category: string | null; unit: string;
  quantity: number; reorderLevel: number; unitCost: number;
  supplierId: string | null; supplierName: string | null; outletId: string | null;
}
interface Summary { totalItems: number; lowStockItems: number; stockValue: number; }
interface SupplierLite { id: string; name: string; }
interface Movement { id: string; type: string; quantity: number; reason: string | null; reference: string | null; actor: string | null; createdAt: string; }
interface Source { poId: string; poNumber: string; status: string; supplierId: string | null; supplier: string | null; quantity: number; unitCost: number; createdAt: string; receivedAt: string | null; }
interface SupplierDetail { id: string; name: string; contactName: string | null; phone: string | null; email: string | null; address: string | null; }
interface Variance {
  opnameId: string | null; closedAt: string | null;
  items: { name: string; unit: string; expectedQty: number; countedQty: number | null; variance: number; varianceValue: number }[];
  totalVarianceValue: number;
}

const fmt = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

const CSV_COLUMNS: CsvColumn[] = [
  { key: 'sku', label: 'SKU', example: 'SKU-001' },
  { key: 'name', label: 'Name', required: true, example: 'Car shampoo 5L' },
  { key: 'category', label: 'Category', example: 'Chemicals' },
  { key: 'unit', label: 'Unit', example: 'btl' },
  { key: 'quantity', label: 'Quantity', example: '10' },
  { key: 'reorder_level', label: 'Reorder level', example: '3' },
  { key: 'unit_cost', label: 'Unit cost', example: '85000' },
  { key: 'supplier', label: 'Supplier (name)', example: 'PT Kimia Jaya' },
];
/** Map items to the CSV column shape and download. */
function exportItemsCsv(items: Item[]) {
  const rows = items.map((it) => ({
    sku: it.sku ?? '', name: it.name, category: it.category ?? '', unit: it.unit,
    quantity: it.quantity, reorder_level: it.reorderLevel, unit_cost: it.unitCost, supplier: it.supplierName ?? '',
  }));
  exportRows('inventory.csv', rows, CSV_COLUMNS);
}

type Sort = 'name' | 'lowFirst' | 'valueDesc';
type Status = 'out' | 'low' | 'ok';
const statusOf = (it: Item): Status => (it.quantity <= 0 ? 'out' : it.quantity <= it.reorderLevel ? 'low' : 'ok');

export default function InventoryPage() {
  const { t } = useI18n();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [variance, setVariance] = useState<Variance | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierLite[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [branch, setBranch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Toolbar state
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [sort, setSort] = useState<Sort>('name');

  // Modals
  const [editItem, setEditItem] = useState<Item | 'new' | null>(null);
  const [adjustItem, setAdjustItem] = useState<Item | null>(null);
  const [historyItem, setHistoryItem] = useState<Item | null>(null);
  const [detailItem, setDetailItem] = useState<Item | null>(null);
  const [uomFor, setUomFor] = useState<Item | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const bq = branch ? `?outletId=${branch}` : '';
      const [s, i, cats] = await Promise.all([
        api.get<Summary>(`/inventory/summary${bq}`),
        api.get<Item[]>(`/inventory/items${bq}`),
        api.get<string[]>('/inventory/categories').catch(() => []),
      ]);
      setSummary(s); setItems(i); setCategories(cats); setError('');
      // Shrinkage from the latest closed stock opname (best-effort — needs OutletAdmin).
      api.get<Variance>('/cogs/inventory-variance').then(setVariance).catch(() => setVariance(null));
    } catch (e) { setError(e instanceof Error ? e.message : t('dash.inventory.loadError', 'Failed to load')); }
    finally { setLoading(false); }
  }, [branch, t]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<SupplierLite[]>('/procurement/suppliers').then(setSuppliers).catch(() => {}); }, []);

  const outOfStock = useMemo(() => items.filter((i) => i.quantity <= 0).length, [items]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = items.filter((it) => {
      if (categoryFilter && (it.category ?? '') !== categoryFilter) return false;
      if (lowOnly && statusOf(it) === 'ok') return false;
      if (q && !(it.name.toLowerCase().includes(q) || (it.sku ?? '').toLowerCase().includes(q) || (it.category ?? '').toLowerCase().includes(q))) return false;
      return true;
    });
    rows = [...rows].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'lowFirst') return (a.quantity - a.reorderLevel) - (b.quantity - b.reorderLevel);
      return b.quantity * b.unitCost - a.quantity * a.unitCost;
    });
    return rows;
  }, [items, search, categoryFilter, lowOnly, sort]);

  const remove = async (it: Item) => {
    if (!confirm(t('dash.inventory.confirmDelete', 'Remove "{name}" from inventory? Its stock history is kept.').replace('{name}', it.name))) return;
    try { await api.delete(`/inventory/items/${it.id}`); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : t('dash.inventory.failed', 'Failed')); }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-text-primary mb-1">{t('dash.inventory.title', 'Inventory')}</h1>
          <p className="text-sm text-text-secondary">{t('dash.inventory.subtitle', 'Track stock levels, costs and movements across your branches. Items at or below their reorder level are flagged for restocking.')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <BranchFilter value={branch} onChange={setBranch} />
          <button className="btn-secondary whitespace-nowrap" onClick={() => exportItemsCsv(items)}>{t('dash.inventory.exportCsv', 'Export')}</button>
          <button className="btn-secondary whitespace-nowrap" onClick={() => downloadTemplate('inventory-template.csv', CSV_COLUMNS)}>{t('dash.inventory.template', 'Template')}</button>
          <button className="btn-secondary whitespace-nowrap" onClick={() => setImportOpen(true)}>{t('dash.inventory.importCsv', 'Import')}</button>
          <button className="btn-primary whitespace-nowrap" onClick={() => setEditItem('new')}>{t('dash.inventory.addItem', '+ Add item')}</button>
        </div>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 flex justify-between gap-3"><span>{error}</span><button className="text-red-500" onClick={() => setError('')}>✕</button></div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile label={t('dash.inventory.items', 'Items')} value={String(summary?.totalItems ?? 0)} />
        <Tile label={t('dash.inventory.lowStock', 'Low stock')} value={String(summary?.lowStockItems ?? 0)} tone={(summary?.lowStockItems ?? 0) > 0 ? 'amber' : 'default'} />
        <Tile label={t('dash.inventory.outOfStock', 'Out of stock')} value={String(outOfStock)} tone={outOfStock > 0 ? 'rose' : 'default'} />
        <Tile label={t('dash.inventory.stockValue', 'Stock value')} value={fmt(summary?.stockValue ?? 0)} />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <input className="input-field py-1.5 flex-1 min-w-[200px]" placeholder={t('dash.inventory.searchItems', 'Search by name, SKU or category…')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input-field py-1.5 w-auto" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">{t('dash.inventory.allCategories', 'All categories')}</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="input-field py-1.5 w-auto" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="name">{t('dash.inventory.sortName', 'Sort: Name')}</option>
          <option value="lowFirst">{t('dash.inventory.sortLow', 'Sort: Lowest stock')}</option>
          <option value="valueDesc">{t('dash.inventory.sortValue', 'Sort: Highest value')}</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-text-secondary px-2 py-1.5 rounded-lg border border-border cursor-pointer select-none">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
          {t('dash.inventory.lowOnly', 'Needs restock')}
        </label>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-surface-sunken/50 text-xs font-medium text-text-secondary uppercase">
                <th className="text-left px-4 py-3">{t('dash.inventory.name', 'Item')}</th>
                <th className="text-left px-4 py-3">{t('dash.inventory.category', 'Category')}</th>
                <th className="text-left px-4 py-3">{t('dash.inventory.supplier', 'Supplier')}</th>
                <th className="text-right px-4 py-3">{t('dash.inventory.qty', 'On hand')}</th>
                <th className="text-right px-4 py-3">{t('dash.inventory.reorder', 'Reorder')}</th>
                <th className="text-right px-4 py-3">{t('dash.inventory.cost', 'Unit cost')}</th>
                <th className="text-right px-4 py-3">{t('dash.inventory.value', 'Value')}</th>
                <th className="text-center px-4 py-3">{t('dash.inventory.status', 'Status')}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && <tr><td colSpan={9} className="px-4 py-8 text-center text-text-muted text-sm">{t('dash.inventory.loading', 'Loading…')}</td></tr>}
              {!loading && shown.map((it) => {
                const st = statusOf(it);
                return (
                  <tr key={it.id} className="hover:bg-surface-sunken/30">
                    <td className="px-4 py-2.5">
                      <button className="font-medium text-text-primary hover:text-primary-600 text-left" onClick={() => setDetailItem(it)}>{it.name}</button>
                      {it.sku && <div className="text-xs text-text-muted font-mono">{it.sku}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-text-secondary">{it.category ?? '—'}</td>
                    <td className="px-4 py-2.5 text-sm text-text-secondary">{it.supplierName ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{it.quantity} <span className="text-text-muted text-xs">{it.unit}</span></td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-text-muted">{it.reorderLevel}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-sm">{fmt(it.unitCost)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-sm">{fmt(it.quantity * it.unitCost)}</td>
                    <td className="px-4 py-2.5 text-center"><StatusBadge status={st} t={t} /></td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <RowMenu
                        onAdjust={() => setAdjustItem(it)}
                        onDetail={() => setDetailItem(it)}
                        onEdit={() => setEditItem(it)}
                        onHistory={() => setHistoryItem(it)}
                        onUnits={() => setUomFor(it)}
                        onDelete={() => remove(it)}
                        t={t}
                      />
                    </td>
                  </tr>
                );
              })}
              {!loading && shown.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-text-muted text-sm">
                  {items.length === 0
                    ? t('dash.inventory.noItems', 'No inventory items yet. Add your first item to start tracking stock.')
                    : t('dash.inventory.noMatch', 'No items match your filters.')}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Shrinkage / stock variance from the latest closed opname */}
      <div className="card p-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">{t('dash.inventory.shrinkage', 'Shrinkage (latest stock opname)')}</h2>
            <p className="mt-0.5 text-xs text-text-muted">{t('dash.inventory.shrinkageDesc', 'Counted vs expected from your most recent closed count. Negative = missing stock.')}</p>
          </div>
          <div className="flex items-center gap-3">
            {variance?.opnameId && (
              <span className="text-xs text-text-muted">{t('dash.inventory.netVariance', 'Net')}: <span className={variance.totalVarianceValue < 0 ? 'font-medium text-rose-600' : 'font-medium text-green-600'}>{variance.totalVarianceValue > 0 ? '+' : ''}{fmt(variance.totalVarianceValue)}</span></span>
            )}
            <a href="/dashboard/opname" className="btn-secondary py-1.5 text-xs">{t('dash.inventory.runOpname', 'Stock opname')} →</a>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-surface-sunken/50">
                <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-secondary">{t('dash.inventory.item', 'Item')}</th>
                <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wide text-text-secondary">{t('dash.inventory.expected', 'Expected')}</th>
                <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wide text-text-secondary">{t('dash.inventory.counted', 'Counted')}</th>
                <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wide text-text-secondary">{t('dash.inventory.variance', 'Variance')}</th>
                <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wide text-text-secondary">{t('dash.inventory.value', 'Value')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {!variance || variance.items.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-text-muted">{t('dash.inventory.noOpname', 'No closed opname yet. Run a stock opname to measure shrinkage.')}</td></tr>
              ) : variance.items.map((it, i) => (
                <tr key={i} className="hover:bg-surface-sunken/40">
                  <td className="px-5 py-3 text-sm font-medium text-text-primary">{it.name} <span className="text-text-muted">({it.unit})</span></td>
                  <td className="px-5 py-3 text-right text-sm tabular-nums">{it.expectedQty}</td>
                  <td className="px-5 py-3 text-right text-sm tabular-nums">{it.countedQty ?? '—'}</td>
                  <td className={`px-5 py-3 text-right text-sm tabular-nums ${it.variance < 0 ? 'text-rose-600' : it.variance > 0 ? 'text-green-600' : ''}`}>{it.variance > 0 ? `+${it.variance}` : it.variance}</td>
                  <td className={`px-5 py-3 text-right text-sm tabular-nums ${it.varianceValue < 0 ? 'text-rose-600' : it.varianceValue > 0 ? 'text-green-600' : ''}`}>{it.varianceValue > 0 ? '+' : ''}{fmt(it.varianceValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editItem && <ItemModal item={editItem === 'new' ? null : editItem} suppliers={suppliers} categories={categories} defaultOutlet={branch} onClose={() => setEditItem(null)} onSaved={() => { setEditItem(null); load(); }} />}
      {adjustItem && <AdjustModal item={adjustItem} onClose={() => setAdjustItem(null)} onSaved={() => { setAdjustItem(null); load(); }} />}
      {historyItem && <MovementsModal item={historyItem} onClose={() => setHistoryItem(null)} />}
      {detailItem && <ItemDetailModal item={detailItem} onClose={() => setDetailItem(null)} onAdjust={() => { setDetailItem(null); setAdjustItem(detailItem); }} onEdit={() => { setDetailItem(null); setEditItem(detailItem); }} />}
      {uomFor && <UomModal item={uomFor} onClose={() => setUomFor(null)} />}
      {importOpen && (
        <CsvImportModal
          title={t('dash.inventory.importItems', 'Import items from CSV')}
          columns={CSV_COLUMNS}
          endpoint="/inventory/import"
          templateName="inventory-template.csv"
          mapRow={(r) => ({
            sku: r.sku || undefined, name: r.name, category: r.category || undefined, unit: r.unit || undefined,
            quantity: r.quantity, reorderLevel: r['reorder_level'], unitCost: r['unit_cost'], supplier: r.supplier || undefined,
          })}
          onClose={() => setImportOpen(false)}
          onDone={load}
        />
      )}
    </div>
  );
}

function Tile({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'amber' | 'rose' | 'green' }) {
  const toneCls = tone === 'amber' ? 'text-amber-600' : tone === 'rose' ? 'text-rose-600' : tone === 'green' ? 'text-green-600' : 'text-text-primary';
  return (
    <div className="card">
      <p className="text-xs text-text-muted">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${toneCls}`}>{value}</p>
    </div>
  );
}

/** Module-scoped so it isn't recreated each render (which would remount inputs and drop focus). */
function LabeledField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs font-medium text-text-secondary mb-1">{label}</label>{children}</div>;
}

function StatusBadge({ status, t }: { status: Status; t: (k: string, d: string) => string }) {
  if (status === 'out') return <span className="badge bg-rose-50 text-rose-700">{t('dash.inventory.stOut', 'Out')}</span>;
  if (status === 'low') return <span className="badge bg-amber-50 text-amber-700">{t('dash.inventory.stLow', 'Low')}</span>;
  return <span className="badge bg-green-50 text-green-700">{t('dash.inventory.stOk', 'In stock')}</span>;
}

/** Compact per-row action menu so the table stays uncluttered. */
function RowMenu({ onAdjust, onDetail, onEdit, onHistory, onUnits, onDelete, t }: {
  onAdjust: () => void; onDetail: () => void; onEdit: () => void; onHistory: () => void; onUnits: () => void; onDelete: () => void;
  t: (k: string, d: string) => string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="inline-flex items-center gap-1">
      <button className="btn-secondary text-xs py-1" onClick={onAdjust}>{t('dash.inventory.adjust', 'Adjust')}</button>
      <div className="relative">
        <button className="btn-ghost text-xs py-1 px-2" onClick={() => setOpen((o) => !o)} onBlur={() => setTimeout(() => setOpen(false), 150)}>⋯</button>
        {open && (
          <div className="absolute right-0 mt-1 z-10 w-44 rounded-lg border border-border bg-surface shadow-lg py-1 text-sm">
            <button className="block w-full text-left px-3 py-1.5 hover:bg-surface-sunken" onMouseDown={onDetail}>{t('dash.inventory.detail', 'Details & origin')}</button>
            <button className="block w-full text-left px-3 py-1.5 hover:bg-surface-sunken" onMouseDown={onEdit}>{t('dash.inventory.edit', 'Edit details')}</button>
            <button className="block w-full text-left px-3 py-1.5 hover:bg-surface-sunken" onMouseDown={onHistory}>{t('dash.inventory.history', 'Movement history')}</button>
            <button className="block w-full text-left px-3 py-1.5 hover:bg-surface-sunken" onMouseDown={onUnits}>{t('dash.inventory.units', 'Unit conversions')}</button>
            <button className="block w-full text-left px-3 py-1.5 hover:bg-surface-sunken text-rose-600" onMouseDown={onDelete}>{t('dash.inventory.delete', 'Remove item')}</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Item detail: full attributes, its primary supplier's contact, and where it has come from (PO origin history). */
function ItemDetailModal({ item, onClose, onAdjust, onEdit }: { item: Item; onClose: () => void; onAdjust: () => void; onEdit: () => void }) {
  const { t } = useI18n();
  const [sources, setSources] = useState<Source[] | null>(null);
  const [supplier, setSupplier] = useState<SupplierDetail | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get<Source[]>(`/inventory/items/${item.id}/sources`).then(setSources).catch((e) => setErr(e instanceof Error ? e.message : 'Failed'));
    if (item.supplierId) api.get<SupplierDetail>(`/procurement/suppliers/${item.supplierId}`).then(setSupplier).catch(() => {});
  }, [item.id, item.supplierId]);

  const st = statusOf(item);
  return (
    <ModalShell title={item.name} onClose={onClose} wide>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Detail label={t('dash.inventory.sku', 'SKU')} value={item.sku ?? '—'} />
        <Detail label={t('dash.inventory.category', 'Category')} value={item.category ?? '—'} />
        <Detail label={t('dash.inventory.onHand', 'On hand')} value={`${item.quantity} ${item.unit}`} />
        <Detail label={t('dash.inventory.status', 'Status')} value={<StatusBadge status={st} t={t} />} />
        <Detail label={t('dash.inventory.reorderLevel', 'Reorder level')} value={String(item.reorderLevel)} />
        <Detail label={t('dash.inventory.unitCost', 'Unit cost')} value={fmt(item.unitCost)} />
        <Detail label={t('dash.inventory.value', 'Stock value')} value={fmt(item.quantity * item.unitCost)} />
      </div>

      {/* Primary supplier / origin */}
      <div className="rounded-lg border border-border p-3 mb-4">
        <p className="text-xs uppercase tracking-wide text-text-muted mb-1">{t('dash.inventory.primarySupplier', 'Primary supplier')}</p>
        {item.supplierName ? (
          <div className="text-sm">
            <p className="font-medium text-text-primary">{item.supplierName}</p>
            {supplier && (
              <p className="text-text-secondary">
                {[supplier.contactName, supplier.phone, supplier.email].filter(Boolean).join(' · ') || t('dash.inventory.noContact', 'No contact details')}
              </p>
            )}
            {supplier?.address && <p className="text-text-muted text-xs mt-0.5">{supplier.address}</p>}
          </div>
        ) : <p className="text-sm text-text-muted">{t('dash.inventory.noSupplierSet', 'No supplier set. Edit the item to assign one.')}</p>}
      </div>

      {/* Origin history from purchase orders */}
      <p className="text-xs uppercase tracking-wide text-text-muted mb-2">{t('dash.inventory.originHistory', 'Origin — purchase history')}</p>
      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-sm text-red-700 mb-3">{err}</div>}
      {sources == null ? <p className="text-sm text-text-muted py-2">{t('dash.inventory.loading', 'Loading…')}</p> : sources.length === 0 ? (
        <p className="text-sm text-text-muted py-2">{t('dash.inventory.noSources', 'No purchase orders reference this item yet.')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-text-muted border-b border-border text-xs uppercase">
              <th className="py-2">{t('dash.inventory.date', 'Date')}</th>
              <th>{t('dash.inventory.po', 'PO')}</th>
              <th>{t('dash.inventory.supplier', 'Supplier')}</th>
              <th className="text-right">{t('dash.inventory.qty', 'Qty')}</th>
              <th className="text-right">{t('dash.inventory.cost', 'Unit cost')}</th>
              <th className="text-center">{t('dash.inventory.status', 'Status')}</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {sources.map((s) => (
                <tr key={s.poId}>
                  <td className="py-2 whitespace-nowrap text-text-secondary">{new Date(s.createdAt).toLocaleDateString()}</td>
                  <td className="font-mono text-xs">{s.poNumber}</td>
                  <td className="text-text-secondary">{s.supplier ?? '—'}</td>
                  <td className="text-right tabular-nums">{s.quantity} {item.unit}</td>
                  <td className="text-right tabular-nums">{fmt(s.unitCost)}</td>
                  <td className="text-center"><span className={`badge capitalize ${s.status === 'received' ? 'bg-green-50 text-green-700' : s.status === 'cancelled' ? 'bg-gray-100 text-gray-500' : 'bg-amber-50 text-amber-700'}`}>{s.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-secondary" onClick={onClose}>{t('dash.inventory.close', 'Close')}</button>
        <button className="btn-secondary" onClick={onEdit}>{t('dash.inventory.edit', 'Edit')}</button>
        <button className="btn-primary" onClick={onAdjust}>{t('dash.inventory.adjust', 'Adjust stock')}</button>
      </div>
    </ModalShell>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><p className="text-[11px] uppercase tracking-wide text-text-muted">{label}</p><p className="text-sm font-medium text-text-primary">{value}</p></div>;
}

function ModalShell({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className={`card w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="section-title">{title}</h3>
          <button className="text-text-muted hover:text-text-primary" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Create or edit an item's attributes. Quantity is set on create only; afterwards use Adjust. */
function ItemModal({ item, suppliers, categories, defaultOutlet, onClose, onSaved }: {
  item: Item | null; suppliers: SupplierLite[]; categories: string[]; defaultOutlet: string;
  onClose: () => void; onSaved: () => void;
}) {
  const { t } = useI18n();
  const isNew = !item;
  const [form, setForm] = useState({
    name: item?.name ?? '', sku: item?.sku ?? '', category: item?.category ?? '', unit: item?.unit ?? 'pcs',
    quantity: '', reorderLevel: item ? String(item.reorderLevel) : '', unitCost: item ? String(item.unitCost) : '',
    supplierId: item?.supplierId ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!form.name.trim()) { setErr(t('dash.inventory.nameRequired', 'Name is required')); return; }
    setSaving(true); setErr('');
    try {
      if (isNew) {
        await api.post('/inventory/items', {
          name: form.name.trim(), sku: form.sku || undefined, category: form.category || undefined, unit: form.unit || 'pcs',
          quantity: Number(form.quantity) || 0, reorderLevel: Number(form.reorderLevel) || 0, unitCost: Number(form.unitCost) || 0,
          supplierId: form.supplierId || undefined, outletId: defaultOutlet || undefined,
        });
      } else {
        await api.patch(`/inventory/items/${item!.id}`, {
          name: form.name.trim(), sku: form.sku, category: form.category, unit: form.unit || 'pcs',
          reorderLevel: Number(form.reorderLevel) || 0, unitCost: Number(form.unitCost) || 0,
          supplierId: form.supplierId || null,
        });
      }
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : t('dash.inventory.failed', 'Failed')); } finally { setSaving(false); }
  };

  return (
    <ModalShell title={isNew ? t('dash.inventory.addItem', 'Add item') : t('dash.inventory.editItem', 'Edit item')} onClose={onClose}>
      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-sm text-red-700 mb-3">{err}</div>}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><LabeledField label={t('dash.inventory.namePlaceholder', 'Name')}><input className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></LabeledField></div>
        <LabeledField label={t('dash.inventory.sku', 'SKU')}><input className="input-field" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></LabeledField>
        <LabeledField label={t('dash.inventory.category', 'Category')}>
          <input className="input-field" list="inv-categories" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <datalist id="inv-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </LabeledField>
        <LabeledField label={t('dash.inventory.unit', 'Unit')}><input className="input-field" placeholder="pcs" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></LabeledField>
        <LabeledField label={t('dash.inventory.supplier', 'Supplier')}>
          <select className="input-field" value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
            <option value="">{t('dash.inventory.noSupplier', 'No supplier')}</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </LabeledField>
        {isNew && <LabeledField label={t('dash.inventory.openingQty', 'Opening qty')}><input className="input-field" type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></LabeledField>}
        <LabeledField label={t('dash.inventory.reorderLevel', 'Reorder level')}><input className="input-field" type="number" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} /></LabeledField>
        <LabeledField label={t('dash.inventory.unitCost', 'Unit cost (Rp)')}><input className="input-field" type="number" value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} /></LabeledField>
      </div>
      {!isNew && <p className="text-xs text-text-muted mt-3">{t('dash.inventory.editQtyHint', 'To change the quantity on hand, use “Adjust” so the movement is recorded in the ledger.')}</p>}
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-secondary" onClick={onClose}>{t('dash.inventory.cancel', 'Cancel')}</button>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? t('dash.inventory.saving', 'Saving…') : t('dash.inventory.save', 'Save')}</button>
      </div>
    </ModalShell>
  );
}

/** Record a stock movement (in / out / set-exact) with a reason — replaces the old window.prompt flow. */
function AdjustModal({ item, onClose, onSaved }: { item: Item; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<'in' | 'out' | 'adjustment'>('in');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const preview = useMemo(() => {
    const n = Number(qty);
    if (!Number.isFinite(n) || qty === '') return item.quantity;
    return mode === 'in' ? item.quantity + n : mode === 'out' ? item.quantity - n : n;
  }, [qty, mode, item.quantity]);

  const save = async () => {
    const n = Number(qty);
    if (!Number.isFinite(n) || n < 0 || qty === '') { setErr(t('dash.inventory.qtyPositive', 'Enter a valid quantity')); return; }
    if (mode !== 'adjustment' && n <= 0) { setErr(t('dash.inventory.qtyPositive', 'Enter a valid quantity')); return; }
    setSaving(true); setErr('');
    try {
      await api.post(`/inventory/items/${item.id}/adjust`, {
        type: mode, quantity: n,
        reason: reason.trim() || (mode === 'in' ? 'Stock in' : mode === 'out' ? 'Stock out' : 'Recount'),
      });
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : t('dash.inventory.failed', 'Failed')); } finally { setSaving(false); }
  };

  const tab = (m: typeof mode, label: string) => (
    <button className={`flex-1 py-1.5 text-sm rounded-lg ${mode === m ? 'bg-primary-600 text-white' : 'bg-surface-sunken text-text-secondary'}`} onClick={() => setMode(m)}>{label}</button>
  );

  return (
    <ModalShell title={`${t('dash.inventory.adjust', 'Adjust')} · ${item.name}`} onClose={onClose}>
      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-sm text-red-700 mb-3">{err}</div>}
      <p className="text-sm text-text-secondary mb-3">{t('dash.inventory.onHandNow', 'On hand now:')} <span className="font-semibold tabular-nums">{item.quantity} {item.unit}</span></p>
      <div className="flex gap-2 mb-3">
        {tab('in', t('dash.inventory.stockIn', 'Stock in'))}
        {tab('out', t('dash.inventory.stockOut', 'Stock out'))}
        {tab('adjustment', t('dash.inventory.setExact', 'Set exact'))}
      </div>
      <label className="block text-xs font-medium text-text-secondary mb-1">{mode === 'adjustment' ? t('dash.inventory.newCount', 'New counted quantity') : t('dash.inventory.quantity', 'Quantity')}</label>
      <input className="input-field mb-3" type="number" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus placeholder="0" />
      <label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.inventory.reason', 'Reason (optional)')}</label>
      <input className="input-field mb-3" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('dash.inventory.reasonPlaceholder', 'e.g. Damaged, Delivery, Recount')} />
      <div className="rounded-lg bg-surface-sunken/50 px-3 py-2 text-sm flex items-center justify-between">
        <span className="text-text-muted">{t('dash.inventory.resulting', 'Resulting on hand')}</span>
        <span className={`font-semibold tabular-nums ${preview < 0 ? 'text-rose-600' : ''}`}>{preview} {item.unit}</span>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-secondary" onClick={onClose}>{t('dash.inventory.cancel', 'Cancel')}</button>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? t('dash.inventory.saving', 'Saving…') : t('dash.inventory.record', 'Record movement')}</button>
      </div>
    </ModalShell>
  );
}

/** Read-only ledger of stock movements for an item. */
function MovementsModal({ item, onClose }: { item: Item; onClose: () => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<Movement[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api.get<Movement[]>(`/inventory/items/${item.id}/movements`).then(setRows)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed'));
  }, [item.id]);

  const badge = (type: string) => {
    const map: Record<string, string> = {
      in: 'bg-green-50 text-green-700', out: 'bg-rose-50 text-rose-700', adjustment: 'bg-sky-50 text-sky-700',
      sale: 'bg-amber-50 text-amber-700', sale_return: 'bg-green-50 text-green-700',
    };
    return <span className={`badge ${map[type] ?? 'bg-surface-sunken text-text-secondary'}`}>{type.replace('_', ' ')}</span>;
  };

  return (
    <ModalShell title={`${t('dash.inventory.history', 'Movement history')} · ${item.name}`} onClose={onClose} wide>
      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-sm text-red-700 mb-3">{err}</div>}
      {rows == null ? <p className="text-sm text-text-muted py-4">{t('dash.inventory.loading', 'Loading…')}</p> : rows.length === 0 ? (
        <p className="text-sm text-text-muted py-4">{t('dash.inventory.noMovements', 'No movements recorded yet.')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-text-muted border-b border-border text-xs uppercase">
              <th className="py-2">{t('dash.inventory.when', 'When')}</th>
              <th>{t('dash.inventory.type', 'Type')}</th>
              <th className="text-right">{t('dash.inventory.qty', 'Qty')}</th>
              <th>{t('dash.inventory.reason', 'Reason')}</th>
              <th>{t('dash.inventory.ref', 'Ref')}</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((m) => (
                <tr key={m.id}>
                  <td className="py-2 whitespace-nowrap text-text-secondary">{new Date(m.createdAt).toLocaleString()}</td>
                  <td>{badge(m.type)}</td>
                  <td className="text-right tabular-nums">{m.quantity} {item.unit}</td>
                  <td className="text-text-secondary">{m.reason ?? '—'}</td>
                  <td className="text-text-muted font-mono text-xs">{m.reference ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex justify-end mt-4"><button className="btn-secondary" onClick={onClose}>{t('dash.inventory.close', 'Close')}</button></div>
    </ModalShell>
  );
}

/** Manage unit conversions for an item, e.g. recipe in "g" → stock unit "kg" (factor 0.001).
 *  Used by COGS auto-deduction when a recipe's unit differs from the item's stock unit. */
function UomModal({ item, onClose }: { item: Item; onClose: () => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<{ id: string; fromUnit: string; toUnit: string; factor: number }[]>([]);
  const [fromUnit, setFromUnit] = useState('');
  const [factor, setFactor] = useState('');
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    try { setRows(await api.get<{ id: string; fromUnit: string; toUnit: string; factor: number }[]>(`/inventory/${item.id}/uom`)); }
    catch (e) { setErr(e instanceof Error ? e.message : t('dash.inventory.failed', 'Failed')); }
  }, [item.id, t]);
  useEffect(() => { load(); }, [load]);
  const add = async () => {
    if (!fromUnit.trim() || !(Number(factor) > 0)) { setErr(t('dash.inventory.uomError', 'Enter a from-unit and a positive factor')); return; }
    try { await api.post(`/inventory/${item.id}/uom`, { fromUnit: fromUnit.trim(), toUnit: item.unit, factor: Number(factor) }); setFromUnit(''); setFactor(''); setErr(''); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : t('dash.inventory.failed', 'Failed')); }
  };
  const del = async (id: string) => { try { await api.delete(`/uom/${id}`); await load(); } catch (e) { setErr(e instanceof Error ? e.message : t('dash.inventory.failed', 'Failed')); } };
  return (
    <ModalShell title={`${t('dash.inventory.unitsTitle', 'Unit conversions')} · ${item.name}`} onClose={onClose}>
      <p className="text-xs text-text-muted mb-3">{t('dash.inventory.stockUnitLabel', 'Stock unit:')} <span className="font-medium">{item.unit}</span>. {t('dash.inventory.uomHint', 'Add a conversion so a recipe written in another unit deducts correctly (e.g. 1 g = 0.001 kg).')}</p>
      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-sm text-red-700 mb-3">{err}</div>}
      <div className="space-y-1.5 mb-3">
        {rows.length === 0 && <p className="text-xs text-text-muted">{t('dash.inventory.noConversions', 'No conversions. Recipes must use the stock unit')} ({item.unit}).</p>}
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between text-sm">
            <span>1 <span className="font-medium">{r.fromUnit}</span> = {r.factor} {r.toUnit}</span>
            <button className="btn-ghost text-xs text-rose-600" onClick={() => del(r.id)}>✕</button>
          </div>
        ))}
      </div>
      <div className="flex items-end gap-2">
        <div><label className="block text-xs text-text-secondary mb-1">{t('dash.inventory.oneOfUnit', '1 of unit')}</label><input className="input-field py-1 w-24" placeholder="g" value={fromUnit} onChange={(e) => setFromUnit(e.target.value)} /></div>
        <span className="pb-2">=</span>
        <div><label className="block text-xs text-text-secondary mb-1">{t('dash.inventory.factorLabel', '× factor')}</label><input type="number" className="input-field py-1 w-28" placeholder="0.001" value={factor} onChange={(e) => setFactor(e.target.value)} /></div>
        <span className="pb-2">{item.unit}</span>
        <button className="btn-secondary text-xs" onClick={add}>{t('dash.inventory.add', 'Add')}</button>
      </div>
      <div className="flex justify-end mt-4"><button className="btn-secondary" onClick={onClose}>{t('dash.inventory.close', 'Close')}</button></div>
    </ModalShell>
  );
}
