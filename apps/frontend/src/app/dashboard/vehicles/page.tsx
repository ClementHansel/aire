'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface Brand { id: string; name: string; types: { id: string; name: string }[] }

export default function VehiclesPage() {
  const { t } = useI18n();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [newBrand, setNewBrand] = useState('');
  const [typeInputs, setTypeInputs] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setBrands(await api.get<Brand[]>('/vehicle-brands')); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : t('dash.vehicles.errLoad', 'Failed to load')); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const addBrand = async () => {
    if (!newBrand.trim()) return;
    try { await api.post('/vehicle-brands', { name: newBrand.trim() }); setNewBrand(''); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : t('dash.vehicles.errGeneric', 'Failed')); }
  };
  const delBrand = async (id: string) => {
    if (!confirm(t('dash.vehicles.confirmRemoveBrand', 'Remove this brand (and its types)?'))) return;
    try { await api.delete(`/vehicle-brands/${id}`); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : t('dash.vehicles.errGeneric', 'Failed')); }
  };
  const addType = async (brandId: string) => {
    const n = (typeInputs[brandId] ?? '').trim();
    if (!n) return;
    try { await api.post('/vehicle-types', { brandId, name: n }); setTypeInputs((p) => ({ ...p, [brandId]: '' })); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : t('dash.vehicles.errGeneric', 'Failed')); }
  };
  const delType = async (id: string) => {
    try { await api.delete(`/vehicle-types/${id}`); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : t('dash.vehicles.errGeneric', 'Failed')); }
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-text-primary mb-1">{t('dash.vehicles.title', 'Vehicle Catalog')}</h1>
      <p className="text-sm text-text-secondary mb-6">{t('dash.vehicles.intro', 'Brands and types shown as dropdowns in the POS (e.g. Honda → Brio).')}</p>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      <div className="card mb-6 flex items-end gap-2">
        <div className="flex-1">
          <label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.vehicles.newBrand', 'New brand')}</label>
          <input className="input-field py-1.5" placeholder={t('dash.vehicles.brandPlaceholder', 'e.g. Toyota')} value={newBrand} onChange={(e) => setNewBrand(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addBrand(); } }} />
        </div>
        <button className="btn-primary" onClick={addBrand} disabled={!newBrand.trim()}>{t('dash.vehicles.addBrand', '+ Add brand')}</button>
      </div>

      {loading ? (
        <div className="card text-sm text-text-muted">{t('dash.vehicles.loading', 'Loading…')}</div>
      ) : brands.length === 0 ? (
        <div className="card text-sm text-text-muted">{t('dash.vehicles.empty', 'No brands yet. Add one above.')}</div>
      ) : (
        <div className="space-y-3">
          {brands.map((b) => (
            <div key={b.id} className="card">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold text-text-primary">{b.name}</h2>
                <button className="btn-ghost text-xs text-rose-600" onClick={() => delBrand(b.id)}>{t('dash.vehicles.removeBrand', 'Remove brand')}</button>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {b.types.length === 0 && <span className="text-xs text-text-muted">{t('dash.vehicles.noTypes', 'No types yet.')}</span>}
                {b.types.map((t) => (
                  <span key={t.id} className="badge bg-surface-sunken text-text-secondary flex items-center gap-1">
                    {t.name}
                    <button className="text-text-muted hover:text-rose-600" onClick={() => delType(t.id)}>✕</button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  className="input-field py-1 flex-1"
                  placeholder={t('dash.vehicles.typePlaceholder', 'Add type (e.g. Brio)')}
                  value={typeInputs[b.id] ?? ''}
                  onChange={(e) => setTypeInputs((p) => ({ ...p, [b.id]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addType(b.id); } }}
                />
                <button className="btn-secondary text-xs" onClick={() => addType(b.id)} disabled={!(typeInputs[b.id] ?? '').trim()}>{t('dash.vehicles.addType', 'Add type')}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
