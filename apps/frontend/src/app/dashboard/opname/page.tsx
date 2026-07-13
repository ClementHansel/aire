'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface OpnameListRow { id: string; outletId: string | null; status: string; note: string | null; createdAt: string; closedAt: string | null; itemCount: number; totalVarianceValue: number }
interface OpnameItem { id: string; inventoryItemId: string; name: string; sku: string | null; category: string | null; unit: string; expectedQty: number; countedQty: number | null; unitCost: number; variance: number | null; varianceValue: number | null }
interface Opname { id: string; outletId: string | null; status: string; note: string | null; createdAt: string; closedAt: string | null; items: OpnameItem[] }
interface AvailableItem { id: string; name: string; sku: string | null; unit: string; quantity: number; unitCost: number }

const fmt = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const num = (raw: string | undefined | null): number | null => {
  if (raw == null || raw.trim() === '') return null;
  const v = Number(raw);
  return Number.isNaN(v) ? null : v;
};

export default function OpnamePage() {
  const { t } = useI18n();
  const [list, setList] = useState<OpnameListRow[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [outletId, setOutletId] = useState('');
  const [note, setNote] = useState('');
  const [active, setActive] = useState<Opname | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [available, setAvailable] = useState<AvailableItem[]>([]);
  const [addSearch, setAddSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    try { setList(await api.get<OpnameListRow[]>('/opname')); } catch (e) { setError(e instanceof Error ? e.message : t('dash.opname.failed', 'Failed')); }
  }, [t]);

  useEffect(() => {
    loadList();
    api.get<{ branches: { id: string; name: string }[] }>('/hr/my/branch-context').then((c) => setBranches(c?.branches ?? [])).catch(() => {});
  }, [loadList]);

  const hydrate = useCallback((o: Opname) => {
    setActive(o);
    setCounts((prev) => {
      const c: Record<string, string> = {};
      // Keep any values the user has already typed this session; fall back to saved.
      o.items.forEach((it) => {
        c[it.inventoryItemId] = prev[it.inventoryItemId] ?? (it.countedQty == null ? '' : String(it.countedQty));
      });
      return c;
    });
  }, []);

  const open = async (id: string) => {
    try {
      const o = await api.get<Opname>(`/opname/${id}`);
      setActive(o);
      const c: Record<string, string> = {};
      o.items.forEach((it) => { c[it.inventoryItemId] = it.countedQty == null ? '' : String(it.countedQty); });
      setCounts(c);
      setDirty(new Set());
      setSearch('');
      setAddOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : t('dash.opname.failed', 'Failed')); }
  };

  const create = async () => {
    if (branches.length > 0 && !outletId) { setError(t('dash.opname.branchRequired', 'Please choose a branch to count.')); return; }
    setBusy(true); setError('');
    try {
      const o = await api.post<Opname>('/opname', { outletId: outletId || undefined, note: note.trim() || undefined });
      setNote('');
      await loadList();
      await open(o.id);
    } catch (e) { setError(e instanceof Error ? e.message : t('dash.opname.createError', 'Failed to create')); } finally { setBusy(false); }
  };

  const clearDirty = (itemId: string) => setDirty((p) => { const n = new Set(p); n.delete(itemId); return n; });

  // Persist a count (or null to clear it) so a cleared field also resets book stock on close.
  const commit = async (itemId: string, val: number | null) => {
    if (!active) return;
    try {
      await api.patch(`/opname/${active.id}/items/${itemId}`, { countedQty: val });
      clearDirty(itemId);
    } catch (e) { setError(e instanceof Error ? e.message : t('dash.opname.saveCountError', 'Failed to save count')); }
  };

  const saveCount = (itemId: string) => { if (dirty.has(itemId)) void commit(itemId, num(counts[itemId])); };

  const setCount = (itemId: string, value: string, persist = false) => {
    setCounts((p) => ({ ...p, [itemId]: value }));
    if (persist) void commit(itemId, num(value));
    else setDirty((p) => new Set(p).add(itemId));
  };

  const loadAvailable = async () => {
    if (!active) return;
    setAddOpen((o) => !o);
    if (addOpen) return;
    try { setAvailable(await api.get<AvailableItem[]>(`/opname/${active.id}/available`)); }
    catch (e) { setError(e instanceof Error ? e.message : t('dash.opname.failed', 'Failed')); }
  };

  const addItem = async (inventoryItemId: string) => {
    if (!active) return;
    try {
      const o = await api.post<Opname>(`/opname/${active.id}/items`, { inventoryItemId });
      hydrate(o);
      setAvailable((prev) => prev.filter((a) => a.id !== inventoryItemId));
    } catch (e) { setError(e instanceof Error ? e.message : t('dash.opname.addError', 'Failed to add item')); }
  };

  const remove = async (id: string) => {
    if (!confirm(t('dash.opname.confirmDelete', 'Delete this opname? Nothing will be reconciled.'))) return;
    try {
      await api.delete(`/opname/${id}`);
      if (active?.id === id) setActive(null);
      await loadList();
    } catch (e) { setError(e instanceof Error ? e.message : t('dash.opname.deleteError', 'Failed to delete')); }
  };

  const close = async () => {
    if (!active) return;
    const uncounted = active.items.filter((it) => num(counts[it.inventoryItemId]) == null).length;
    const warn = uncounted > 0
      ? t('dash.opname.confirmCloseUncounted', '{n} item(s) have no count and will be LEFT UNCHANGED (book stock kept). Finish anyway and reconcile the counted items?').replace('{n}', String(uncounted))
      : t('dash.opname.confirmClose', 'Close this opname? Inventory will be reconciled to the counted quantities.');
    if (!confirm(warn)) return;
    setBusy(true); setError('');
    try {
      // Persist any pending counts, then close.
      await Promise.all(active.items.map((it) => {
        const val = num(counts[it.inventoryItemId]);
        return val == null ? Promise.resolve() : api.patch(`/opname/${active.id}/items/${it.inventoryItemId}`, { countedQty: val });
      }));
      const o = await api.post<Opname>(`/opname/${active.id}/close`);
      setActive(o);
      setDirty(new Set());
      await loadList();
    } catch (e) { setError(e instanceof Error ? e.message : t('dash.opname.closeError', 'Failed to close')); } finally { setBusy(false); }
  };

  const branchName = (id: string | null) => (id ? branches.find((b) => b.id === id)?.name ?? t('dash.opname.branchFallback', 'Branch') : t('dash.opname.allBranches', 'All branches'));
  const isCounting = active?.status === 'counting';

  // Live, client-side variance for the active opname (so counters see it while counting).
  const liveItems = useMemo(() => {
    if (!active) return [];
    return active.items.map((it) => {
      const counted = isCounting ? num(counts[it.inventoryItemId]) : it.countedQty;
      const variance = counted == null ? null : counted - it.expectedQty;
      const varianceValue = variance == null ? null : variance * it.unitCost;
      return { ...it, counted, variance, varianceValue };
    });
  }, [active, counts, isCounting]);

  const stats = useMemo(() => {
    const total = liveItems.length;
    const counted = liveItems.filter((it) => it.counted != null).length;
    const varianceValue = liveItems.reduce((s, it) => s + (it.varianceValue ?? 0), 0);
    const short = liveItems.filter((it) => it.variance != null && it.variance < 0).length;
    const over = liveItems.filter((it) => it.variance != null && it.variance > 0).length;
    return { total, counted, uncounted: total - counted, varianceValue, short, over };
  }, [liveItems]);

  const shownItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return liveItems;
    return liveItems.filter((it) => it.name.toLowerCase().includes(q) || (it.sku ?? '').toLowerCase().includes(q));
  }, [liveItems, search]);

  const shownAvailable = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    if (!q) return available.slice(0, 50);
    return available.filter((a) => a.name.toLowerCase().includes(q) || (a.sku ?? '').toLowerCase().includes(q)).slice(0, 50);
  }, [available, addSearch]);

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold text-text-primary mb-1">{t('dash.opname.title', 'Stock Opname')}</h1>
      <p className="text-sm text-text-secondary mb-6">{t('dash.opname.subtitle', 'Count physical stock at a branch. Variance shows live as you count; on finish, inventory is reconciled to your counts and the variance vs book stock is recorded (see COGS report).')}</p>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4 flex justify-between gap-3"><span>{error}</span><button className="text-red-500" onClick={() => setError('')}>✕</button></div>}

      {/* New opname */}
      <div className="card mb-6 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.opname.branch', 'Branch')} {branches.length > 0 && <span className="text-rose-500">*</span>}</label>
          <select className="input-field py-1.5" value={outletId} onChange={(e) => setOutletId(e.target.value)}>
            <option value="">{branches.length > 0 ? t('dash.opname.chooseBranch', 'Choose a branch…') : t('dash.opname.allBranches', 'All branches')}</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.opname.noteOptional', 'Note (optional)')}</label>
          <input className="input-field py-1.5" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('dash.opname.notePlaceholder', 'e.g. Month-end count')} />
        </div>
        <button className="btn-primary" onClick={create} disabled={busy || (branches.length > 0 && !outletId)}>{busy ? t('dash.opname.working', 'Working…') : t('dash.opname.newOpname', '+ New count')}</button>
      </div>

      {active && (
        <div className="card mb-6">
          <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
            <div>
              <h2 className="section-title">{t('dash.opname.opnameLabel', 'Opname')} · {branchName(active.outletId)}</h2>
              <p className="text-xs text-text-muted">{new Date(active.createdAt).toLocaleString()} · <span className="capitalize">{active.status}</span>{active.note ? ` · ${active.note}` : ''}</p>
            </div>
            <div className="flex gap-2">
              <button className="btn-ghost text-sm" onClick={() => setActive(null)}>{t('dash.opname.closeView', 'Close view')}</button>
              {isCounting && <button className="btn-ghost text-sm text-rose-600" onClick={() => remove(active.id)}>{t('dash.opname.delete', 'Delete')}</button>}
              {isCounting && <button className="btn-primary text-sm" onClick={close} disabled={busy}>{t('dash.opname.finishReconcile', 'Finish & reconcile')}</button>}
            </div>
          </div>

          {/* Summary tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <Tile label={t('dash.opname.progress', 'Counted')} value={`${stats.counted} / ${stats.total}`} />
            <Tile label={t('dash.opname.uncounted', 'Uncounted')} value={String(stats.uncounted)} tone={stats.uncounted > 0 ? 'amber' : 'default'} />
            <Tile label={t('dash.opname.shortOver', 'Short / Over')} value={`${stats.short} / ${stats.over}`} />
            <Tile label={t('dash.opname.netVariance', 'Net variance')} value={fmt(stats.varianceValue)} tone={stats.varianceValue < 0 ? 'rose' : stats.varianceValue > 0 ? 'green' : 'default'} />
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <input className="input-field py-1.5 flex-1 min-w-[180px]" placeholder={t('dash.opname.searchItems', 'Search items…')} value={search} onChange={(e) => setSearch(e.target.value)} />
            {isCounting && <button className="btn-ghost text-sm" onClick={loadAvailable}>{addOpen ? t('dash.opname.hideAdd', 'Hide') : t('dash.opname.addItem', '+ Add item')}</button>}
          </div>

          {/* Add-item panel */}
          {isCounting && addOpen && (
            <div className="border border-border rounded-lg p-3 mb-3 bg-surface-sunken/40">
              <input className="input-field py-1.5 mb-2" placeholder={t('dash.opname.searchToAdd', 'Search inventory to add…')} value={addSearch} onChange={(e) => setAddSearch(e.target.value)} />
              {shownAvailable.length === 0 ? (
                <p className="text-xs text-text-muted px-1 py-2">{t('dash.opname.noneToAdd', 'No more items to add for this branch.')}</p>
              ) : (
                <div className="max-h-52 overflow-y-auto divide-y divide-border">
                  {shownAvailable.map((a) => (
                    <div key={a.id} className="flex items-center justify-between py-1.5 px-1">
                      <span className="text-sm">{a.name} <span className="text-text-muted">({a.unit})</span>{a.sku ? <span className="text-text-muted text-xs"> · {a.sku}</span> : ''}</span>
                      <button className="btn-ghost text-xs" onClick={() => addItem(a.id)}>{t('dash.opname.add', 'Add')}</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-border bg-surface-sunken/50">
                <th className="text-left px-3 py-2 text-xs font-medium text-text-secondary uppercase">{t('dash.opname.item', 'Item')}</th>
                <th className="text-right px-3 py-2 text-xs font-medium text-text-secondary uppercase">{t('dash.opname.expected', 'Book')}</th>
                <th className="text-right px-3 py-2 text-xs font-medium text-text-secondary uppercase">{t('dash.opname.counted', 'Counted')}</th>
                <th className="text-right px-3 py-2 text-xs font-medium text-text-secondary uppercase">{t('dash.opname.variance', 'Variance')}</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {shownItems.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-6 text-sm text-text-muted text-center">{active.items.length === 0 ? t('dash.opname.noItems', 'No inventory items for this branch. Add items to inventory first, or use "+ Add item".') : t('dash.opname.noMatch', 'No items match your search.')}</td></tr>
                )}
                {shownItems.map((it) => {
                  const uncounted = it.counted == null;
                  return (
                    <tr key={it.id} className={uncounted && isCounting ? 'bg-amber-50/40' : ''}>
                      <td className="px-3 py-2 text-sm font-medium">
                        {uncounted && isCounting && <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 mr-2 align-middle" title={t('dash.opname.notCounted', 'Not counted yet')} />}
                        {it.name} <span className="text-text-muted">({it.unit})</span>
                      </td>
                      <td className="px-3 py-2 text-sm text-right tabular-nums">{it.expectedQty}</td>
                      <td className="px-3 py-2 text-right">
                        {isCounting ? (
                          <div className="flex items-center justify-end gap-1">
                            {dirty.has(it.inventoryItemId) && <span className="w-1.5 h-1.5 rounded-full bg-sky-400" title={t('dash.opname.unsaved', 'Unsaved')} />}
                            <input
                              type="number"
                              className="input-field py-1 w-24 text-right tabular-nums"
                              value={counts[it.inventoryItemId] ?? ''}
                              onChange={(e) => setCount(it.inventoryItemId, e.target.value)}
                              onBlur={() => saveCount(it.inventoryItemId)}
                              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                            />
                            <button className="text-xs text-text-muted hover:text-primary-600 px-1" title={t('dash.opname.matchBook', 'Set to book qty')} onClick={() => setCount(it.inventoryItemId, String(it.expectedQty), true)}>=</button>
                          </div>
                        ) : (it.countedQty ?? '—')}
                      </td>
                      <td className={`px-3 py-2 text-sm text-right tabular-nums ${it.variance != null && it.variance < 0 ? 'text-rose-600' : it.variance != null && it.variance > 0 ? 'text-green-600' : 'text-text-muted'}`}>
                        {it.variance == null ? '—' : `${it.variance > 0 ? '+' : ''}${it.variance} (${fmt(it.varianceValue ?? 0)})`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent opnames */}
      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-border"><h2 className="text-sm font-semibold text-text-primary">{t('dash.opname.recentOpnames', 'Recent opnames')}</h2></div>
        <table className="w-full">
          <thead><tr className="border-b border-border bg-surface-sunken/50">
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.opname.created', 'Created')}</th>
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.opname.branch', 'Branch')}</th>
            <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.opname.items', 'Items')}</th>
            <th className="text-center px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.opname.status', 'Status')}</th>
            <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.opname.varianceValue', 'Variance value')}</th>
            <th></th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {list.length === 0 ? <tr><td colSpan={6} className="px-5 py-6 text-sm text-text-muted text-center">{t('dash.opname.noOpnames', 'No opnames yet.')}</td></tr> : list.map((o) => (
              <tr key={o.id} className={active?.id === o.id ? 'bg-primary-50/40' : ''}>
                <td className="px-5 py-2.5 text-sm">{new Date(o.createdAt).toLocaleString()}</td>
                <td className="px-5 py-2.5 text-sm text-text-secondary">{branchName(o.outletId)}</td>
                <td className="px-5 py-2.5 text-sm text-right">{o.itemCount}</td>
                <td className="px-5 py-2.5 text-center"><span className={`badge capitalize ${o.status === 'closed' ? 'bg-gray-100 text-gray-600' : 'bg-amber-50 text-amber-700'}`}>{o.status}</span></td>
                <td className={`px-5 py-2.5 text-sm text-right tabular-nums ${o.totalVarianceValue < 0 ? 'text-rose-600' : ''}`}>{o.status === 'closed' ? fmt(o.totalVarianceValue) : '—'}</td>
                <td className="px-5 py-2.5 text-right whitespace-nowrap">
                  <button className="btn-ghost text-xs" onClick={() => open(o.id)}>{t('dash.opname.open', 'Open')}</button>
                  {o.status !== 'closed' && <button className="btn-ghost text-xs text-rose-600 ml-1" onClick={() => remove(o.id)}>{t('dash.opname.delete', 'Delete')}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tile({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'amber' | 'rose' | 'green' }) {
  const toneCls = tone === 'amber' ? 'text-amber-600' : tone === 'rose' ? 'text-rose-600' : tone === 'green' ? 'text-green-600' : 'text-text-primary';
  return (
    <div className="rounded-lg border border-border bg-surface-sunken/30 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-text-muted">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${toneCls}`}>{value}</p>
    </div>
  );
}
