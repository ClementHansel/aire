'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useBusinessUnits, type BusinessUnit } from '@/lib/useBusinessUnits';

/**
 * Business unit CRUD (AIRIN-176).
 *
 * Two rules the UI has to make visible, because they are not arbitrary:
 *
 *  - `code` is create-only. It is the value already written on every service,
 *    order, payment method and queue row, so editing it would orphan history.
 *    The editable field is `name`, which is what people actually read.
 *  - Deleting is refused by the API while anything still references the unit.
 *    Deactivating is the intended way to retire one: it drops out of the POS
 *    tabs and the pickers while old orders keep resolving.
 */
export function BusinessUnitsPanel() {
  const { t } = useI18n();
  const { units, loading, reload } = useBusinessUnits(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState('#1652F0');

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#1652F0');

  const msg = (err: unknown) => setError(err instanceof Error ? err.message : String(err));

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.post('/business-units', { code, name, color, sortOrder: units.length });
      setCode(''); setName(''); setColor('#1652F0');
      reload();
    } catch (err) { msg(err); } finally { setBusy(false); }
  };

  const startEdit = (u: BusinessUnit) => { setEditId(u.id); setEditName(u.name); setEditColor(u.color); };

  const saveEdit = async (u: BusinessUnit) => {
    setBusy(true); setError('');
    try {
      await api.put(`/business-units/${u.id}`, { name: editName, color: editColor });
      setEditId(null);
      reload();
    } catch (err) { msg(err); } finally { setBusy(false); }
  };

  const toggleActive = async (u: BusinessUnit) => {
    setBusy(true); setError('');
    try {
      await api.put(`/business-units/${u.id}`, { isActive: !u.isActive });
      reload();
    } catch (err) { msg(err); } finally { setBusy(false); }
  };

  const remove = async (u: BusinessUnit) => {
    setBusy(true); setError('');
    try {
      await api.delete(`/business-units/${u.id}`);
      reload();
    } catch (err) { msg(err); } finally { setBusy(false); }
  };

  return (
    <div className="card" data-testid="business-units-panel">
      <h2 className="section-title mb-1">{t('dash.catalog.businessUnits', 'Business units')}</h2>
      <p className="text-xs text-text-muted mb-3">
        {t('dash.catalog.businessUnitsHint', 'Your lines of business. These become the POS catalog tabs and the filter on reports. The short code is fixed once created — it is stored on every order — but the name can change any time.')}
      </p>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-3">{error}</div>}

      <form onSubmit={add} className="flex flex-wrap gap-2 mb-4">
        <input
          className="input-field w-28" required maxLength={10}
          placeholder={t('dash.catalog.buCode', 'CODE')}
          value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
          aria-label={t('dash.catalog.buCode', 'CODE')}
        />
        <input
          className="input-field flex-1 min-w-[10rem]" required maxLength={80}
          placeholder={t('dash.catalog.buName', 'Display name')}
          value={name} onChange={(e) => setName(e.target.value)}
          aria-label={t('dash.catalog.buName', 'Display name')}
        />
        <input type="color" className="input-field h-10 w-14 p-1" value={color} onChange={(e) => setColor(e.target.value)} aria-label={t('dash.catalog.buColor', 'Colour')} />
        <button type="submit" className="btn-primary" disabled={busy}>{t('dash.catalog.buAdd', 'Add')}</button>
      </form>

      {loading ? (
        <p className="text-sm text-text-muted">{t('dash.catalog.loading', 'Loading…')}</p>
      ) : (
        <div className="space-y-2">
          {units.map((u) => (
            <div key={u.id} className={`flex items-center gap-2 flex-wrap border border-border rounded-lg px-3 py-2 ${u.isActive ? '' : 'opacity-60'}`}>
              <span className="w-3 h-3 rounded-full shrink-0" style={{ background: u.color }} />
              <span className="text-xs font-mono text-text-muted w-16 shrink-0">{u.code}</span>
              {editId === u.id ? (
                <>
                  <input className="input-field flex-1 min-w-[8rem]" value={editName} onChange={(e) => setEditName(e.target.value)} aria-label={t('dash.catalog.buName', 'Display name')} />
                  <input type="color" className="input-field h-9 w-12 p-1" value={editColor} onChange={(e) => setEditColor(e.target.value)} aria-label={t('dash.catalog.buColor', 'Colour')} />
                  <button className="btn-primary text-xs" disabled={busy} onClick={() => saveEdit(u)}>{t('dash.catalog.save', 'Save')}</button>
                  <button className="btn-ghost text-xs" onClick={() => setEditId(null)}>{t('dash.catalog.cancel', 'Cancel')}</button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-text-primary">{u.name}</span>
                  {!u.isActive && <span className="badge bg-gray-100 text-gray-600 text-xs">{t('dash.catalog.inactive', 'Inactive')}</span>}
                  <button className="btn-ghost text-xs" onClick={() => startEdit(u)}>{t('dash.catalog.rename', 'Rename')}</button>
                  <button className="btn-ghost text-xs" disabled={busy} onClick={() => toggleActive(u)}>
                    {u.isActive ? t('dash.catalog.deactivate', 'Deactivate') : t('dash.catalog.activate', 'Activate')}
                  </button>
                  <button className="btn-ghost text-xs text-red-600" disabled={busy} onClick={() => remove(u)}>{t('dash.catalog.delete', 'Delete')}</button>
                </>
              )}
            </div>
          ))}
          {units.length === 0 && <p className="text-sm text-text-muted">{t('dash.catalog.buEmpty', 'No business units yet.')}</p>}
        </div>
      )}
    </div>
  );
}
